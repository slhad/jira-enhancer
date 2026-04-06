import type { BridgeMessage, ExtensionMessage } from '@jira-enhancer/shared';

const NATIVE_HOST = 'com.jira_enhancer.bridge';

export class NativeMessagingClient {
  private port: chrome.runtime.Port | null = null;
  private responseHandler: ((msg: ExtensionMessage) => void) | null = null;
  private errorHandler: ((error: string) => void) | null = null;

  connect(): void {
    if (this.port) return;

    this.port = chrome.runtime.connectNative(NATIVE_HOST);

    this.port.onMessage.addListener((msg: ExtensionMessage) => {
      this.responseHandler?.(msg);
    });

    this.port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message ?? 'Native host disconnected';
      this.port = null;
      this.errorHandler?.(error);
    });
  }

  disconnect(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }

  send(msg: BridgeMessage): void {
    if (!this.port) {
      this.connect();
    }
    this.port!.postMessage(msg);
  }

  onResponse(handler: (msg: ExtensionMessage) => void): void {
    this.responseHandler = handler;
  }

  onError(handler: (error: string) => void): void {
    this.errorHandler = handler;
  }

  isConnected(): boolean {
    return this.port !== null;
  }
}
