import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageType } from '@jira-enhancer/shared';
import type { EnhanceRequest, CancelRequest, ExtensionMessage } from '@jira-enhancer/shared';

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
      getURL: vi.fn((path = '') => `chrome-extension://extension-id/${path}`),
      onMessage: runtimeOnMessage,
      onInstalled: runtimeOnInstalled,
      sendMessage: vi.fn(),
      lastError: null,
    },
    tabs: {
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn((_key: string, callback: (result: Record<string, unknown>) => void) =>
          callback({}),
        ),
        set: vi.fn(),
      },
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

  it('acknowledges popup-originated enhancement requests and broadcasts final responses', async () => {
    await import('../src/background/background.js');

    const request: EnhanceRequest = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'popup-1',
      issueKey: 'PROJ-456',
      description: 'desc',
      mode: 'default',
      provider: 'opencode',
    };
    const sendResponse = vi.fn();
    runtimeOnMessage.fire(request, {}, sendResponse);

    const response: ExtensionMessage = {
      type: MessageType.ENHANCE_RESPONSE,
      id: 'popup-1',
      refinedDescription: 'Improved',
      originalDescription: 'desc',
    };
    expect(sendResponse).toHaveBeenCalledWith({
      type: MessageType.STATUS,
      id: 'popup-1',
      status: 'processing',
      progress: undefined,
    });

    portOnMessage.fire(response);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(response);
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

  it('returns stored enhancement state for matching issue', async () => {
    const stored = {
      issueKey: 'K-1',
      requestId: 'req-state',
      status: 'processing',
      progress: 25,
    };
    resetChromeMocks();
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: string, callback: (result: Record<string, unknown>) => void) =>
        callback({ 'jiraEnhancer.enhancementState': stored }),
    );
    await import('../src/background/background.js');

    const sendResponse = vi.fn();
    runtimeOnMessage.fire(
      { type: MessageType.GET_ENHANCEMENT_STATE, issueKey: 'K-1' },
      {},
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({ type: MessageType.ENHANCEMENT_STATE, ...stored });
  });

  it('returns empty enhancement state for a different issue', async () => {
    resetChromeMocks();
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: string, callback: (result: Record<string, unknown>) => void) =>
        callback({
          'jiraEnhancer.enhancementState': { issueKey: 'OTHER-1', status: 'processing' },
        }),
    );
    await import('../src/background/background.js');

    const sendResponse = vi.fn();
    runtimeOnMessage.fire(
      { type: MessageType.GET_ENHANCEMENT_STATE, issueKey: 'K-1' },
      {},
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      type: MessageType.ENHANCEMENT_STATE,
      issueKey: 'K-1',
    });
  });

  it('updates stored state for harness events, status, responses, and errors', async () => {
    let stored: Record<string, unknown> = { requestId: 'req-flow', status: 'processing' };
    resetChromeMocks();
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: string, callback: (result: Record<string, unknown>) => void) =>
        callback({ 'jiraEnhancer.enhancementState': stored }),
    );
    (chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (value: Record<string, unknown>) => {
        stored = value['jiraEnhancer.enhancementState'] as Record<string, unknown>;
      },
    );
    await import('../src/background/background.js');

    const request: EnhanceRequest = {
      type: MessageType.ENHANCE_REQUEST,
      id: 'req-flow',
      issueKey: 'K-1',
      description: 'desc',
      mode: 'default',
      provider: 'opencode',
    };
    runtimeOnMessage.fire(request, { tab: { id: 1 } as chrome.tabs.Tab }, vi.fn());

    portOnMessage.fire({
      type: MessageType.HARNESS_EVENT,
      id: 'req-flow',
      timestamp: 1,
      app: 'pi',
      kind: 'status',
      text: 'started',
    });
    expect(stored.events).toHaveLength(1);

    portOnMessage.fire({
      type: MessageType.STATUS,
      id: 'req-flow',
      status: 'refining',
      progress: 50,
    });
    expect(stored).toMatchObject({ status: 'refining', progress: 50 });

    portOnMessage.fire({ type: MessageType.ERROR, id: 'req-flow', code: 'X', message: 'boom' });
    expect(stored).toMatchObject({ status: 'error', error: 'boom', progress: undefined });

    // Re-add pending request because ERROR is final and removes it.
    runtimeOnMessage.fire(request, { tab: { id: 1 } as chrome.tabs.Tab }, vi.fn());
    portOnMessage.fire({
      type: MessageType.ENHANCE_RESPONSE,
      id: 'req-flow',
      refinedDescription: 'better',
      originalDescription: 'desc',
      originalFields: { description: 'desc' },
      enhancedFields: { description: 'better' },
    });
    expect(stored).toMatchObject({
      status: 'complete',
      refinedDescription: 'better',
      originalDescription: 'desc',
      error: undefined,
    });
  });

  it('broadcasts non-final runtime responses for direct runtime requests', async () => {
    await import('../src/background/background.js');

    const sendResponse = vi.fn();
    runtimeOnMessage.fire(
      { type: MessageType.LIST_MODELS_REQUEST, id: 'runtime-status', app: 'pi' },
      {},
      sendResponse,
    );
    const status = { type: MessageType.STATUS, id: 'runtime-status', status: 'processing' };
    portOnMessage.fire(status);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(status);
  });

  it('responds to list model requests from extension tabs through the runtime callback', async () => {
    await import('../src/background/background.js');

    const message = { type: MessageType.LIST_MODELS_REQUEST, id: 'full-page-models', app: 'pi' };
    const response = {
      type: MessageType.LIST_MODELS_RESPONSE,
      id: 'full-page-models',
      app: 'pi',
      models: [{ provider: 'openai', model: 'gpt-4.1' }],
    };
    const sendResponse = vi.fn();
    runtimeOnMessage.fire(message, { tab: { id: 42 } as chrome.tabs.Tab }, sendResponse);
    portOnMessage.fire(response);

    expect(sendResponse).toHaveBeenCalledWith(response);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(42, response);
  });

  it('broadcasts full-page subtask generation responses to extension runtime listeners', async () => {
    await import('../src/background/background.js');

    const message = {
      type: MessageType.GENERATE_SUBTASKS_REQUEST,
      id: 'full-page-subtasks',
      issueKey: 'PROJ-123',
      fields: { description: 'desc' },
      provider: 'opencode',
    };
    const response = {
      type: MessageType.GENERATE_SUBTASKS_RESPONSE,
      id: 'full-page-subtasks',
      result: { issueKey: 'PROJ-123', subtasks: [] },
    };
    const sendResponse = vi.fn();
    runtimeOnMessage.fire(
      message,
      {
        tab: { id: 42 } as chrome.tabs.Tab,
        url: 'chrome-extension://extension-id/src/full-page/index.html',
      },
      sendResponse,
    );
    portOnMessage.fire(response);

    expect(sendResponse).toHaveBeenCalledWith({
      type: MessageType.STATUS,
      id: 'full-page-subtasks',
      status: 'processing',
      progress: undefined,
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(response);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(42, response);
  });

  it('responds to runtime list, save image, and debug requests directly', async () => {
    await import('../src/background/background.js');
    for (const [message, response] of [
      [
        { type: MessageType.LIST_MODELS_REQUEST, id: 'models', app: 'pi' },
        { type: MessageType.LIST_MODELS_RESPONSE, id: 'models', app: 'pi', models: [] },
      ],
      [
        { type: MessageType.SAVE_IMAGES_REQUEST, id: 'images', images: [] },
        { type: MessageType.SAVE_IMAGES_RESPONSE, id: 'images', images: [] },
      ],
      [
        { type: MessageType.DEBUG_LOG_REQUEST, id: 'debug', source: 'test', payload: {} },
        { type: MessageType.DEBUG_LOG_RESPONSE, id: 'debug', ok: false, path: '' },
      ],
    ] as const) {
      const sendResponse = vi.fn();
      runtimeOnMessage.fire(message, {}, sendResponse);
      portOnMessage.fire(response);
      expect(sendResponse).toHaveBeenCalledWith(response);
    }
  });

  it('clears matching enhancement state on cancel', async () => {
    let stored: Record<string, unknown> = {
      requestId: 'cancel-me',
      status: 'processing',
      error: 'x',
    };
    resetChromeMocks();
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_key: string, callback: (result: Record<string, unknown>) => void) =>
        callback({ 'jiraEnhancer.enhancementState': stored }),
    );
    (chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (value: Record<string, unknown>) => {
        stored = value['jiraEnhancer.enhancementState'] as Record<string, unknown>;
      },
    );
    await import('../src/background/background.js');

    runtimeOnMessage.fire({ type: MessageType.CANCEL, id: 'cancel-me' }, {}, vi.fn());

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: MessageType.CANCEL,
      id: 'cancel-me',
    });
    expect(stored).toMatchObject({ status: 'idle', progress: undefined, error: undefined });
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
