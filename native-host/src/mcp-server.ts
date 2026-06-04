#!/usr/bin/env node
import readline from 'node:readline';
import { MCP_TOOLS, SERVER_NAME, TOOL_MAP } from '../../shared/src/protocol.js';
import { invokeHost } from './bridge-client.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const { id, method, params = {} } = request;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: SERVER_NAME,
          version: '0.1.0'
        }
      }
    });
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS }
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name : '';
    const command = TOOL_MAP.get(toolName);
    if (!command) {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown tool: ${toolName}` }
      });
      return;
    }

    const args = typeof params.arguments === 'object' && params.arguments !== null
      ? params.arguments as Record<string, unknown>
      : {};
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 120000;
    send({
      jsonrpc: '2.0',
      id,
      result: textResult(await invokeHost(command, args, timeoutMs))
    });
    return;
  }

  send({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unknown method: ${method}` }
  });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    void handleRequest(JSON.parse(trimmed) as JsonRpcRequest);
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
});
