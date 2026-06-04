#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const requiredFiles = [
  'dist/extension/manifest.json',
  'dist/extension/src/background/service-worker.js',
  'dist/extension/src/content/router.js',
  'dist/extension/src/page/network-recorder.js',
  'dist/extension/src/page/page-agent.js',
  'dist/native-host/src/index.js',
  'dist/native-host/src/invoke.js',
  'dist/native-host/src/mcp-server.js',
  'dist/native-host/bin/ai-chrome-remote-host'
];

for (const relativePath of requiredFiles) {
  await fs.access(path.join(repoRoot, relativePath));
}

const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'dist/extension/manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) {
  throw new Error('dist extension manifest must be MV3.');
}

console.log('Distribution validation passed.');
