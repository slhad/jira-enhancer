import { MessageType } from '@jira-enhancer/shared';
import type {
  BridgeMessage,
  ExtensionMessage,
  ErrorResponse,
  GetEnhancementStateRequest,
} from '@jira-enhancer/shared';
import { NativeMessagingClient } from './native-messaging.js';

const client = new NativeMessagingClient();

type PendingRequest =
  | { kind: 'tab'; tabId: number }
  | { kind: 'runtime'; sendResponse: (response?: unknown) => void }
  | { kind: 'runtime-broadcast' };

const pendingRequests = new Map<string, PendingRequest>();
const ENHANCEMENT_STATE_KEY = 'jiraEnhancer.enhancementState';

interface StoredEnhancementState {
  issueKey?: string;
  requestId?: string;
  status?: 'idle' | 'processing' | 'exploring' | 'refining' | 'complete' | 'error';
  progress?: number;
  originalDescription?: string;
  refinedDescription?: string;
  originalFields?: import('@jira-enhancer/shared').JiraEnhancementFields;
  enhancedFields?: import('@jira-enhancer/shared').StructuredEnhancementResult;
  sessionRef?: import('@jira-enhancer/shared').HarnessSessionRef;
  error?: string;
  events?: ExtensionMessage[];
}

function saveEnhancementState(state: StoredEnhancementState): void {
  chrome.storage.local.set({ [ENHANCEMENT_STATE_KEY]: state });
}

function getEnhancementState(
  issueKey: string | undefined,
  sendResponse: (response?: unknown) => void,
): void {
  chrome.storage.local.get(ENHANCEMENT_STATE_KEY, (result) => {
    const state = (result[ENHANCEMENT_STATE_KEY] ?? {}) as StoredEnhancementState;
    if (issueKey && state.issueKey && state.issueKey !== issueKey) {
      sendResponse({ type: MessageType.ENHANCEMENT_STATE, issueKey });
      return;
    }
    sendResponse({ type: MessageType.ENHANCEMENT_STATE, ...state });
  });
}

function isFinalResponse(msg: ExtensionMessage): boolean {
  return (
    msg.type === MessageType.ENHANCE_RESPONSE ||
    msg.type === MessageType.GENERATE_SUBTASKS_RESPONSE ||
    msg.type === MessageType.ERROR ||
    msg.type === MessageType.LIST_MODELS_RESPONSE ||
    msg.type === MessageType.SAVE_IMAGES_RESPONSE ||
    msg.type === MessageType.DEBUG_LOG_RESPONSE
  );
}

function deliverResponse(target: PendingRequest, msg: ExtensionMessage): void {
  if (target.kind === 'tab') {
    chrome.tabs.sendMessage(target.tabId, msg);
    return;
  }

  if (target.kind === 'runtime-broadcast') {
    chrome.runtime.sendMessage(msg);
    return;
  }

  if (isFinalResponse(msg)) {
    target.sendResponse(msg);
  } else {
    chrome.runtime.sendMessage(msg);
  }
}

client.onResponse((msg: ExtensionMessage) => {
  const target = pendingRequests.get(msg.id);
  if (!target) return;

  if (msg.type === MessageType.HARNESS_EVENT) {
    chrome.storage.local.get(ENHANCEMENT_STATE_KEY, (result) => {
      const current = (result[ENHANCEMENT_STATE_KEY] ?? {}) as StoredEnhancementState;
      if (current.requestId === msg.id) {
        saveEnhancementState({
          ...current,
          events: [...(current.events ?? []), msg],
        });
      }
    });
  } else if (msg.type === MessageType.STATUS) {
    chrome.storage.local.get(ENHANCEMENT_STATE_KEY, (result) => {
      const current = (result[ENHANCEMENT_STATE_KEY] ?? {}) as StoredEnhancementState;
      if (current.requestId === msg.id) {
        saveEnhancementState({ ...current, status: msg.status, progress: msg.progress });
      }
    });
  } else if (msg.type === MessageType.ENHANCE_RESPONSE) {
    chrome.storage.local.get(ENHANCEMENT_STATE_KEY, (result) => {
      const current = (result[ENHANCEMENT_STATE_KEY] ?? {}) as StoredEnhancementState;
      saveEnhancementState({
        ...current,
        requestId: msg.id,
        status: 'complete',
        progress: undefined,
        originalDescription: msg.originalDescription,
        refinedDescription: msg.refinedDescription,
        originalFields: msg.originalFields,
        enhancedFields: msg.enhancedFields,
        sessionRef: msg.sessionRef,
        error: undefined,
      });
    });
  } else if (msg.type === MessageType.ERROR) {
    chrome.storage.local.get(ENHANCEMENT_STATE_KEY, (result) => {
      const current = (result[ENHANCEMENT_STATE_KEY] ?? {}) as StoredEnhancementState;
      if (current.requestId === msg.id) {
        saveEnhancementState({
          ...current,
          status: 'error',
          progress: undefined,
          error: msg.message,
        });
      }
    });
  }

  deliverResponse(target, msg);
  if (isFinalResponse(msg)) {
    pendingRequests.delete(msg.id);
  }
});

client.onError((error: string) => {
  for (const [id, target] of pendingRequests) {
    const errorMsg: ErrorResponse = {
      type: MessageType.ERROR,
      id,
      code: 'NATIVE_HOST_ERROR',
      message: error,
    };
    deliverResponse(target, errorMsg);
  }
  pendingRequests.clear();
});

chrome.runtime.onMessage.addListener(
  (
    message: BridgeMessage | GetEnhancementStateRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (message.type === MessageType.GET_ENHANCEMENT_STATE) {
      getEnhancementState(message.issueKey, sendResponse);
      return true;
    }

    if (
      message.type === MessageType.ENHANCE_REQUEST ||
      message.type === MessageType.GENERATE_SUBTASKS_REQUEST ||
      message.type === MessageType.LIST_MODELS_REQUEST ||
      message.type === MessageType.SAVE_IMAGES_REQUEST ||
      message.type === MessageType.DEBUG_LOG_REQUEST
    ) {
      if (message.type === MessageType.LIST_MODELS_REQUEST) {
        pendingRequests.set(message.id, { kind: 'runtime', sendResponse });
      } else if (sender.tab?.id !== undefined) {
        pendingRequests.set(message.id, { kind: 'tab', tabId: sender.tab.id });
      } else if (
        message.type === MessageType.ENHANCE_REQUEST ||
        message.type === MessageType.GENERATE_SUBTASKS_REQUEST
      ) {
        pendingRequests.set(message.id, { kind: 'runtime-broadcast' });
        sendResponse({
          type: MessageType.STATUS,
          id: message.id,
          status: 'processing',
          progress: undefined,
        });
      } else {
        pendingRequests.set(message.id, { kind: 'runtime', sendResponse });
      }
      if (message.type === MessageType.ENHANCE_REQUEST) {
        saveEnhancementState({
          issueKey: message.issueKey,
          requestId: message.id,
          status: 'processing',
          progress: undefined,
          originalDescription: message.description,
          originalFields: message.fields,
        });
      }
      client.send(message);
      return true;
    }

    if (message.type === MessageType.CANCEL) {
      chrome.storage.local.get(ENHANCEMENT_STATE_KEY, (result) => {
        const current = (result[ENHANCEMENT_STATE_KEY] ?? {}) as StoredEnhancementState;
        if (current.requestId === message.id) {
          saveEnhancementState({
            ...current,
            status: 'idle',
            progress: undefined,
            error: undefined,
          });
        }
      });
      pendingRequests.delete(message.id);
      client.send(message);
      return false;
    }

    return false;
  },
);

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`Jira Enhancer installed: ${details.reason}`);
});
