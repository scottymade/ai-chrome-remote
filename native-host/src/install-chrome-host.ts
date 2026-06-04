#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_DIR_NAME, HOST_NAME } from '../../shared/src/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find(arg => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function usage(): never {
  console.error('Usage: node dist/native-host/src/install-chrome-host.js --extension-id <chrome-extension-id>');
  process.exit(1);
}

const extensionId = getArg('extension-id');
if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) usage();

const distNativeRoot = path.resolve(__dirname, '..');
const hostPath = path.join(distNativeRoot, 'bin', 'ai-chrome-remote-host');
const agentDir = path.join(os.homedir(), HOST_DIR_NAME);
const nodePathFile = path.join(agentDir, 'node-path');
const chromeHostDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
const manifestPath = path.join(chromeHostDir, `${HOST_NAME}.json`);
const manifest = {
  name: HOST_NAME,
  description: 'AI Chrome Remote local MCP/native host bridge',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [
    `chrome-extension://${extensionId}/`
  ]
};

await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
await fs.writeFile(nodePathFile, process.execPath, { mode: 0o600 });
await fs.mkdir(chromeHostDir, { recursive: true });
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Installed Chrome Native Messaging host manifest: ${manifestPath}`);
console.log(`Recorded Node executable for Chrome-launched host: ${process.execPath}`);
