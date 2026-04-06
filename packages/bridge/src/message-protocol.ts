import type { Readable, Writable } from 'node:stream';
import type { BridgeMessage, ExtensionMessage } from '@jira-enhancer/shared';
import { BridgeError, ErrorCode } from '@jira-enhancer/shared';

const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB

export class NativeMessagingProtocol {
  private readonly input: Readable;
  private readonly output: Writable;
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(input: Readable = process.stdin, output: Writable = process.stdout) {
    this.input = input;
    this.output = output;
  }

  readMessage(): Promise<BridgeMessage> {
    return new Promise<BridgeMessage>((resolve, reject) => {
      if (this.closed) {
        reject(new BridgeError(ErrorCode.INVALID_MESSAGE, 'Protocol is closed'));
        return;
      }

      const tryParse = (): boolean => {
        // Need at least 4 bytes for the length header
        if (this.buffer.length < 4) return false;

        const length = this.buffer.readUInt32LE(0);

        if (length <= 0 || length > MAX_MESSAGE_SIZE) {
          cleanup();
          reject(
            new BridgeError(
              ErrorCode.INVALID_MESSAGE,
              `Invalid message length: ${length}`,
            ),
          );
          return true;
        }

        if (this.buffer.length < 4 + length) return false;

        const jsonBytes = this.buffer.subarray(4, 4 + length);
        this.buffer = this.buffer.subarray(4 + length);

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonBytes.toString('utf-8'));
        } catch {
          cleanup();
          reject(
            new BridgeError(ErrorCode.INVALID_MESSAGE, 'Malformed JSON in message'),
          );
          return true;
        }

        cleanup();
        resolve(parsed as BridgeMessage);
        return true;
      };

      const onData = (chunk: Buffer): void => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        tryParse();
      };

      const onEnd = (): void => {
        cleanup();
        reject(new BridgeError(ErrorCode.INVALID_MESSAGE, 'Stream ended before complete message'));
      };

      const onError = (err: Error): void => {
        cleanup();
        reject(new BridgeError(ErrorCode.INVALID_MESSAGE, err.message));
      };

      const cleanup = (): void => {
        this.input.removeListener('data', onData);
        this.input.removeListener('end', onEnd);
        this.input.removeListener('error', onError);
      };

      // Try parsing from existing buffer first
      if (tryParse()) return;

      this.input.on('data', onData);
      this.input.on('end', onEnd);
      this.input.on('error', onError);
    });
  }

  sendMessage(msg: ExtensionMessage): void {
    if (this.closed) {
      throw new BridgeError(ErrorCode.INVALID_MESSAGE, 'Protocol is closed');
    }

    const json = Buffer.from(JSON.stringify(msg), 'utf-8');

    if (json.length > MAX_MESSAGE_SIZE) {
      throw new BridgeError(
        ErrorCode.INVALID_MESSAGE,
        `Message exceeds maximum size of ${MAX_MESSAGE_SIZE} bytes`,
      );
    }

    const header = Buffer.alloc(4);
    header.writeUInt32LE(json.length, 0);

    this.output.write(header);
    this.output.write(json);
  }

  onMessage(handler: (msg: BridgeMessage) => Promise<void>): void {
    const loop = async (): Promise<void> => {
      while (!this.closed) {
        try {
          const msg = await this.readMessage();
          await handler(msg);
        } catch {
          if (this.closed) return;
          break;
        }
      }
    };

    loop();
  }

  close(): void {
    this.closed = true;
    this.buffer = Buffer.alloc(0);
  }
}
