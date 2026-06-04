#!/usr/bin/env node
import { invokeHost } from './bridge-client.js';

function parseJsonArg(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Payload must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

const [command, payloadText] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node dist/native-host/src/invoke.js <command> [json-payload]');
  process.exit(1);
}

const result = await invokeHost(command, parseJsonArg(payloadText));
if (result.ok) {
  console.log(JSON.stringify(result.result, null, 2));
} else {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
