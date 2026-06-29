import type { EnhanceRequest, JiraEnhancementFields } from '@jira-enhancer/shared';

const ContentMessageType = {
  ENHANCE_REQUEST: 'ENHANCE_REQUEST',
  ENHANCE_RESPONSE: 'ENHANCE_RESPONSE',
  ERROR: 'ERROR',
} as const;
import { detectIssueKey } from './jira-detector.js';
import {
  extractJiraDescription,
  injectEnhanceButton,
  removeEnhanceButton,
  setJiraDescription,
  updateButtonState,
} from './dom-injection.js';

interface JiraFieldIds {
  storyPoints?: string;
  acceptanceCriteria?: string;
}

type ContentMessage =
  | { type: 'GET_JIRA_DESCRIPTION' }
  | { type: 'SET_JIRA_DESCRIPTION'; description: string }
  | { type: 'SET_JIRA_FIELDS'; fields: JiraEnhancementFields; fieldIds?: JiraFieldIds };

async function putJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

async function applyPreviewWithJiraApi(
  fields: JiraEnhancementFields,
  fieldIds: JiraFieldIds = {},
): Promise<void> {
  const issueKey = detectIssueKey();
  if (!issueKey) throw new Error('Could not detect Jira issue key.');
  const { origin, hostname } = window.location;
  const isCloud = hostname.endsWith('.atlassian.net');
  if (isCloud) {
    throw new Error('Apply from Jira preview is only available for Jira Server wiki markup pages.');
  }
  const restFields: Record<string, unknown> = { description: fields.description };

  if (fieldIds.storyPoints && fields.storyPoints?.trim()) {
    const numericStoryPoints = Number(fields.storyPoints);
    restFields[fieldIds.storyPoints] = Number.isFinite(numericStoryPoints)
      ? numericStoryPoints
      : fields.storyPoints;
  }
  if (fieldIds.acceptanceCriteria && fields.acceptanceCriteria?.trim()) {
    restFields[fieldIds.acceptanceCriteria] = fields.acceptanceCriteria;
  }

  const url = `${origin}/rest/api/${isCloud ? '3' : '2'}/issue/${encodeURIComponent(issueKey)}`;
  const response = await putJson(url, { fields: restFields });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Jira save failed (${response.status}). ${text.slice(0, 240)}`);
  }
}

function showPreviewBanner(fields: JiraEnhancementFields, fieldIds?: JiraFieldIds): void {
  document.getElementById('jira-enhancer-preview-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'jira-enhancer-preview-banner';
  banner.setAttribute('role', 'status');
  Object.assign(banner.style, {
    position: 'fixed',
    zIndex: '2147483647',
    right: '16px',
    bottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    border: '1px solid #0052cc',
    borderRadius: '6px',
    background: '#ffffff',
    boxShadow: '0 8px 24px rgba(9, 30, 66, 0.25)',
    color: '#172b4d',
    font: '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });
  const label = document.createElement('span');
  label.textContent = 'Jira Enhancer preview only';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.textContent = 'Apply';
  Object.assign(apply.style, {
    padding: '6px 10px',
    border: 'none',
    borderRadius: '3px',
    background: '#0052cc',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: '600',
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  Object.assign(close.style, {
    border: 'none',
    background: 'transparent',
    color: '#42526e',
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: '18px',
  });
  close.addEventListener('click', () => banner.remove());
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    apply.textContent = 'Applying…';
    try {
      await applyPreviewWithJiraApi(fields, fieldIds);
      apply.textContent = 'Applied';
      label.textContent = 'Saved to Jira. Refresh if needed.';
    } catch (error) {
      apply.disabled = false;
      apply.textContent = 'Apply';
      label.textContent = error instanceof Error ? error.message : 'Jira save failed.';
    }
  });
  banner.append(label, apply, close);
  document.body.appendChild(banner);
}

function handleEnhanceClick(issueKey: string): void {
  updateButtonState('loading');

  const requestId = crypto.randomUUID();

  const description = extractJiraDescription();
  if (!description) {
    updateButtonState('error');
    return;
  }

  const request: EnhanceRequest = {
    type: ContentMessageType.ENHANCE_REQUEST,
    id: requestId,
    issueKey,
    description,
    mode: 'default',
    app: 'opencode',
    provider: 'opencode',
  };

  chrome.runtime.sendMessage(request);

  const listener = (message: { type: string; id: string }) => {
    if (message.id !== requestId) return;

    if (message.type === ContentMessageType.ENHANCE_RESPONSE) {
      updateButtonState('done');
      chrome.runtime.onMessage.removeListener(listener);
    } else if (message.type === ContentMessageType.ERROR) {
      updateButtonState('error');
      chrome.runtime.onMessage.removeListener(listener);
    }
  };

  chrome.runtime.onMessage.addListener(listener);
}

function tryInject(): void {
  const issueKey = detectIssueKey();
  if (!issueKey) return;

  injectEnhanceButton(() => {
    const currentIssueKey = detectIssueKey();
    if (currentIssueKey) handleEnhanceClick(currentIssueKey);
  });
}

chrome.runtime.onMessage.addListener(
  (message: ContentMessage, _sender, sendResponse: (response?: unknown) => void) => {
    if (message.type === 'GET_JIRA_DESCRIPTION') {
      sendResponse({ description: extractJiraDescription() });
      return false;
    }

    if (message.type === 'SET_JIRA_DESCRIPTION') {
      sendResponse({ ok: setJiraDescription(message.description) });
      return false;
    }

    if (message.type === 'SET_JIRA_FIELDS') {
      const descriptionApplied = setJiraDescription(message.fields.description);
      if (descriptionApplied) showPreviewBanner(message.fields, message.fieldIds);
      sendResponse({
        ok: descriptionApplied,
        applied: descriptionApplied ? ['description'] : [],
        failed: descriptionApplied ? {} : { description: 'Description field was not found.' },
      });
      return false;
    }

    return false;
  },
);

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
