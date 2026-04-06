import { PassThrough } from 'node:stream';
import { describe, it, expect, afterEach } from 'vitest';
import { NativeMessagingProtocol } from '../src/message-protocol.js';
import { ErrorCode, MessageType } from '@jira-enhancer/shared';
import type { BridgeMessage, ExtensionMessage } from '@jira-enhancer/shared';

function encodeMessage(msg: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

describe('NativeMessagingProtocol', () => {
  let protocol: NativeMessagingProtocol;

  afterEach(() => {
    protocol?.close();
  });

  it('should send and receive a valid message roundtrip', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    protocol = new NativeMessagingProtocol(input, output);

    const request: BridgeMessage = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'test-1',
      issueKey: 'PROJ-123',
      description: '# Hello',
      mode: 'default',
      provider: 'opencode',
    };

    // Write encoded message to input stream
    input.write(encodeMessage(request));

    const received = await protocol.readMessage();
    expect(received).toEqual(request);

    // Now test sending a response through output
    const response: ExtensionMessage = {
      type: MessageType.ENHANCE_RESPONSE,
      id: 'test-1',
      refinedDescription: '# Improved Hello',
      originalDescription: '# Hello',
    };

    protocol.sendMessage(response);

    // Read from output stream
    const outputData = await new Promise<Buffer>((resolve) => {
      output.once('data', (chunk: Buffer) => {
        // First chunk contains header, possibly more
        const chunks = [chunk];
        const tryResolve = (): void => {
          const buf = Buffer.concat(chunks);
          if (buf.length >= 4) {
            const len = buf.readUInt32LE(0);
            if (buf.length >= 4 + len) {
              resolve(buf);
              return;
            }
          }
          output.once('data', (next: Buffer) => {
            chunks.push(next);
            tryResolve();
          });
        };
        tryResolve();
      });
    });

    const len = outputData.readUInt32LE(0);
    const json = JSON.parse(outputData.subarray(4, 4 + len).toString('utf-8'));
    expect(json).toEqual(response);
  });

  it('should reject message exceeding 1MB', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    protocol = new NativeMessagingProtocol(input, output);

    // Write a header with length > 1MB
    const header = Buffer.alloc(4);
    header.writeUInt32LE(1024 * 1024 + 1, 0);
    input.write(header);

    await expect(protocol.readMessage()).rejects.toMatchObject({
      code: ErrorCode.INVALID_MESSAGE,
    });
  });

  it('should reject malformed JSON', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    protocol = new NativeMessagingProtocol(input, output);

    const badJson = Buffer.from('not valid json!!!', 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(badJson.length, 0);
    input.write(Buffer.concat([header, badJson]));

    await expect(protocol.readMessage()).rejects.toMatchObject({
      code: ErrorCode.INVALID_MESSAGE,
    });
  });

  it('should handle multiple sequential messages', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    protocol = new NativeMessagingProtocol(input, output);

    const messages: BridgeMessage[] = [
      {
        type: MessageType.ENHANCE_REQUEST,
        id: 'msg-1',
        issueKey: 'PROJ-1',
        description: 'First',
        mode: 'default',
        provider: 'opencode',
      },
      {
        type: MessageType.CANCEL,
        id: 'msg-1',
      },
      {
        type: MessageType.ENHANCE_REQUEST,
        id: 'msg-2',
        issueKey: 'PROJ-2',
        description: 'Second',
        mode: 'custom',
        customPrompt: 'Be brief',
        provider: 'pi',
      },
    ];

    // Write all messages at once (tests partial read / buffer accumulation)
    const allBuffers = messages.map(encodeMessage);
    input.write(Buffer.concat(allBuffers));

    const received1 = await protocol.readMessage();
    expect(received1).toEqual(messages[0]);

    const received2 = await protocol.readMessage();
    expect(received2).toEqual(messages[1]);

    const received3 = await protocol.readMessage();
    expect(received3).toEqual(messages[2]);
  });

  it('should reject empty/zero-length message', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    protocol = new NativeMessagingProtocol(input, output);

    // Write a header with zero length
    const header = Buffer.alloc(4);
    header.writeUInt32LE(0, 0);
    input.write(header);

    await expect(protocol.readMessage()).rejects.toMatchObject({
      code: ErrorCode.INVALID_MESSAGE,
    });
  });
});
