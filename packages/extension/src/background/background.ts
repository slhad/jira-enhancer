import { MessageType } from '@jira-enhancer/shared';
import type { BridgeMessage, ExtensionMessage, ErrorResponse } from '@jira-enhancer/shared';
import { NativeMessagingClient } from './native-messaging.js';

const client = new NativeMessagingClient();
const pendingRequests = new Map<string, number>();

client.onResponse((msg: ExtensionMessage) => {
  const tabId = pendingRequests.get(msg.id);
  if (tabId !== undefined) {
    chrome.tabs.sendMessage(tabId, msg);
    if (msg.type === MessageType.ENHANCE_RESPONSE || msg.type === MessageType.ERROR) {
      pendingRequests.delete(msg.id);
    }
  }
});

client.onError((error: string) => {
  for (const [id, tabId] of pendingRequests) {
    const errorMsg: ErrorResponse = {
      type: MessageType.ERROR,
      id,
      code: 'NATIVE_HOST_ERROR',
      message: error,
    };
    chrome.tabs.sendMessage(tabId, errorMsg);
  }
  pendingRequests.clear();
});

chrome.runtime.onMessage.addListener(
  (message: BridgeMessage, sender: chrome.runtime.MessageSender, _sendResponse: (response?: unknown) => void) => {
    if (message.type === MessageType.ENHANCE_REQUEST || message.type === MessageType.CANCEL) {
      if (message.type === MessageType.ENHANCE_REQUEST && sender.tab?.id !== undefined) {
        pendingRequests.set(message.id, sender.tab.id);
      }
      client.send(message);
      return true;
    }
    return false;
  },
);

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`Jira Enhancer installed: ${details.reason}`);
});
