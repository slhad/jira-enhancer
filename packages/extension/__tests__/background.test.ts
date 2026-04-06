import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageType } from '@jira-enhancer/shared';
import type { BridgeMessage, EnhanceRequest, CancelRequest, ExtensionMessage } from '@jira-enhancer/shared';

// --- Chrome API mocks ---

type Listener = (...args: unknown[]) => void;

function makeEvent() {
  const listeners: Listener[] = [];
  return {
    addListener: vi.fn((fn: Listener) => listeners.push(fn)),
    removeListener: vi.fn((fn: Listener) => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    fire: (...args: unknown[]) => {
      for (const fn of listeners) fn(...args);
    },
  };
}

let portOnMessage: ReturnType<typeof makeEvent>;
let portOnDisconnect: ReturnType<typeof makeEvent>;
let mockPort: {
  postMessage: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof makeEvent>;
  onDisconnect: ReturnType<typeof makeEvent>;
};

let runtimeOnMessage: ReturnType<typeof makeEvent>;
let runtimeOnInstalled: ReturnType<typeof makeEvent>;

function resetChromeMocks() {
  portOnMessage = makeEvent();
  portOnDisconnect = makeEvent();
  mockPort = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: portOnMessage,
    onDisconnect: portOnDisconnect,
  };

  runtimeOnMessage = makeEvent();
  runtimeOnInstalled = makeEvent();

  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      connectNative: vi.fn(() => mockPort),
      onMessage: runtimeOnMessage,
      onInstalled: runtimeOnInstalled,
      sendMessage: vi.fn(),
      lastError: null,
    },
    tabs: {
      sendMessage: vi.fn(),
    },
  };
}

// --- Tests ---

describe('NativeMessagingClient', () => {
  beforeEach(() => {
    resetChromeMocks();
    vi.resetModules();
  });

  it('connects to the correct host name', async () => {
    const { NativeMessagingClient } = await import('../src/background/native-messaging.js');
    const client = new NativeMessagingClient();

    client.connect();

    expect(chrome.runtime.connectNative).toHaveBeenCalledWith('com.jira_enhancer.bridge');
    expect(client.isConnected()).toBe(true);
  });

  it('send() auto-connects if disconnected', async () => {
    const { NativeMessagingClient } = await import('../src/background/native-messaging.js');
    const client = new NativeMessagingClient();

    const msg: CancelRequest = { type: MessageType.CANCEL, id: 'req-1' };
    client.send(msg);

    expect(chrome.runtime.connectNative).toHaveBeenCalledWith('com.jira_enhancer.bridge');
    expect(mockPort.postMessage).toHaveBeenCalledWith(msg);
  });

  it('does not reconnect if already connected', async () => {
    const { NativeMessagingClient } = await import('../src/background/native-messaging.js');
    const client = new NativeMessagingClient();

    client.connect();
    client.connect();

    expect(chrome.runtime.connectNative).toHaveBeenCalledTimes(1);
  });

  it('forwards native messages to response handler', async () => {
    const { NativeMessagingClient } = await import('../src/background/native-messaging.js');
    const client = new NativeMessagingClient();
    const handler = vi.fn();

    client.onResponse(handler);
    client.connect();

    const response: ExtensionMessage = {
      type: MessageType.ENHANCE_RESPONSE,
      id: 'req-1',
      refinedDescription: 'Better text',
      originalDescription: 'Original',
    };
    portOnMessage.fire(response);

    expect(handler).toHaveBeenCalledWith(response);
  });

  it('disconnect triggers error handler', async () => {
    const { NativeMessagingClient } = await import('../src/background/native-messaging.js');
    const client = new NativeMessagingClient();
    const errorHandler = vi.fn();

    client.onError(errorHandler);
    client.connect();

    (chrome.runtime as unknown as Record<string, unknown>).lastError = {
      message: 'Host process exited',
    };
    portOnDisconnect.fire();

    expect(errorHandler).toHaveBeenCalledWith('Host process exited');
    expect(client.isConnected()).toBe(false);
  });

  it('disconnect clears connected state', async () => {
    const { NativeMessagingClient } = await import('../src/background/native-messaging.js');
    const client = new NativeMessagingClient();

    client.connect();
    expect(client.isConnected()).toBe(true);

    client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(mockPort.disconnect).toHaveBeenCalled();
  });
});

describe('background service worker', () => {
  beforeEach(() => {
    resetChromeMocks();
    vi.resetModules();
  });

  it('forwards ENHANCE_REQUEST to native client', async () => {
    await import('../src/background/background.js');

    const request: EnhanceRequest = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'req-1',
      issueKey: 'PROJ-123',
      description: '# Title',
      mode: 'default',
      provider: 'opencode',
    };

    const sender: chrome.runtime.MessageSender = { tab: { id: 42 } as chrome.tabs.Tab };
    runtimeOnMessage.fire(request, sender, vi.fn());

    expect(mockPort.postMessage).toHaveBeenCalledWith(request);
  });

  it('forwards CANCEL to native client', async () => {
    await import('../src/background/background.js');

    const cancel: CancelRequest = { type: MessageType.CANCEL, id: 'req-1' };
    const sender: chrome.runtime.MessageSender = {};
    runtimeOnMessage.fire(cancel, sender, vi.fn());

    expect(mockPort.postMessage).toHaveBeenCalledWith(cancel);
  });

  it('routes responses from native client to the correct tab', async () => {
    await import('../src/background/background.js');

    const request: EnhanceRequest = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'req-2',
      issueKey: 'PROJ-456',
      description: 'desc',
      mode: 'default',
      provider: 'opencode',
    };
    const sender: chrome.runtime.MessageSender = { tab: { id: 99 } as chrome.tabs.Tab };
    runtimeOnMessage.fire(request, sender, vi.fn());

    const response: ExtensionMessage = {
      type: MessageType.ENHANCE_RESPONSE,
      id: 'req-2',
      refinedDescription: 'Improved',
      originalDescription: 'desc',
    };
    portOnMessage.fire(response);

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(99, response);
  });

  it('sends error to all pending tabs on native disconnect', async () => {
    await import('../src/background/background.js');

    // Set up two pending requests from different tabs
    const req1: EnhanceRequest = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'a',
      issueKey: 'K-1',
      description: 'd1',
      mode: 'default',
      provider: 'opencode',
    };
    const req2: EnhanceRequest = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'b',
      issueKey: 'K-2',
      description: 'd2',
      mode: 'default',
      provider: 'opencode',
    };
    runtimeOnMessage.fire(req1, { tab: { id: 10 } as chrome.tabs.Tab }, vi.fn());
    runtimeOnMessage.fire(req2, { tab: { id: 20 } as chrome.tabs.Tab }, vi.fn());

    (chrome.runtime as unknown as Record<string, unknown>).lastError = {
      message: 'Disconnected',
    };
    portOnDisconnect.fire();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ type: MessageType.ERROR, id: 'a', code: 'NATIVE_HOST_ERROR' }),
    );
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      20,
      expect.objectContaining({ type: MessageType.ERROR, id: 'b', code: 'NATIVE_HOST_ERROR' }),
    );
  });

  it('logs on install', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../src/background/background.js');

    runtimeOnInstalled.fire({ reason: 'install' });

    expect(consoleSpy).toHaveBeenCalledWith('Jira Enhancer installed: install');
    consoleSpy.mockRestore();
  });
});
