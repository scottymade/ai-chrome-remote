import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HOST_DIR_NAME, type HostMetadata, type ResponseEnvelope } from '../../shared/src/protocol.js';

const HOST_FILE = path.join(os.homedir(), HOST_DIR_NAME, 'host.json');

export async function readHostMetadata(): Promise<HostMetadata> {
  const raw = await fs.readFile(HOST_FILE, 'utf8');
  return JSON.parse(raw) as HostMetadata;
}

export async function invokeHost(
  command: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 120000
): Promise<ResponseEnvelope> {
  try {
    const host = await readHostMetadata();
    const response = await fetch(`http://${host.host}:${host.port}/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${host.token}`
      },
      body: JSON.stringify({ command, payload, timeoutMs })
    });
    const result = await response.json() as ResponseEnvelope;
    if (!response.ok) {
      return {
        ok: false,
        error: result.ok === false ? result.error : `Native bridge HTTP ${response.status}`,
        code: result.ok === false ? result.code : 'native_bridge_error',
        details: result.ok === false ? result.details : {}
      };
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: 'Native host bridge is not available. Reload the extension after installing the native host manifest.',
      code: 'native_host_unavailable',
      details: {
        cause: error instanceof Error ? error.message : String(error),
        hostFile: HOST_FILE
      }
    };
  }
}
