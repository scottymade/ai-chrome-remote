import { Buffer } from 'node:buffer';

type NativeWritable = {
  write(chunk: Uint8Array | string): unknown;
};

type NativeReadable = {
  on(event: 'data', listener: (chunk: Buffer | Uint8Array | string) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
};

export function writeNativeMessage(stream: NativeWritable, message: unknown): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  stream.write(header);
  stream.write(body);
}

export function readNativeMessages(
  stream: NativeReadable,
  onMessage: (message: unknown) => void,
  onError: (error: Error) => void
): void {
  let buffer = Buffer.alloc(0);

  stream.on('data', chunk => {
    const nextChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'binary') : Buffer.from(chunk);
    buffer = Buffer.concat([buffer, nextChunk]);

    while (buffer.length >= 4) {
      const messageLength = buffer.readUInt32LE(0);
      if (buffer.length < 4 + messageLength) return;

      const body = buffer.subarray(4, 4 + messageLength).toString('utf8');
      buffer = buffer.subarray(4 + messageLength);

      try {
        onMessage(JSON.parse(body));
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });

  stream.on('error', onError);
}
