#!/usr/bin/env node

import { MessageType, ErrorCode } from '@jira-enhancer/shared';
import type { ExtensionMessage } from '@jira-enhancer/shared';
import { ConfigManager } from './config-manager.js';
import { ProcessManager } from './process-manager.js';
import { NativeMessagingProtocol } from './message-protocol.js';
import { RequestHandler } from './request-handler.js';

const log = (...args: unknown[]): void => {
  process.stderr.write(`[jira-enhancer-bridge] ${args.join(' ')}\n`);
};

async function main(): Promise<void> {
  const configManager = new ConfigManager();
  await configManager.load();
  log('Config loaded');

  const processManager = new ProcessManager();
  const protocol = new NativeMessagingProtocol();
  const handler = new RequestHandler(configManager, processManager);

  const shutdown = (): void => {
    log('Shutting down');
    processManager.cleanup();
    protocol.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('uncaughtException', (err) => {
    log('Uncaught exception:', err.message);
    try {
      const errorResponse: ExtensionMessage = {
        type: MessageType.ERROR,
        id: 'uncaught',
        code: ErrorCode.UNKNOWN,
        message: err.message,
      };
      protocol.sendMessage(errorResponse);
    } catch {
      // Cannot send — protocol may be broken
    }
    process.exit(1);
  });

  log('Bridge ready, waiting for messages');

  // Message loop
  for (;;) {
    try {
      const msg = await protocol.readMessage();
      const response = await handler.handleMessage(msg, (event) => protocol.sendMessage(event));
      protocol.sendMessage(response);
    } catch (err) {
      // Stream closed or read error — exit cleanly
      if (err instanceof Error && err.message.includes('Stream ended')) {
        log('Input stream closed');
        break;
      }
      log('Error processing message:', err instanceof Error ? err.message : String(err));
      break;
    }
  }

  processManager.cleanup();
  protocol.close();
}

main().catch((err) => {
  log('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
