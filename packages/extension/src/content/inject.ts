import { MessageType } from '@jira-enhancer/shared';
import type { EnhanceRequest } from '@jira-enhancer/shared';
import { detectIssueKey } from './jira-detector.js';
import { injectEnhanceButton, updateButtonState, removeEnhanceButton } from './dom-injection.js';

function handleEnhanceClick(issueKey: string): void {
  updateButtonState('loading');

  const requestId = crypto.randomUUID();

  const request: EnhanceRequest = {
    type: MessageType.ENHANCE_REQUEST,
    id: requestId,
    issueKey,
    description: '',
    mode: 'default',
    provider: 'opencode',
  };

  chrome.runtime.sendMessage(request);

  const listener = (message: { type: string; id: string }) => {
    if (message.id !== requestId) return;

    if (message.type === MessageType.ENHANCE_RESPONSE) {
      updateButtonState('done');
      chrome.runtime.onMessage.removeListener(listener);
    } else if (message.type === MessageType.ERROR) {
      updateButtonState('error');
      chrome.runtime.onMessage.removeListener(listener);
    }
  };

  chrome.runtime.onMessage.addListener(listener);
}

function tryInject(): void {
  const issueKey = detectIssueKey();
  if (!issueKey) return;

  injectEnhanceButton(() => handleEnhanceClick(issueKey));
}

function init(): void {
  tryInject();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const btn = document.getElementById('jira-enhancer-btn');
      if (!btn) {
        removeEnhanceButton();
        tryInject();
      }
    }, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

init();
