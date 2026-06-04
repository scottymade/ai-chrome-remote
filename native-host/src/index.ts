#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { HOST_DIR_NAME, type HostMetadata, type ResponseEnvelope } from '../../shared/src/protocol.js';
import { readNativeMessages, writeNativeMessage } from './native-messaging.js';

const HOST_DIR = path.join(os.homedir(), HOST_DIR_NAME);
const HOST_FILE = path.join(HOST_DIR, 'host.json');
const TOKEN = crypto.randomBytes(32).toString('hex');
const pending = new Map<string, {
  resolve: (value: ResponseEnvelope) => void;
  timer: NodeJS.Timeout;
}>();
let serverPort = 0;

function safeJsonResponse(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function errorResponse(error: unknown, fallbackCode = 'native_host_error'): ResponseEnvelope {
  const known = error as Error & { code?: string; details?: Record<string, unknown> };
  return {
    ok: false,
    error: known?.message || String(error || 'Native host error'),
    code: known?.code || fallbackCode,
    details: known?.details || {}
  };
}

function readRequestBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch (error) {
        const invalid = error instanceof Error ? error : new Error(String(error));
        (invalid as Error & { code?: string }).code = 'invalid_json';
        reject(invalid);
      }
    });
    request.on('error', reject);
  });
}

function requireToken(request: http.IncomingMessage): void {
  const header = request.headers.authorization || '';
  const bearer = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : null;
  const token = bearer || request.headers['x-ai-chrome-remote-token'];
  if (token !== TOKEN) {
    const error = new Error('Invalid native host token') as Error & { code?: string };
    error.code = 'unauthorized';
    throw error;
  }
}

function requestExtension(command: string, payload: Record<string, unknown> = {}, timeoutMs = 120000): Promise<ResponseEnvelope> {
  const id = `native_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({
        ok: false,
        error: `Extension command timed out: ${command}`,
        code: 'timeout',
        details: {}
      });
    }, timeoutMs);

    pending.set(id, { resolve, timer });
    writeNativeMessage(process.stdout, {
      type: 'agent_request',
      id,
      command,
      payload
    });
  });
}

async function writeHostMetadata(): Promise<void> {
  const metadata: HostMetadata = {
    host: '127.0.0.1',
    port: serverPort,
    token: TOKEN,
    pid: process.pid,
    startedAt: new Date().toISOString()
  };
  await fs.mkdir(HOST_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(HOST_FILE, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
}

async function startBridgeServer(): Promise<void> {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/status') {
        safeJsonResponse(response, 200, {
          ok: true,
          result: {
            host: '127.0.0.1',
            port: serverPort,
            pid: process.pid,
            pending: pending.size,
            at: new Date().toISOString()
          }
        });
        return;
      }

      if (request.method !== 'POST' || request.url !== '/command') {
        safeJsonResponse(response, 404, {
          ok: false,
          error: 'Not found',
          code: 'not_found',
          details: {}
        });
        return;
      }

      requireToken(request);
      const body = await readRequestBody(request);
      const command = typeof body.command === 'string' ? body.command : '';
      if (!command) {
        safeJsonResponse(response, 400, {
          ok: false,
          error: 'command is required',
          code: 'invalid_request',
          details: {}
        });
        return;
      }

      const payload = typeof body.payload === 'object' && body.payload !== null
        ? body.payload as Record<string, unknown>
        : {};
      const timeoutMs = typeof body.timeoutMs === 'number' ? body.timeoutMs : 120000;
      safeJsonResponse(response, 200, await requestExtension(command, payload, timeoutMs));
    } catch (error) {
      const known = error as Error & { code?: string };
      safeJsonResponse(response, known.code === 'unauthorized' ? 401 : 500, errorResponse(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Native host did not receive a TCP port.'));
        return;
      }
      serverPort = address.port;
      resolve();
    });
  });

  await writeHostMetadata();
}

readNativeMessages(process.stdin, message => {
  if (!message || typeof message !== 'object') return;
  const nativeMessage = message as Record<string, unknown>;
  if (nativeMessage.type !== 'agent_response' || typeof nativeMessage.id !== 'string') return;

  const entry = pending.get(nativeMessage.id);
  if (!entry) return;

  pending.delete(nativeMessage.id);
  clearTimeout(entry.timer);
  if (nativeMessage.ok) {
    entry.resolve({ ok: true, result: nativeMessage.result });
    return;
  }
  entry.resolve({
    ok: false,
    error: typeof nativeMessage.error === 'string' ? nativeMessage.error : 'Extension command failed',
    code: typeof nativeMessage.code === 'string' ? nativeMessage.code : 'agent_command_failed',
    details: typeof nativeMessage.details === 'object' && nativeMessage.details !== null
      ? nativeMessage.details as Record<string, unknown>
      : {}
  });
}, error => {
  writeNativeMessage(process.stdout, {
    type: 'host_error',
    ...errorResponse(error)
  });
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('exit', () => {
  fs.rm(HOST_FILE, { force: true }).catch(() => {});
});

startBridgeServer().then(() => {
  writeNativeMessage(process.stdout, {
    type: 'host_ready',
    ok: true,
    result: {
      host: '127.0.0.1',
      port: serverPort,
      pid: process.pid
    }
  });
}).catch(error => {
  writeNativeMessage(process.stdout, {
    type: 'host_error',
    ...errorResponse(error)
  });
  process.exit(1);
});
