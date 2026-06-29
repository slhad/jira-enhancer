import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import {
  adfToMarkdown,
  buildEnhancementPrompt,
  markdownToAdf,
  markdownToJiraMarkup,
  jiraMarkupToMarkdown,
  MessageType,
} from '@jira-enhancer/shared';
import type {
  EnhanceMode,
  EnhancementFieldKey,
  HarnessEvent,
  HarnessSafetyMode,
  ImageAttachment,
  JiraEnhancementFields,
  LlmApp,
  SaveImagesResponse,
  SavedImage,
  GeneratedSubtask,
  HarnessSessionRef,
  SubtaskGenerationResult,
} from '@jira-enhancer/shared';
import { useRefinement } from './hooks/useRefinement';
import { useSubtaskGeneration } from './hooks/useSubtaskGeneration';
import { EnhancePanel } from './components/EnhancePanel';
import { SubtaskPanel } from './components/SubtaskPanel';
import { MarkdownEditor } from './components/MarkdownEditor';
import { ConverterLab } from './components/ConverterLab';

type View =
  | 'enhance'
  | 'subtasks'
  | 'subtask-activity'
  | 'subtask-review'
  | 'review-request'
  | 'activity'
  | 'diff'
  | 'edit'
  | 'history'
  | 'converter-lab';

type PopupProps = {
  fullPage?: boolean;
};

interface PendingEnhancement {
  mode: EnhanceMode;
  app: LlmApp;
  modelProvider?: string;
  model?: string;
  launchPath?: string;
  customPrompt?: string;
  env?: Record<string, string>;
  safetyMode?: HarnessSafetyMode;
}

interface ProcessingRow {
  kind: string;
  label: string;
  text: string;
  timestamp: number;
}

interface StoredEnhancementResult {
  id: string;
  issueKey: string;
  createdAt: number;
  originalDescription: string;
  refinedDescription: string;
  originalFields: JiraEnhancementFields;
  enhancedFields: JiraEnhancementFields & { notes?: string };
  modelProvider?: string;
  model?: string;
  sessionRef?: HarnessSessionRef;
}

interface StoredSubtaskGeneration {
  id: string;
  issueKey: string;
  createdAt: number;
  result: SubtaskGenerationResult;
  modelProvider?: string;
  model?: string;
  sessionRef?: HarnessSessionRef;
}

interface StoredPreviewState {
  issueKey: string;
  sourceId: string;
  fields: JiraEnhancementFields;
  createdAt: number;
}

type HistorySource = 'local' | 'jira';

interface HistoryEntry {
  id: string;
  source: HistorySource;
  createdAt: number;
  title: string;
  subtitle?: string;
  fields: JiraEnhancementFields;
  changedFields: EnhancementFieldKey[];
  summary: string;
}

interface JiraChangelogItem {
  field?: string;
  fieldId?: string;
  fromString?: string | null;
  toString?: string | null;
}

interface JiraChangelogHistory {
  id?: string;
  created?: string;
  author?: { displayName?: string; name?: string; emailAddress?: string };
  items?: JiraChangelogItem[];
}

interface JiraChangelogResponse {
  values?: JiraChangelogHistory[];
  histories?: JiraChangelogHistory[];
  changelog?: { histories?: JiraChangelogHistory[]; values?: JiraChangelogHistory[] };
}

interface JiraFieldIds {
  storyPoints?: string;
  acceptanceCriteria?: string;
}

interface FullPageSession {
  sourceTabId: number;
  sourceTabUrl: string | null;
  issueKey: string | null;
  description: string;
  storyPoints: string;
  acceptanceCriteria: string;
  components: string[];
  issueType: string | null;
  fieldIds?: JiraFieldIds;
  images: ImageAttachment[];
  pendingEnhancement: PendingEnhancement;
}

const JIRA_ISSUE_PATTERN = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/;

function fieldsToJiraMarkup(fields: JiraEnhancementFields): JiraEnhancementFields {
  return {
    description: markdownToJiraMarkup(fields.description),
    ...('acceptanceCriteria' in fields
      ? { acceptanceCriteria: markdownToJiraMarkup(fields.acceptanceCriteria ?? '') }
      : {}),
    ...('storyPoints' in fields ? { storyPoints: fields.storyPoints ?? '' } : {}),
  };
}

function appendReadableDelta(current: string, delta: string): string {
  return `${current}${delta}`;
}

function getProcessingRows(events: HarnessEvent[]): ProcessingRow[] {
  return events.reduce<ProcessingRow[]>((rows, event) => {
    if (
      event.kind !== 'message' &&
      event.kind !== 'tool_call' &&
      event.kind !== 'tool_result' &&
      event.kind !== 'final'
    ) {
      return rows;
    }

    const label = event.text.startsWith('Thinking:')
      ? 'thinking'
      : event.kind === 'tool_call'
        ? 'tool call'
        : event.kind === 'tool_result'
          ? 'tool result'
          : event.kind === 'final'
            ? 'final'
            : 'assistant';
    const text = event.text.replace(/^Thinking:\s*/, '');
    const previous = rows.at(-1);
    if (previous && (label === 'thinking' || label === 'assistant') && previous.label === label) {
      previous.text = appendReadableDelta(previous.text, text);
      previous.timestamp = event.timestamp;
      return rows;
    }

    if (
      previous &&
      (label === 'tool call' || label === 'tool result') &&
      previous.label === label
    ) {
      previous.text = `${previous.text}  •  ${text}`;
      previous.timestamp = event.timestamp;
      return rows;
    }

    rows.push({ kind: label.replace(' ', '-'), label, text, timestamp: event.timestamp });
    return rows;
  }, []);
}

function historyStorageKey(issueKey: string): string {
  return `jiraEnhancer.resultHistory.${issueKey}`;
}

function subtaskHistoryStorageKey(issueKey: string): string {
  return `jiraEnhancer.subtaskHistory.${issueKey}`;
}

function previewStorageKey(issueKey: string): string {
  return `jiraEnhancer.previewState.${issueKey}`;
}

function popupViewStorageKey(issueKey: string): string {
  return `jiraEnhancer.popupView.${issueKey}`;
}

function historyScrollStorageKey(issueKey: string): string {
  return `jiraEnhancer.historyScroll.${issueKey}`;
}

function loadResultHistory(issueKey: string): StoredEnhancementResult[] {
  try {
    return JSON.parse(
      localStorage.getItem(historyStorageKey(issueKey)) ?? '[]',
    ) as StoredEnhancementResult[];
  } catch {
    return [];
  }
}

function saveSubtaskGenerationToHistory(
  result: StoredSubtaskGeneration,
): StoredSubtaskGeneration[] {
  const existing = loadSubtaskHistory(result.issueKey);
  const next = [result, ...existing.filter((item) => item.id !== result.id)].slice(0, 20);
  localStorage.setItem(subtaskHistoryStorageKey(result.issueKey), JSON.stringify(next));
  return next;
}

function loadSubtaskHistory(issueKey: string): StoredSubtaskGeneration[] {
  try {
    return JSON.parse(
      localStorage.getItem(subtaskHistoryStorageKey(issueKey)) ?? '[]',
    ) as StoredSubtaskGeneration[];
  } catch {
    return [];
  }
}

function saveResultToHistory(result: StoredEnhancementResult): StoredEnhancementResult[] {
  const existing = loadResultHistory(result.issueKey);
  const next = [result, ...existing.filter((item) => item.id !== result.id)].slice(0, 20);
  localStorage.setItem(historyStorageKey(result.issueKey), JSON.stringify(next));
  return next;
}

function loadPreviewState(issueKey: string): StoredPreviewState | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(previewStorageKey(issueKey)) ?? 'null',
    ) as StoredPreviewState | null;
    return parsed?.issueKey === issueKey ? parsed : null;
  } catch {
    return null;
  }
}

function savePreviewState(state: StoredPreviewState): void {
  localStorage.setItem(previewStorageKey(state.issueKey), JSON.stringify(state));
}

function clearPreviewState(issueKey: string): void {
  localStorage.removeItem(previewStorageKey(issueKey));
}

function extractIssueKey(url: string): string | null {
  const match = url.match(JIRA_ISSUE_PATTERN);
  return match ? match[1] : null;
}

interface PageDescriptionResult {
  description: string;
  images: ImageAttachment[];
  storyPoints?: string | null;
  acceptanceCriteria?: string | null;
}

interface JiraIssueDescriptionResponse {
  names?: Record<string, string>;
  fields?: {
    description?: unknown;
    components?: Array<{ name?: string }>;
    issuetype?: { name?: string };
    [fieldId: string]: unknown;
  };
}

interface JiraIssueData {
  description: string | null;
  components: string[];
  issueType: string | null;
  storyPoints: string | null;
  acceptanceCriteria: string | null;
  fieldIds: JiraFieldIds;
}

const STORY_POINTS_FIELD_NAMES = new Set(['story points', 'story point estimate']);
const ACCEPTANCE_CRITERIA_FIELD_NAMES = new Set(['acceptance criteria']);

function normalizeJiraFieldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWantedFieldName(name: string, wantedNames: Set<string>): boolean {
  const normalized = normalizeJiraFieldName(name);
  if (wantedNames.has(normalized)) return true;
  if (wantedNames === STORY_POINTS_FIELD_NAMES) return normalized.includes('story point');
  if (wantedNames === ACCEPTANCE_CRITERIA_FIELD_NAMES)
    return normalized.includes('acceptance criteria');
  return false;
}

export function stringifyJiraFieldValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const text = value.map(stringifyJiraFieldValue).filter(Boolean).join('\n');
    return text.trim() || null;
  }
  if (value && typeof value === 'object') {
    const objectValue = value as {
      type?: unknown;
      value?: unknown;
      name?: unknown;
      content?: unknown;
    };
    if (objectValue.type === 'doc') return adfToMarkdown(value).trim() || null;
    if (typeof objectValue.value === 'string') return objectValue.value.trim() || null;
    if (typeof objectValue.name === 'string') return objectValue.name.trim() || null;
  }
  return null;
}

function findFieldIdByName(
  data: JiraIssueDescriptionResponse,
  wantedNames: Set<string>,
): string | null {
  const namedFields = Object.entries(data.names ?? {});
  const matchingFields = [
    ...namedFields.filter(([, name]) => wantedNames.has(normalizeJiraFieldName(name))),
    ...namedFields.filter(([, name]) => isWantedFieldName(name, wantedNames)),
  ];
  return matchingFields[0]?.[0] ?? null;
}

export function findFieldByName(
  data: JiraIssueDescriptionResponse,
  wantedNames: Set<string>,
): string | null {
  const namedFields = Object.entries(data.names ?? {});
  const matchingFields = [
    ...namedFields.filter(([, name]) => wantedNames.has(normalizeJiraFieldName(name))),
    ...namedFields.filter(([, name]) => isWantedFieldName(name, wantedNames)),
  ];

  for (const [fieldId] of matchingFields) {
    const value = stringifyJiraFieldValue(data.fields?.[fieldId]);
    if (value) return value;
  }
  return null;
}

export function buildDescriptionWithIssueFields(issueData: JiraIssueData): string | null {
  const sections = [
    issueData.description,
    issueData.storyPoints ? `Story Points: ${issueData.storyPoints}` : null,
    issueData.acceptanceCriteria ? `Acceptance Criteria:\n${issueData.acceptanceCriteria}` : null,
  ].filter(Boolean);
  return sections.length > 0 ? sections.join('\n\n') : null;
}

function fieldsFromJiraIssueData(issueData: JiraIssueData): JiraEnhancementFields {
  return {
    description: issueData.description ?? '',
    ...(issueData.acceptanceCriteria ? { acceptanceCriteria: issueData.acceptanceCriteria } : {}),
    ...(issueData.storyPoints ? { storyPoints: issueData.storyPoints } : {}),
  };
}

function getFieldKeyForChangelogItem(
  item: JiraChangelogItem,
  ids: JiraFieldIds,
): EnhancementFieldKey | null {
  const fieldId = item.fieldId?.trim();
  const fieldName = normalizeJiraFieldName(item.field ?? '');
  if (fieldId === 'description' || fieldName === 'description') return 'description';
  if (fieldId && ids.storyPoints && fieldId === ids.storyPoints) return 'storyPoints';
  if (fieldId && ids.acceptanceCriteria && fieldId === ids.acceptanceCriteria)
    return 'acceptanceCriteria';
  if (isWantedFieldName(item.field ?? '', STORY_POINTS_FIELD_NAMES)) return 'storyPoints';
  if (isWantedFieldName(item.field ?? '', ACCEPTANCE_CRITERIA_FIELD_NAMES))
    return 'acceptanceCriteria';
  return null;
}

function shortenText(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function formatHistoryFieldLabel(field: EnhancementFieldKey): string {
  if (field === 'acceptanceCriteria') return 'Acceptance Criteria';
  if (field === 'storyPoints') return 'Story Points';
  return 'Description';
}

function getChangelogHistories(data: JiraChangelogResponse): JiraChangelogHistory[] {
  return data.values ?? data.histories ?? data.changelog?.histories ?? data.changelog?.values ?? [];
}

function normalizeHistoryValue(value: string | undefined): string {
  return (value ?? '').replace(/\r\n/g, '\n').trim();
}

export function parseJiraChangelogEntries(
  data: JiraChangelogResponse,
  ids: JiraFieldIds = {},
  currentFields: JiraEnhancementFields = { description: '' },
): HistoryEntry[] {
  return getChangelogHistories(data).flatMap((history, index) => {
    const changes = (history.items ?? [])
      .map((item) => ({ item, fieldKey: getFieldKeyForChangelogItem(item, ids) }))
      .filter((change): change is { item: JiraChangelogItem; fieldKey: EnhancementFieldKey } =>
        Boolean(change.fieldKey),
      );
    if (changes.length === 0) return [];

    const fields: JiraEnhancementFields = { ...currentFields };
    const changedFields: EnhancementFieldKey[] = [];
    for (const { item, fieldKey } of changes) {
      fields[fieldKey] = item.fromString ?? '';
      if (!changedFields.includes(fieldKey)) changedFields.push(fieldKey);
    }
    if (
      changedFields.every(
        (fieldKey) =>
          normalizeHistoryValue(fields[fieldKey]) ===
          normalizeHistoryValue(currentFields[fieldKey]),
      )
    ) {
      return [];
    }

    const createdAt = history.created ? Date.parse(history.created) : Date.now() - index;
    const author =
      history.author?.displayName ?? history.author?.name ?? history.author?.emailAddress ?? 'Jira';
    const summary = changes
      .map(({ item, fieldKey }) => {
        const before = shortenText(item.fromString ?? '(empty)', 90);
        const after = shortenText(item.toString ?? '(empty)', 90);
        return `${formatHistoryFieldLabel(fieldKey)}: ${before} → ${after}`;
      })
      .join('\n');
    return [
      {
        id: `jira-${history.id ?? createdAt}-${index}`,
        source: 'jira' as const,
        createdAt,
        title: `Jira change by ${author}`,
        subtitle: history.created ? new Date(createdAt).toLocaleString() : undefined,
        fields,
        changedFields,
        summary,
      },
    ];
  });
}

async function fetchJiraChangelogEntries(
  issueKey: string,
  pageUrl: string,
  ids: JiraFieldIds,
  currentFields: JiraEnhancementFields,
): Promise<HistoryEntry[]> {
  const { origin, hostname } = new URL(pageUrl);
  const apiVersion = hostname.endsWith('.atlassian.net') ? '3' : '2';
  const changelogResponse = await fetch(
    `${origin}/rest/api/${apiVersion}/issue/${encodeURIComponent(issueKey)}/changelog?maxResults=50`,
    { credentials: 'include' },
  );
  if (changelogResponse.ok) {
    return parseJiraChangelogEntries(
      (await changelogResponse.json()) as JiraChangelogResponse,
      ids,
      currentFields,
    );
  }

  const expandedResponse = await fetch(
    `${origin}/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=none&expand=changelog`,
    { credentials: 'include' },
  );
  if (!expandedResponse.ok) {
    const text = await expandedResponse.text().catch(() => '');
    throw new Error(
      `Jira changelog read failed (${expandedResponse.status}). ${text.slice(0, 160)}`,
    );
  }
  return parseJiraChangelogEntries(
    (await expandedResponse.json()) as JiraChangelogResponse,
    ids,
    currentFields,
  );
}

async function fetchRawJiraIssueData(issueKey: string, pageUrl: string): Promise<JiraIssueData> {
  const { origin } = new URL(pageUrl);
  const response = await fetch(
    `${origin}/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=*all&expand=names`,
    { credentials: 'include' },
  );
  if (!response.ok) {
    return {
      description: null,
      components: [],
      issueType: null,
      storyPoints: null,
      acceptanceCriteria: null,
      fieldIds: {},
    };
  }

  const data = (await response.json()) as JiraIssueDescriptionResponse;
  return {
    description: stringifyJiraFieldValue(data.fields?.description),
    components: data.fields?.components?.flatMap((component) => component.name ?? []) ?? [],
    issueType: data.fields?.issuetype?.name ?? null,
    storyPoints: findFieldByName(data, STORY_POINTS_FIELD_NAMES),
    acceptanceCriteria: findFieldByName(data, ACCEPTANCE_CRITERIA_FIELD_NAMES),
    fieldIds: {
      storyPoints: findFieldIdByName(data, STORY_POINTS_FIELD_NAMES) ?? undefined,
      acceptanceCriteria: findFieldIdByName(data, ACCEPTANCE_CRITERIA_FIELD_NAMES) ?? undefined,
    },
  };
}

function appendPreviewDebugLog(source: string, payload: unknown): void {
  chrome.runtime?.sendMessage?.({
    type: 'DEBUG_LOG_REQUEST',
    id: crypto.randomUUID(),
    source,
    payload,
  });
}

function setJiraPreviewBannerInPage(
  fields: JiraEnhancementFields,
  fieldIds: JiraFieldIds = {},
): void {
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
    const issueKey = window.location.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/)?.[1];
    if (!issueKey) {
      label.textContent = 'Could not detect Jira issue key.';
      apply.disabled = false;
      apply.textContent = 'Apply';
      return;
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
    try {
      const response = await fetch(
        `${window.location.origin}/rest/api/2/issue/${encodeURIComponent(issueKey)}`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ fields: restFields }),
        },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Jira save failed (${response.status}). ${text.slice(0, 240)}`);
      }
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

function setJiraDescriptionHtmlInPage(renderedHtml: string): { ok: boolean; message?: string } {
  const selectors = [
    '[data-testid="issue-description"]',
    '[data-testid="issue.views.field.rich-text.description"]',
    '#description-val .user-content-block',
    '.user-content-block',
    '[data-field-id="description"]',
  ];
  const editorSelectors = [
    '#descriptionmodule textarea',
    'textarea[name="description"]',
    'textarea#description',
    '#descriptionmodule .wiki-edit textarea',
    '#descriptionmodule .jira-wiki-editor textarea',
    '#descriptionmodule [contenteditable="true"]',
  ];
  if (editorSelectors.some((selector) => document.querySelector(selector))) {
    return { ok: false, message: 'The Jira description editor is currently open.' };
  }

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) {
      const template = document.createElement('template');
      template.innerHTML = renderedHtml;
      el.replaceChildren(...Array.from(template.content.childNodes));
      return { ok: true };
    }
  }
  return { ok: false, message: 'No Jira description DOM target was found.' };
}

function setJiraFieldsInPage(fields: JiraEnhancementFields): { ok: boolean; applied: string[] } {
  const selectors = [
    '[data-testid="issue-description"]',
    '[data-testid="issue.views.field.rich-text.description"]',
    '#description-val .user-content-block',
    '.user-content-block',
    '[data-field-id="description"]',
  ];
  const editorSelectors = [
    '#descriptionmodule textarea',
    'textarea[name="description"]',
    'textarea#description',
    '#descriptionmodule .wiki-edit textarea',
    '#descriptionmodule .jira-wiki-editor textarea',
    '#descriptionmodule [contenteditable="true"]',
  ];
  if (editorSelectors.some((selector) => document.querySelector(selector))) {
    return { ok: false, applied: [] };
  }

  function renderInline(text: string): Node[] {
    const nodes: Node[] = [];
    const emoticons: Record<string, string> = {
      ':)': 'smile.png',
      '(/)': 'check.png',
      '(x)': 'error.png',
      '(*)': 'star_yellow.png',
      '(+)': 'add.png',
    };
    const regex = /(\*([^*]+)\*)|(:\)|\(\/\)|\(x\)|\(\*\)|\(\+\))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      if (match[1]) {
        const strong = document.createElement('strong');
        strong.textContent = match[2];
        nodes.push(strong);
      } else if (match[3]) {
        const img = document.createElement('img');
        img.className = 'emoticon';
        img.src = `/images/icons/emoticons/${emoticons[match[3]]}`;
        img.alt = match[3];
        img.width = 16;
        img.height = 16;
        nodes.push(img);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) nodes.push(document.createTextNode(text.slice(lastIndex)));
    return nodes.length ? nodes : [document.createTextNode(text)];
  }

  function appendParagraph(container: HTMLElement, text: string): void {
    const p = document.createElement('p');
    p.append(...renderInline(text));
    container.appendChild(p);
  }

  function parseTableCells(line: string): string[] {
    const trimmed = line.trim();
    if (trimmed.startsWith('||')) return trimmed.slice(2, -2).split('||');
    return trimmed.slice(1, -1).split('|');
  }

  function appendTable(container: HTMLElement, lines: string[], start: number): number {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrap';
    const table = document.createElement('table');
    table.className = 'confluenceTable';
    const tbody = document.createElement('tbody');
    let i = start;
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      const isHeader = /^\s*\|\|/.test(lines[i]);
      const tr = document.createElement('tr');
      for (const cellText of parseTableCells(lines[i])) {
        const cell = document.createElement(isHeader ? 'th' : 'td');
        cell.className = isHeader ? 'confluenceTh' : 'confluenceTd';
        cell.append(...renderInline(cellText));
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
      i += 1;
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);
    return i - 1;
  }

  function appendList(
    container: HTMLElement,
    lines: string[],
    start: number,
    marker: '*' | '#',
  ): number {
    const root = document.createElement(marker === '*' ? 'ul' : 'ol');
    const stack: Array<{ level: number; list: HTMLElement; lastItem: HTMLLIElement | null }> = [
      { level: 1, list: root, lastItem: null },
    ];
    let i = start;
    const listRegex = marker === '*' ? /^(\*+)\s+(.+)$/ : /^(#+)\s+(.+)$/;
    while (i < lines.length) {
      const match = lines[i].match(listRegex);
      if (!match) break;
      const level = match[1].length;
      while (stack.length > level) stack.pop();
      while (stack.length < level) {
        const parent = stack[stack.length - 1];
        const nested = document.createElement(marker === '*' ? 'ul' : 'ol');
        if (!parent.lastItem) {
          parent.lastItem = document.createElement('li');
          parent.list.appendChild(parent.lastItem);
        }
        parent.lastItem.appendChild(nested);
        stack.push({ level: stack.length + 1, list: nested, lastItem: null });
      }
      const current = stack[stack.length - 1];
      const li = document.createElement('li');
      li.append(...renderInline(match[2]));
      current.list.appendChild(li);
      current.lastItem = li;
      i += 1;
    }
    container.appendChild(root);
    return i - 1;
  }

  function appendPanel(
    container: HTMLElement,
    kind: 'code' | 'preformatted',
    codeLines: string[],
    language?: string,
  ): void {
    const panel = document.createElement('div');
    panel.className = `${kind} panel`;
    const content = document.createElement('div');
    content.className = `${kind}Content panelContent`;
    const pre = document.createElement('pre');
    if (kind === 'code') pre.className = `code-${language || 'java'}`;
    pre.textContent = `${codeLines.join('\n')}\n`;
    content.appendChild(pre);
    panel.appendChild(content);
    container.appendChild(panel);
  }

  function renderJiraMarkup(markup: string): HTMLElement {
    const container = document.createElement('div');
    container.dataset.jiraEnhancerPreview = 'true';
    const lines = markup.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trimEnd();
      if (!line.trim()) continue;
      const heading = line.match(/^\s*h([1-6])\.\s+(.+)$/);
      if (heading) {
        const el = document.createElement(`h${heading[1]}`);
        el.append(...renderInline(heading[2]));
        container.appendChild(el);
        continue;
      }
      const codeStart = line.match(/^\s*\{code(?::([^}]+))?\}\s*$/);
      if (codeStart) {
        const codeLines: string[] = [];
        i += 1;
        while (i < lines.length && !/^\s*\{code\}\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        appendPanel(container, 'code', codeLines, codeStart[1]);
        continue;
      }
      if (/^\s*\{noformat\}\s*$/.test(line)) {
        const codeLines: string[] = [];
        i += 1;
        while (i < lines.length && !/^\s*\{noformat\}\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        appendPanel(container, 'preformatted', codeLines);
        continue;
      }
      if (/^\s*-{4,}\s*$/.test(line)) {
        container.appendChild(document.createElement('hr'));
        continue;
      }
      if (/^\s*\|/.test(line)) {
        i = appendTable(container, lines, i);
        continue;
      }
      if (/^\*+\s+/.test(line)) {
        i = appendList(container, lines, i, '*');
        continue;
      }
      if (/^#+\s+/.test(line)) {
        i = appendList(container, lines, i, '#');
        continue;
      }
      appendParagraph(container, line.trimStart());
    }
    return container;
  }

  const renderedPreview = renderJiraMarkup(fields.description);
  chrome.runtime?.sendMessage?.({
    type: 'DEBUG_LOG_REQUEST',
    id: crypto.randomUUID(),
    source: 'popup-fallback-preview-render',
    payload: {
      raw: fields.description,
      rawLength: fields.description.length,
      domToString: String(renderedPreview),
      domText: renderedPreview.textContent,
      domHtml: renderedPreview.outerHTML,
    },
  });

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) {
      chrome.runtime?.sendMessage?.({
        type: 'DEBUG_LOG_REQUEST',
        id: crypto.randomUUID(),
        source: 'popup-fallback-preview-target-before',
        payload: {
          selector,
          targetToString: String(el),
          targetText: el.textContent,
          targetHtml: el.outerHTML,
        },
      });
      el.replaceChildren(...Array.from(renderedPreview.childNodes));
      chrome.runtime?.sendMessage?.({
        type: 'DEBUG_LOG_REQUEST',
        id: crypto.randomUUID(),
        source: 'popup-fallback-preview-target-after',
        payload: {
          selector,
          targetToString: String(el),
          targetText: el.textContent,
          targetHtml: el.outerHTML,
        },
      });
      return { ok: true, applied: ['description'] };
    }
  }
  return { ok: false, applied: [] };
}

async function extractDescriptionInPage(): Promise<PageDescriptionResult> {
  const selectors = [
    '[data-testid="issue-description"]',
    '[data-testid="issue.views.field.rich-text.description"]',
    '#description-val',
    '#descriptionmodule .mod-content',
    '#descriptionmodule',
    '[data-field-id="description"]',
    '[data-fieldtype="textarea"]',
    '.user-content-block',
  ];

  const normalize = (text: string): string => text.replace(/\n{3,}/g, '\n\n').trim();
  const normalizeLabel = (text: string): string =>
    text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const renderNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\s+/g, ' ') ?? '';
    if (!(node instanceof HTMLElement)) return '';

    const children = Array.from(node.childNodes).map(renderNode).join('').trim();
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'h1') return `# ${children}\n\n`;
    if (tag === 'h2') return `## ${children}\n\n`;
    if (tag === 'h3') return `### ${children}\n\n`;
    if (tag === 'h4') return `#### ${children}\n\n`;
    if (tag === 'p') return `${children}\n\n`;
    if (tag === 'li') return `- ${children}\n`;
    if (tag === 'ul' || tag === 'ol') return `${children}\n`;
    if (tag === 'a')
      return node.getAttribute('href') ? `[${children}](${node.getAttribute('href')})` : children;
    if (tag === 'img') {
      const img = node as HTMLImageElement;
      return img.src ? `![${img.alt || img.title || 'Jira image'}](${img.src})` : '';
    }
    return children;
  };
  const editorTextSelectors = [
    '#descriptionmodule textarea',
    'textarea[name="description"]',
    'textarea#description',
    'textarea.wiki-textfield',
    '.wiki-edit textarea',
    '.jira-wiki-editor textarea',
  ];
  for (const selector of editorTextSelectors) {
    const textarea = document.querySelector(selector) as HTMLTextAreaElement | null;
    if (textarea?.value.trim()) {
      return { description: normalize(textarea.value), images: [] };
    }
  }

  const images = await Promise.all(
    (Array.from(document.querySelectorAll('img')) as HTMLImageElement[])
      .filter((img) => img.src && !img.src.startsWith('data:'))
      .slice(0, 20)
      .map(async (img) => {
        const response = await fetch(img.src, { credentials: 'include' });
        const blob = await response.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        return {
          originalUrl: img.src,
          alt: img.alt || img.title || 'Jira image',
          mimeType: blob.type || 'application/octet-stream',
          base64,
        };
      }),
  );

  const findVisibleFieldValue = (labels: string[]): string | null => {
    const normalizedLabels = labels.map(normalizeLabel);
    const elements = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    for (const element of elements) {
      const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ');
      const elementLabel = normalizeLabel(
        directText || element.innerText || element.textContent || '',
      );
      if (!normalizedLabels.includes(elementLabel)) continue;

      const valueElement = element.nextElementSibling as HTMLElement | null;
      const siblingText = valueElement?.innerText || valueElement?.textContent || '';
      if (siblingText.trim()) return normalize(siblingText);

      const parentText =
        element.parentElement?.innerText || element.parentElement?.textContent || '';
      const labelText = directText || element.innerText || element.textContent || '';
      const withoutLabel = parentText.trim().startsWith(labelText.trim())
        ? parentText.trim().slice(labelText.trim().length).replace(/^\s*:/, '')
        : '';
      if (withoutLabel.trim()) return normalize(withoutLabel);
    }
    return null;
  };

  const pageStoryPoints = findVisibleFieldValue(['Story Points', 'Story point estimate']);
  const pageAcceptanceCriteria = findVisibleFieldValue(['Acceptance Criteria']);

  const createResult = (text: string): PageDescriptionResult => ({
    description: normalize(text),
    images,
    storyPoints: pageStoryPoints,
    acceptanceCriteria: pageAcceptanceCriteria,
  });

  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLElement | null;
    const text = el ? renderNode(el) : '';
    if (text.trim()) return createResult(text);
  }

  const allElements = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
  const heading = allElements.find((el) => el.innerText?.trim().toLowerCase() === 'description');
  let cursor = heading?.parentElement?.nextElementSibling as HTMLElement | null | undefined;
  while (cursor) {
    const text = cursor.innerText || cursor.textContent || '';
    if (text.trim()) return createResult(text);
    cursor = cursor.nextElementSibling as HTMLElement | null;
  }

  const bodyText = document.body.innerText || document.body.textContent || '';
  const descriptionIndex = bodyText.search(/^Description$/im);
  if (descriptionIndex !== -1) {
    const afterDescription = bodyText.slice(descriptionIndex).replace(/^Description\s*/i, '');
    const nextSection = afterDescription.search(
      /^(People|Dates|Agile|Salesforce|Activity|Attachments|Add a comment|Comments|Details)$/im,
    );
    return createResult(
      nextSection === -1 ? afterDescription : afterDescription.slice(0, nextSection),
    );
  }

  return { description: '', images };
}

export function Popup({ fullPage = false }: PopupProps = {}) {
  const {
    enhance,
    cancel,
    restore,
    loadCompletedResult,
    status,
    refinedDescription,
    originalFields,
    enhancedFields,
    sessionRef: enhancementSessionRef,
    error,
    isProcessing,
    progress,
    harnessEvents,
  } = useRefinement();
  const {
    generate: generateSubtasks,
    loadCompletedResult: loadCompletedSubtaskResult,
    status: subtaskStatus,
    result: subtaskResult,
    sessionRef: subtaskSessionRef,
    error: subtaskError,
    isProcessing: isSubtaskProcessing,
    progress: subtaskProgress,
    harnessEvents: subtaskHarnessEvents,
  } = useSubtaskGeneration();

  const [currentView, setCurrentView] = useState<View>('enhance');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedFields, setEditedFields] = useState<JiraEnhancementFields>({ description: '' });
  const [showReadOnlyDiff, setShowReadOnlyDiff] = useState(false);
  const [issueKey, setIssueKey] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [pendingEnhancement, setPendingEnhancement] = useState<PendingEnhancement | null>(null);
  const [storyPoints, setStoryPoints] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [components, setComponents] = useState<string[]>([]);
  const [issueType, setIssueType] = useState<string | null>(null);
  const [fieldIds, setFieldIds] = useState<JiraFieldIds>({});
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [resultHistory, setResultHistory] = useState<StoredEnhancementResult[]>([]);
  const [subtaskHistory, setSubtaskHistory] = useState<StoredSubtaskGeneration[]>([]);
  const [editedSubtasks, setEditedSubtasks] = useState<GeneratedSubtask[]>([]);
  const [jiraHistoryEntries, setJiraHistoryEntries] = useState<HistoryEntry[]>([]);
  const [jiraHistoryStatus, setJiraHistoryStatus] = useState<string | null>(null);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<HistoryEntry | null>(null);
  const [historyCompareEntry, setHistoryCompareEntry] = useState<HistoryEntry | null>(null);
  const [historyCurrentFields, setHistoryCurrentFields] = useState<JiraEnhancementFields | null>(
    null,
  );
  const [compareLeftId, setCompareLeftId] = useState<string>('');
  const [compareRightId, setCompareRightId] = useState<string>('');
  const [showPreviousCompare, setShowPreviousCompare] = useState(false);
  const [savedImages, setSavedImages] = useState<SavedImage[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);
  const [autoReadDescription, setAutoReadDescription] = useState(
    () => localStorage.getItem('jiraEnhancer.autoReadDescription') !== 'false',
  );
  const [descriptionReadStatus, setDescriptionReadStatus] = useState<string | null>(null);
  const [previewedFields, setPreviewedFields] = useState<JiraEnhancementFields | null>(null);
  const [previewedSourceId, setPreviewedSourceId] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const popupBodyRef = useRef<HTMLDivElement | null>(null);
  const processingLogRef = useRef<HTMLDivElement | null>(null);
  const processingPinnedToBottom = useRef(true);
  const skipNextHistorySave = useRef(false);
  const isRestoringHistoryScroll = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');
    if (fullPage && sessionId) {
      const rawSession = localStorage.getItem(`jiraEnhancer.fullPageSession.${sessionId}`);
      if (rawSession) {
        const session = JSON.parse(rawSession) as FullPageSession;
        setActiveTabId(session.sourceTabId);
        setActiveTabUrl(session.sourceTabUrl);
        setIssueKey(session.issueKey);
        setDescription(session.description);
        setStoryPoints(session.storyPoints);
        setAcceptanceCriteria(session.acceptanceCriteria);
        setComponents(session.components);
        setIssueType(session.issueType);
        setFieldIds(session.fieldIds ?? {});
        setImageAttachments(session.images);
        setPendingEnhancement(session.pendingEnhancement);
        setCurrentView('review-request');
        return;
      }
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id !== undefined) {
        setActiveTabId(tab.id);
      }
      if (tab?.url) {
        setActiveTabUrl(tab.url);
        const key = extractIssueKey(tab.url);
        setIssueKey(key);
      }
    });
  }, [fullPage]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.autoReadDescription', String(autoReadDescription));
  }, [autoReadDescription]);

  const readDescriptionFromCurrentPage = useCallback(() => {
    if (activeTabId === null) return;
    setDescriptionReadStatus('Reading Jira description…');

    const readFromPage = () => {
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTabId },
          func: extractDescriptionInPage,
        },
        (results) => {
          const scriptError = chrome.runtime.lastError?.message;
          const pageResult = results?.[0]?.result as PageDescriptionResult | undefined;
          if (!scriptError && pageResult?.description) {
            setDescription(pageResult.description);
            setStoryPoints(pageResult.storyPoints ?? '');
            setAcceptanceCriteria(pageResult.acceptanceCriteria ?? '');
            setFieldIds({});
            setImageAttachments(pageResult.images);
            setDescriptionReadStatus(
              `Read ${pageResult.description.length} chars and ${pageResult.images.length} images from page script.`,
            );
            return;
          }

          chrome.tabs.sendMessage(activeTabId, { type: 'GET_JIRA_DESCRIPTION' }, (response) => {
            const messageError = chrome.runtime.lastError?.message;
            const { description: messageDescription } = (response ?? {}) as {
              description?: string;
            };
            if (!messageError && messageDescription) {
              setDescription(messageDescription);
              setStoryPoints('');
              setAcceptanceCriteria('');
              setFieldIds({});
              setImageAttachments([]);
              setDescriptionReadStatus(
                `Read ${messageDescription.length} chars from content script.`,
              );
              return;
            }
            setDescriptionReadStatus(
              scriptError
                ? `No description found. Page script failed: ${scriptError}`
                : 'No description found on the current Jira page.',
            );
          });
        },
      );
    };

    if (issueKey && activeTabUrl) {
      fetchRawJiraIssueData(issueKey, activeTabUrl)
        .then((issueData) => {
          setComponents(issueData.components);
          setIssueType(issueData.issueType);
          setFieldIds(issueData.fieldIds);
          const isStoryIssue = normalizeJiraFieldName(issueData.issueType ?? '') === 'story';
          setStoryPoints(isStoryIssue ? (issueData.storyPoints ?? '') : '');
          setAcceptanceCriteria(isStoryIssue ? (issueData.acceptanceCriteria ?? '') : '');
          if (
            issueData.description ||
            (isStoryIssue && (issueData.storyPoints || issueData.acceptanceCriteria))
          ) {
            setDescription(issueData.description ?? '');
            setImageAttachments([]);
            setDescriptionReadStatus(
              `Read ${(issueData.description ?? '').length} description chars, ${issueData.components.length} components, story points, and acceptance criteria from Jira REST API.`,
            );
            return;
          }
          readFromPage();
        })
        .catch(() => readFromPage());
      return;
    }

    readFromPage();
  }, [activeTabId, activeTabUrl, issueKey]);

  useEffect(() => {
    if (!autoReadDescription) return;
    readDescriptionFromCurrentPage();
  }, [autoReadDescription, readDescriptionFromCurrentPage]);

  useEffect(() => {
    if (!issueKey) return;
    const history = loadResultHistory(issueKey);
    setResultHistory(history);
    setSubtaskHistory(loadSubtaskHistory(issueKey));
    const previewState = loadPreviewState(issueKey);
    if (previewState) {
      setPreviewedFields(previewState.fields);
      setPreviewedSourceId(previewState.sourceId);
      setApplyStatus('A Jira preview is available. Apply saves that preview through the Jira API.');
    }
    const savedView = localStorage.getItem(popupViewStorageKey(issueKey));
    if (!fullPage && (savedView === 'history' || savedView === 'subtasks')) {
      setCurrentView(savedView);
    }
    if (fullPage) restore(issueKey);
  }, [fullPage, issueKey, restore]);

  useEffect(() => {
    if (!issueKey || fullPage) return;
    if (currentView === 'history') {
      localStorage.setItem(popupViewStorageKey(issueKey), 'history');
    } else if (currentView === 'subtasks') {
      localStorage.setItem(popupViewStorageKey(issueKey), 'subtasks');
    } else if (currentView === 'enhance') {
      localStorage.setItem(popupViewStorageKey(issueKey), 'enhance');
    }
  }, [currentView, fullPage, issueKey]);

  const saveHistoryScroll = useCallback(() => {
    if (!issueKey || fullPage || currentView !== 'history' || isRestoringHistoryScroll.current) {
      return;
    }
    const scrollTop = popupBodyRef.current?.scrollTop ?? 0;
    localStorage.setItem(historyScrollStorageKey(issueKey), String(scrollTop));
  }, [currentView, fullPage, issueKey]);

  const handlePopupBodyScroll = useCallback(() => {
    saveHistoryScroll();
  }, [saveHistoryScroll]);

  const restoreImageUrls = useCallback(
    (markdown: string) =>
      savedImages.reduce(
        (result, image) => result.split(image.tmpPath).join(image.originalUrl),
        markdown,
      ),
    [savedImages],
  );

  const isStoryIssue = issueType ? normalizeJiraFieldName(issueType) === 'story' : true;
  const enhancementFields = useMemo<JiraEnhancementFields>(
    () => ({
      description,
      ...(isStoryIssue ? { acceptanceCriteria, storyPoints } : {}),
    }),
    [description, isStoryIssue, acceptanceCriteria, storyPoints],
  );
  const promptPreview = pendingEnhancement
    ? buildEnhancementPrompt(enhancementFields, pendingEnhancement.customPrompt, pendingEnhancement)
    : JSON.stringify(enhancementFields, null, 2);
  const canRetryExpiredAwsSso =
    Boolean(pendingEnhancement && issueKey && error) &&
    /aws sso session expired|aws sso login|token is expired/i.test(error ?? '');

  const handleEnhance = useCallback(
    (
      mode: EnhanceMode,
      app: LlmApp,
      modelProvider?: string,
      model?: string,
      launchPath?: string,
      customPrompt?: string,
      env?: Record<string, string>,
      safetyMode?: HarnessSafetyMode,
    ) => {
      const pending = {
        mode,
        app,
        modelProvider,
        model,
        launchPath,
        customPrompt,
        env,
        safetyMode,
      };
      if (!fullPage && activeTabId !== null) {
        const sessionId = crypto.randomUUID();
        const session: FullPageSession = {
          sourceTabId: activeTabId,
          sourceTabUrl: activeTabUrl,
          issueKey,
          description,
          storyPoints,
          acceptanceCriteria,
          components,
          issueType,
          fieldIds,
          images: imageAttachments,
          pendingEnhancement: pending,
        };
        localStorage.setItem(`jiraEnhancer.fullPageSession.${sessionId}`, JSON.stringify(session));
        chrome.tabs.create({
          url: chrome.runtime.getURL(`src/full-page/index.html?session=${sessionId}`),
        });
        window.close();
        return;
      }
      setPendingEnhancement(pending);
      setCurrentView('review-request');
    },
    [
      fullPage,
      activeTabId,
      activeTabUrl,
      issueKey,
      description,
      storyPoints,
      acceptanceCriteria,
      components,
      issueType,
      fieldIds,
      imageAttachments,
    ],
  );

  const handleGenerateSubtasks = useCallback(
    (
      mode: EnhanceMode,
      app: LlmApp,
      modelProvider?: string,
      model?: string,
      launchPath?: string,
      customPrompt?: string,
      env?: Record<string, string>,
      safetyMode?: HarnessSafetyMode,
      reusableSessionRef?: HarnessSessionRef,
      reuseSession?: boolean,
      titleOnly?: boolean,
    ) => {
      if (!issueKey) return;
      setCurrentView('subtask-activity');
      generateSubtasks(
        issueKey,
        enhancementFields,
        enhancedFields ?? undefined,
        mode,
        app,
        modelProvider,
        model,
        launchPath,
        customPrompt,
        env,
        safetyMode,
        reusableSessionRef,
        reuseSession,
        titleOnly,
      );
    },
    [enhancedFields, enhancementFields, generateSubtasks, issueKey],
  );

  const executeEnhancement = useCallback(() => {
    if (!issueKey || !pendingEnhancement) return;
    setCurrentView('activity');
    const fieldsForEnhancement: JiraEnhancementFields = { ...enhancementFields };
    const { mode, app, modelProvider, model, launchPath, customPrompt, env, safetyMode } =
      pendingEnhancement;

    if (imageAttachments.length === 0) {
      enhance(
        issueKey,
        fieldsForEnhancement,
        mode,
        app,
        modelProvider,
        model,
        launchPath,
        customPrompt,
        env,
        safetyMode,
      );
      return;
    }

    const id = crypto.randomUUID();
    chrome.runtime.sendMessage(
      { type: MessageType.SAVE_IMAGES_REQUEST, id, images: imageAttachments },
      (response?: SaveImagesResponse) => {
        if (chrome.runtime.lastError || !response) {
          enhance(
            issueKey,
            fieldsForEnhancement,
            mode,
            app,
            modelProvider,
            model,
            launchPath,
            customPrompt,
            env,
            safetyMode,
          );
          return;
        }

        setSavedImages(response.images);
        const replaceImageUrls = (value: string): string =>
          response.images.reduce(
            (result, image) => result.split(image.originalUrl).join(image.tmpPath),
            value,
          );
        const preparedFields: JiraEnhancementFields = {
          ...fieldsForEnhancement,
          description: replaceImageUrls(fieldsForEnhancement.description),
          ...('acceptanceCriteria' in fieldsForEnhancement
            ? {
                acceptanceCriteria: replaceImageUrls(fieldsForEnhancement.acceptanceCriteria ?? ''),
              }
            : {}),
        };
        enhance(
          issueKey,
          preparedFields,
          mode,
          app,
          modelProvider,
          model,
          launchPath,
          customPrompt,
          env,
          safetyMode,
        );
      },
    );
  }, [issueKey, pendingEnhancement, enhancementFields, imageAttachments, enhance]);

  const displayRefinedDescription = restoreImageUrls(refinedDescription);
  const displayOriginalFields = useMemo(
    () => originalFields ?? enhancementFields,
    [originalFields, enhancementFields],
  );
  const displayEnhancedFields = useMemo(
    () =>
      enhancedFields ?? {
        description: displayRefinedDescription,
        ...('acceptanceCriteria' in displayOriginalFields ? { acceptanceCriteria: '' } : {}),
        ...('storyPoints' in displayOriginalFields ? { storyPoints: '' } : {}),
      },
    [enhancedFields, displayRefinedDescription, displayOriginalFields],
  );
  const reviewFieldRows = (
    [
      ['description', 'Description'],
      ['acceptanceCriteria', 'Acceptance Criteria'],
      ['storyPoints', 'Story Points'],
    ] as const
  ).filter(([fieldKey]) => fieldKey in displayOriginalFields || fieldKey in displayEnhancedFields);
  const processingRows = useMemo(() => getProcessingRows(harnessEvents), [harnessEvents]);
  const subtaskProcessingRows = useMemo(
    () => getProcessingRows(subtaskHarnessEvents),
    [subtaskHarnessEvents],
  );
  const compareLeft = useMemo(
    () => resultHistory.find((result) => result.id === compareLeftId) ?? null,
    [resultHistory, compareLeftId],
  );
  const compareRight = useMemo(
    () => resultHistory.find((result) => result.id === compareRightId) ?? null,
    [resultHistory, compareRightId],
  );
  const compareFieldRows = useMemo(
    () =>
      (
        [
          ['description', 'Description'],
          ['acceptanceCriteria', 'Acceptance Criteria'],
          ['storyPoints', 'Story Points'],
        ] as const
      ).filter(
        ([fieldKey]) =>
          Boolean(compareLeft?.enhancedFields[fieldKey]) ||
          Boolean(compareRight?.enhancedFields[fieldKey]),
      ),
    [compareLeft, compareRight],
  );
  const filterFieldsForIssueType = useCallback(
    (fields: JiraEnhancementFields): JiraEnhancementFields => ({
      description: fields.description,
      ...(isStoryIssue && fields.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: fields.acceptanceCriteria }
        : {}),
      ...(isStoryIssue && fields.storyPoints !== undefined
        ? { storyPoints: fields.storyPoints }
        : {}),
    }),
    [isStoryIssue],
  );
  const historyFieldKeys = useMemo(
    () =>
      (['description', 'acceptanceCriteria', 'storyPoints'] as EnhancementFieldKey[]).filter(
        (fieldKey) => fieldKey === 'description' || isStoryIssue,
      ),
    [isStoryIssue],
  );
  const localHistoryEntries = useMemo<HistoryEntry[]>(
    () =>
      resultHistory.map((result) => {
        const fields = filterFieldsForIssueType(fieldsToJiraMarkup(result.enhancedFields));
        const changedFields = historyFieldKeys.filter((fieldKey) => Boolean(fields[fieldKey]));
        return {
          id: `local-${result.id}`,
          source: 'local',
          createdAt: result.createdAt,
          title: 'Local enhancement result',
          subtitle:
            [result.modelProvider, result.model].filter(Boolean).join(' / ') || 'Default model',
          fields,
          changedFields,
          summary: shortenText(fields.description),
        };
      }),
    [filterFieldsForIssueType, historyFieldKeys, resultHistory],
  );
  const allHistoryEntries = useMemo(
    () =>
      [...localHistoryEntries, ...jiraHistoryEntries]
        .map((entry) => {
          const fields = filterFieldsForIssueType(entry.fields);
          const changedFields = entry.changedFields.filter((fieldKey) =>
            historyFieldKeys.includes(fieldKey),
          );
          return { ...entry, fields, changedFields };
        })
        .filter((entry) => entry.changedFields.length > 0 || Boolean(entry.fields.description))
        .sort((a, b) => b.createdAt - a.createdAt),
    [filterFieldsForIssueType, historyFieldKeys, localHistoryEntries, jiraHistoryEntries],
  );
  const historyCompareRows = useMemo(
    () =>
      (
        [
          ['description', 'Description'],
          ['acceptanceCriteria', 'Acceptance Criteria'],
          ['storyPoints', 'Story Points'],
        ] as const
      ).filter(
        ([fieldKey]) =>
          historyFieldKeys.includes(fieldKey) &&
          (Boolean(historyCompareEntry?.fields[fieldKey]) ||
            Boolean(historyCurrentFields?.[fieldKey])),
      ),
    [historyCompareEntry, historyCurrentFields, historyFieldKeys],
  );

  useEffect(() => {
    if (!issueKey || fullPage || currentView !== 'history') return;
    const savedScrollTop = Number(localStorage.getItem(historyScrollStorageKey(issueKey)) ?? '0');
    if (!Number.isFinite(savedScrollTop) || savedScrollTop <= 0) return;

    isRestoringHistoryScroll.current = true;
    const restore = () => {
      const body = popupBodyRef.current;
      if (!body) return;
      body.scrollTop = Math.min(savedScrollTop, Math.max(0, body.scrollHeight - body.clientHeight));
    };

    requestAnimationFrame(restore);
    const timers = [50, 150, 350, 700].map((delay) => window.setTimeout(restore, delay));
    const unlock = window.setTimeout(() => {
      isRestoringHistoryScroll.current = false;
    }, 850);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(unlock);
      isRestoringHistoryScroll.current = false;
    };
  }, [allHistoryEntries.length, currentView, fullPage, issueKey, jiraHistoryStatus]);

  useEffect(() => {
    const log = processingLogRef.current;
    if (!log || !processingPinnedToBottom.current) return;
    log.scrollTop = log.scrollHeight;
  }, [processingRows.length]);

  const handleProcessingScroll = useCallback(() => {
    const log = processingLogRef.current;
    if (!log) return;
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    processingPinnedToBottom.current = distanceFromBottom < 24;
  }, []);

  useEffect(() => {
    if (isProcessing) {
      setCurrentView('activity');
      return;
    }
    if (status === 'complete') {
      const jiraFields = fieldsToJiraMarkup(displayEnhancedFields);
      setCurrentView('diff');
      setEditedDescription(jiraFields.description);
      setEditedFields(jiraFields);
      setShowReadOnlyDiff(false);
      if (skipNextHistorySave.current) {
        skipNextHistorySave.current = false;
        return;
      }
      if (issueKey && displayEnhancedFields.description) {
        const savedResult: StoredEnhancementResult = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          issueKey,
          createdAt: Date.now(),
          originalDescription: displayOriginalFields.description,
          refinedDescription: displayEnhancedFields.description,
          originalFields: displayOriginalFields,
          enhancedFields: displayEnhancedFields,
          modelProvider: pendingEnhancement?.modelProvider,
          model: pendingEnhancement?.model,
          sessionRef: enhancementSessionRef ?? undefined,
        };
        const nextHistory = saveResultToHistory(savedResult);
        setResultHistory(nextHistory);
        setCompareRightId(savedResult.id);
        setCompareLeftId((current) => current || nextHistory[1]?.id || savedResult.id);
      }
    }
  }, [
    status,
    isProcessing,
    displayEnhancedFields,
    issueKey,
    displayOriginalFields,
    pendingEnhancement?.modelProvider,
    pendingEnhancement?.model,
    enhancementSessionRef,
  ]);

  const focusSourceTab = (tabId: number) => {
    chrome.tabs.update(tabId, { active: true }, (tab) => {
      if (tab?.windowId !== undefined) {
        chrome.windows?.update?.(tab.windowId, { focused: true });
      }
    });
  };

  const previewFieldsInSourceTab = (fields: JiraEnhancementFields, sourceId = 'current') => {
    saveHistoryScroll();
    if (activeTabId === null) return;
    const normalizedFields: JiraEnhancementFields = {
      ...fields,
      description: fields.description.replace(/\r\n/g, '\n'),
      ...(fields.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: fields.acceptanceCriteria.replace(/\r\n/g, '\n') }
        : {}),
    };
    setApplyStatus(null);
    appendPreviewDebugLog('popup-preview-requested', {
      sourceId,
      issueKey,
      activeTabId,
      fieldIds,
      fields,
      normalizedFields,
      descriptionLength: fields.description.length,
      normalizedDescriptionLength: normalizedFields.description.length,
    });

    let callbackReceived = false;
    const runFallbackPreview = (reason: string) => {
      appendPreviewDebugLog('popup-preview-fallback-start', { sourceId, reason, activeTabId });
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTabId },
          func: setJiraFieldsInPage,
          args: [normalizedFields],
        },
        (results) => {
          appendPreviewDebugLog('popup-preview-fallback-result', {
            sourceId,
            reason,
            lastError: chrome.runtime.lastError?.message,
            results,
          });
          chrome.scripting.executeScript(
            {
              target: { tabId: activeTabId },
              func: setJiraPreviewBannerInPage,
              args: [normalizedFields, fieldIds],
            },
            (bannerResults) => {
              appendPreviewDebugLog('popup-preview-banner-result', {
                sourceId,
                lastError: chrome.runtime.lastError?.message,
                results: bannerResults,
              });
              focusSourceTab(activeTabId);
            },
          );
        },
      );
    };

    window.setTimeout(() => {
      if (!callbackReceived) runFallbackPreview('content-script-timeout');
    }, 1_000);

    chrome.tabs.sendMessage(
      activeTabId,
      { type: 'SET_JIRA_FIELDS', fields: normalizedFields, fieldIds },
      (response?: { ok?: boolean }) => {
        callbackReceived = true;
        const lastError = chrome.runtime.lastError?.message;
        appendPreviewDebugLog('popup-preview-content-response', {
          sourceId,
          lastError,
          response,
        });
        if (lastError || !response?.ok) {
          runFallbackPreview(lastError || 'content-script-returned-not-ok');
          return;
        }
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTabId },
            func: setJiraPreviewBannerInPage,
            args: [normalizedFields, fieldIds],
          },
          (bannerResults) => {
            appendPreviewDebugLog('popup-preview-banner-result', {
              sourceId,
              lastError: chrome.runtime.lastError?.message,
              results: bannerResults,
            });
            focusSourceTab(activeTabId);
          },
        );
      },
    );
    setPreviewedFields(normalizedFields);
    setPreviewedSourceId(sourceId);
    if (issueKey) {
      savePreviewState({ issueKey, sourceId, fields: normalizedFields, createdAt: Date.now() });
    }
  };

  const applyPreviewedFieldsWithJiraApi = async (fieldsToApply = previewedFields) => {
    if (!fieldsToApply || !issueKey || !activeTabUrl) return;
    setApplyStatus('Saving previewed fields to Jira…');
    const { origin, hostname } = new URL(activeTabUrl);
    const isCloud = hostname.endsWith('.atlassian.net');
    const fields: Record<string, unknown> = {
      description: isCloud
        ? markdownToAdf(jiraMarkupToMarkdown(fieldsToApply.description))
        : fieldsToApply.description,
    };
    if (fieldIds.storyPoints && fieldsToApply.storyPoints?.trim()) {
      const numericStoryPoints = Number(fieldsToApply.storyPoints);
      fields[fieldIds.storyPoints] = Number.isFinite(numericStoryPoints)
        ? numericStoryPoints
        : fieldsToApply.storyPoints;
    }
    if (fieldIds.acceptanceCriteria && fieldsToApply.acceptanceCriteria?.trim()) {
      fields[fieldIds.acceptanceCriteria] = isCloud
        ? markdownToAdf(jiraMarkupToMarkdown(fieldsToApply.acceptanceCriteria))
        : fieldsToApply.acceptanceCriteria;
    }

    const body = JSON.stringify({ fields });
    const put = (apiVersion: '3' | '2') =>
      fetch(`${origin}/rest/api/${apiVersion}/issue/${encodeURIComponent(issueKey)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      });

    let response = await put(isCloud ? '3' : '2');
    if (isCloud && !response.ok) response = await put('2');
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      setApplyStatus(`Jira save failed (${response.status}). ${text.slice(0, 240)}`);
      return;
    }

    setDescription(fieldsToApply.description);
    setStoryPoints(fieldsToApply.storyPoints ?? '');
    setAcceptanceCriteria(fieldsToApply.acceptanceCriteria ?? '');
    setApplyStatus('Saved to Jira. Refresh the issue if Jira does not update immediately.');
    setPreviewedFields(null);
    setPreviewedSourceId(null);
    clearPreviewState(issueKey);
  };

  const handlePreview = () => {
    const finalFields: JiraEnhancementFields =
      currentView === 'edit' ? { ...editedFields, description: editedDescription } : editedFields;
    previewFieldsInSourceTab(finalFields);
  };

  useEffect(() => {
    if (subtaskStatus !== 'complete' || !subtaskResult || !issueKey) return;
    setCurrentView('subtask-review');
    setEditedSubtasks(subtaskResult.subtasks);
    const savedResult: StoredSubtaskGeneration = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      issueKey,
      createdAt: Date.now(),
      result: subtaskResult,
      sessionRef: subtaskSessionRef ?? undefined,
    };
    setSubtaskHistory(saveSubtaskGenerationToHistory(savedResult));
  }, [issueKey, subtaskResult, subtaskSessionRef, subtaskStatus]);

  const handleEdit = () => {
    setPreviewedFields(null);
    setPreviewedSourceId(null);
    if (issueKey) clearPreviewState(issueKey);
    setApplyStatus(null);
    setEditedDescription(editedFields.description || displayRefinedDescription);
    setCurrentView('edit');
  };

  const handleNewAlternative = () => {
    setPreviewedFields(null);
    setPreviewedSourceId(null);
    if (issueKey) clearPreviewState(issueKey);
    setApplyStatus(null);
    setCurrentView('enhance');
  };

  const refreshJiraHistory = useCallback(async () => {
    if (!issueKey || !activeTabUrl) return;
    setJiraHistoryStatus('Loading Jira changelog…');
    try {
      const currentIssueData = await fetchRawJiraIssueData(issueKey, activeTabUrl);
      setFieldIds(currentIssueData.fieldIds);
      const entries = await fetchJiraChangelogEntries(
        issueKey,
        activeTabUrl,
        currentIssueData.fieldIds,
        fieldsFromJiraIssueData(currentIssueData),
      );
      setJiraHistoryEntries(entries);
      setJiraHistoryStatus(`Loaded ${entries.length} Jira changelog entries.`);
    } catch (err) {
      setJiraHistoryStatus(err instanceof Error ? err.message : 'Failed to load Jira changelog.');
    }
  }, [activeTabUrl, issueKey]);

  useEffect(() => {
    if (currentView === 'history' && jiraHistoryEntries.length === 0 && !jiraHistoryStatus) {
      void refreshJiraHistory();
    }
  }, [currentView, jiraHistoryEntries.length, jiraHistoryStatus, refreshJiraHistory]);

  const compareHistoryWithCurrent = async (entry: HistoryEntry) => {
    if (!issueKey || !activeTabUrl) return;
    setHistoryCompareEntry(entry);
    setJiraHistoryStatus('Reading current Jira fields for comparison…');
    try {
      const currentIssueData = await fetchRawJiraIssueData(issueKey, activeTabUrl);
      setHistoryCurrentFields(
        filterFieldsForIssueType(fieldsToJiraMarkup(fieldsFromJiraIssueData(currentIssueData))),
      );
      setJiraHistoryStatus(null);
    } catch (err) {
      setJiraHistoryStatus(
        err instanceof Error ? err.message : 'Failed to read current Jira fields.',
      );
    }
  };

  const applyHistoryEntry = async (entry: HistoryEntry) => {
    if (
      !window.confirm(
        'Apply this historical version to Jira? This will overwrite current Jira fields.',
      )
    ) {
      return;
    }
    setPreviewedFields(entry.fields);
    setPreviewedSourceId(entry.id);
    if (issueKey)
      savePreviewState({
        issueKey,
        sourceId: entry.id,
        fields: entry.fields,
        createdAt: Date.now(),
      });
    await applyPreviewedFieldsWithJiraApi(entry.fields);
  };

  const selectCompareLeft = (id: string) => {
    setCompareLeftId(id);
    setShowPreviousCompare(true);
  };

  const selectCompareRight = (id: string) => {
    setCompareRightId(id);
    setShowPreviousCompare(true);
  };

  const closePreviousCompare = () => {
    setShowPreviousCompare(false);
    setCompareLeftId('');
    setCompareRightId('');
  };

  const previewConverterMarkupInJiraDom = async (
    jiraMarkup: string,
    renderedHtml: string,
  ): Promise<{ ok: boolean; message?: string }> => {
    if (activeTabId === null) {
      const message = 'No active Jira tab id is available.';
      appendPreviewDebugLog('converter-lab-preview-jira-dom-failed', {
        reason: message,
        issueKey,
        activeTabUrl,
        jiraMarkupLength: jiraMarkup.length,
        renderedHtmlLength: renderedHtml.length,
      });
      return { ok: false, message };
    }

    appendPreviewDebugLog('converter-lab-preview-jira-dom-request', {
      activeTabId,
      issueKey,
      activeTabUrl,
      jiraMarkupLength: jiraMarkup.length,
      renderedHtmlLength: renderedHtml.length,
    });

    return new Promise((resolve) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTabId },
          func: setJiraDescriptionHtmlInPage,
          args: [renderedHtml],
        },
        (results) => {
          const scriptError = chrome.runtime.lastError?.message;
          const result = results?.[0]?.result as { ok?: boolean; message?: string } | undefined;
          const ok = !scriptError && Boolean(result?.ok);
          const message = scriptError ?? result?.message;
          appendPreviewDebugLog(
            ok ? 'converter-lab-preview-jira-dom-success' : 'converter-lab-preview-jira-dom-failed',
            {
              activeTabId,
              issueKey,
              activeTabUrl,
              scriptError,
              result,
              jiraMarkupLength: jiraMarkup.length,
              renderedHtmlLength: renderedHtml.length,
            },
          );
          resolve({ ok, message });
        },
      );
    });
  };

  const handleCancelProcessing = () => {
    cancel();
    setCurrentView('enhance');
  };

  const handleBack = () => {
    if (currentView === 'edit') {
      setCurrentView('diff');
    } else {
      setCurrentView('enhance');
    }
  };

  if (!issueKey) {
    return (
      <div className={fullPage ? 'popup-container full-page-container' : 'popup-container'}>
        <header className="popup-header">
          <h1 className="popup-title">Jira Enhancer</h1>
        </header>
        <div className="popup-body">
          <div className="empty-state">
            <p>Navigate to a Jira issue to enhance its description.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={fullPage ? 'popup-container full-page-container' : 'popup-container'}>
      <header className="popup-header">
        <h1 className="popup-title">Jira Enhancer</h1>
        <div className="header-actions">
          {currentView !== 'enhance' && currentView !== 'subtasks' && (
            <button className="btn btn-subtle back-btn" onClick={handleBack}>
              ← Back
            </button>
          )}
          {currentView !== 'enhance' && (
            <button className="btn btn-subtle" onClick={() => setCurrentView('enhance')}>
              Enhance Issue
            </button>
          )}
          {currentView !== 'subtasks' && (
            <button className="btn btn-subtle" onClick={() => setCurrentView('subtasks')}>
              Sub-tasks
            </button>
          )}
          {currentView !== 'converter-lab' && (
            <button
              className="btn btn-subtle"
              onClick={() => setCurrentView('converter-lab')}
              title="Open converter lab"
            >
              +
            </button>
          )}
          {currentView !== 'history' && (
            <button className="btn btn-subtle" onClick={() => setCurrentView('history')}>
              History
            </button>
          )}
        </div>
      </header>

      <div className="popup-body" ref={popupBodyRef} onScroll={handlePopupBodyScroll}>
        {applyStatus && currentView !== 'history' && !previewedFields && (
          <div className="status-banner">{applyStatus}</div>
        )}

        {previewedFields && currentView !== 'history' && (
          <div className="preview-apply-panel">
            <div>
              <strong>Preview ready</strong>
              <span>Apply the Jira preview that was last rendered for this issue.</span>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => void applyPreviewedFieldsWithJiraApi()}
            >
              Apply to Jira
            </button>
          </div>
        )}

        {status === 'error' && error && (
          <div className="error-banner">
            <span className="error-icon">⚠</span>
            <span className="error-text">{error}</span>
            {canRetryExpiredAwsSso && (
              <button
                type="button"
                className="btn btn-primary error-retry-btn"
                onClick={executeEnhancement}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {currentView === 'converter-lab' && (
          <ConverterLab
            currentIssueDescription={description}
            onBack={() => setCurrentView('enhance')}
            onPreviewInJira={previewConverterMarkupInJiraDom}
          />
        )}

        {currentView === 'history' && (
          <div className="history-page">
            <div className="history-page-header">
              <div>
                <h2>History</h2>
                <p>Local enhancement results plus Jira changelog rollback candidates.</p>
              </div>
              <button
                type="button"
                className="btn btn-default"
                onClick={() => void refreshJiraHistory()}
              >
                Refresh Jira changelog
              </button>
            </div>
            {jiraHistoryStatus && <div className="status-banner">{jiraHistoryStatus}</div>}
            <div className="history-list">
              {allHistoryEntries.length === 0 ? (
                <p className="history-empty">No local or Jira history found yet.</p>
              ) : (
                allHistoryEntries.map((entry) => (
                  <div className="history-card" key={entry.id}>
                    <div className="history-card-main">
                      <strong>{entry.title}</strong>
                      <span>{entry.subtitle || new Date(entry.createdAt).toLocaleString()}</span>
                      <p>{entry.summary}</p>
                      <div className="history-badges">
                        <span>{entry.source === 'local' ? 'Local' : 'Jira REST'}</span>
                        {entry.changedFields.map((fieldKey) => (
                          <span key={fieldKey}>{formatHistoryFieldLabel(fieldKey)}</span>
                        ))}
                      </div>
                    </div>
                    <div className="history-actions">
                      <button
                        type="button"
                        className="btn btn-subtle"
                        onClick={() =>
                          setSelectedHistoryEntry((current) =>
                            current?.id === entry.id ? null : entry,
                          )
                        }
                      >
                        {selectedHistoryEntry?.id === entry.id ? 'Close view' : 'View'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-subtle"
                        onClick={() =>
                          historyCompareEntry?.id === entry.id
                            ? (setHistoryCompareEntry(null), setHistoryCurrentFields(null))
                            : void compareHistoryWithCurrent(entry)
                        }
                      >
                        {historyCompareEntry?.id === entry.id
                          ? 'Close compare'
                          : 'Compare with current'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-default"
                        onClick={() => previewFieldsInSourceTab(entry.fields, entry.id)}
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void applyHistoryEntry(entry)}
                      >
                        Apply…
                      </button>
                    </div>
                    {selectedHistoryEntry?.id === entry.id && (
                      <div className="history-card-detail">
                        <div className="history-detail-header">
                          <div>
                            <h3>Viewing history entry</h3>
                            <p>
                              {entry.title} ·{' '}
                              {entry.subtitle || new Date(entry.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        {historyFieldKeys
                          .filter((fieldKey) => entry.fields[fieldKey])
                          .map((fieldKey) => (
                            <div className="history-detail-field" key={fieldKey}>
                              <strong>{formatHistoryFieldLabel(fieldKey)}</strong>
                              <pre className="review-preformatted">{entry.fields[fieldKey]}</pre>
                            </div>
                          ))}
                      </div>
                    )}
                    {historyCompareEntry?.id === entry.id && historyCurrentFields && (
                      <div className="history-card-detail">
                        <div className="history-detail-header">
                          <div>
                            <h3>Compare with current Jira fields</h3>
                            <p>
                              {entry.title} ·{' '}
                              {entry.subtitle || new Date(entry.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="btn btn-subtle"
                            onClick={() => {
                              setHistoryCompareEntry(null);
                              setHistoryCurrentFields(null);
                            }}
                          >
                            Close compare
                          </button>
                        </div>
                        {historyCompareRows.map(([fieldKey, label]) => (
                          <div className="history-detail-field" key={fieldKey}>
                            <strong>{label}</strong>
                            <div className="diff-viewer-container compact-diff">
                              <ReactDiffViewer
                                oldValue={historyCurrentFields[fieldKey] || ''}
                                newValue={entry.fields[fieldKey] || ''}
                                splitView
                                compareMethod={DiffMethod.WORDS}
                                showDiffOnly={false}
                                leftTitle="Current Jira"
                                rightTitle="Historical"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {currentView === 'subtasks' && (
          <>
            <SubtaskPanel
              issueKey={issueKey}
              fields={enhancementFields}
              enhancedFields={enhancedFields ?? undefined}
              reusableSession={enhancementSessionRef}
              onGenerate={handleGenerateSubtasks}
              isProcessing={isSubtaskProcessing}
            />

            {subtaskHistory.length > 0 && (
              <details className="previous-results" open={fullPage}>
                <summary>Previous sub-task generations ({subtaskHistory.length})</summary>
                <div className="previous-results-list">
                  {subtaskHistory.map((entry) => (
                    <div className="previous-result-card" key={entry.id}>
                      <div>
                        <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                        <span>{entry.result.subtasks.length} proposed sub-tasks</span>
                      </div>
                      <div className="previous-result-actions">
                        <button
                          type="button"
                          className="btn btn-default"
                          onClick={() => {
                            loadCompletedSubtaskResult(entry.result, entry.sessionRef);
                            setEditedSubtasks(entry.result.subtasks);
                            setCurrentView('subtask-review');
                          }}
                        >
                          Review without rerun
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {currentView === 'subtask-activity' && (
          <div className="activity-panel">
            <div className="review-header activity-header-row">
              <div>
                <h2>Harness is generating sub-task definitions</h2>
                <p>
                  Session reuse is intentional when enabled; the harness can use context from the
                  issue enhancement.
                </p>
              </div>
              <div className="activity-header-actions">
                <div className="activity-status-pill" aria-label={`Status: ${subtaskStatus}`}>
                  <span className="mini-spinner" />
                  <span>{subtaskStatus}</span>
                  {subtaskProgress !== undefined && <span>{Math.round(subtaskProgress)}%</span>}
                </div>
              </div>
            </div>
            {subtaskError && (
              <div className="error-banner">
                <span className="error-text">{subtaskError}</span>
              </div>
            )}
            <div className="processing-panel">
              <div className="processing-log">
                {subtaskProcessingRows.length === 0 ? (
                  <div className="description-read-status">Waiting for harness processing…</div>
                ) : (
                  subtaskProcessingRows.map((row, index) => (
                    <div className={`processing-row ${row.kind}`} key={`${row.timestamp}-${index}`}>
                      <span className="processing-kind">{row.label}</span>
                      <span className="processing-text">{row.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === 'subtask-review' && (
          <div className="review-panel">
            <div className="review-header">
              <h2>Review generated sub-task definitions</h2>
              <p>
                Edit the generated sub-tasks before accepting them into local history. Jira creation
                will be an explicit later step.
              </p>
            </div>
            <div className="field-review-grid">
              {editedSubtasks.map((subtask, index) => (
                <div className="field-review-card" key={subtask.id || index}>
                  <label className="field-label">Title</label>
                  <input
                    className="text-input"
                    value={subtask.title}
                    onChange={(event) =>
                      setEditedSubtasks((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, title: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <label className="field-label">Category</label>
                  <input
                    className="text-input"
                    value={subtask.category}
                    onChange={(event) =>
                      setEditedSubtasks((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                category: event.target.value as GeneratedSubtask['category'],
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <label className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={subtask.required}
                      onChange={(event) =>
                        setEditedSubtasks((items) =>
                          items.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, required: event.target.checked }
                              : item,
                          ),
                        )
                      }
                    />
                    <span>Required</span>
                  </label>
                  <label className="field-label">Description</label>
                  <textarea
                    className="review-output field-review-editor"
                    value={subtask.description}
                    rows={8}
                    onChange={(event) =>
                      setEditedSubtasks((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, description: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            {subtaskResult?.notes && (
              <div className="field-group">
                <label className="field-label">Harness notes</label>
                <pre className="review-preformatted">{subtaskResult.notes}</pre>
              </div>
            )}
            <div className="action-bar">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!issueKey || !subtaskResult) return;
                  const editedResult = { ...subtaskResult, subtasks: editedSubtasks };
                  const savedResult: StoredSubtaskGeneration = {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    issueKey,
                    createdAt: Date.now(),
                    result: editedResult,
                    sessionRef: subtaskSessionRef ?? undefined,
                  };
                  setSubtaskHistory(saveSubtaskGenerationToHistory(savedResult));
                  setCurrentView('subtasks');
                }}
              >
                Accept generation
              </button>
              <button
                type="button"
                className="btn btn-default"
                onClick={() => setCurrentView('subtasks')}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {currentView === 'enhance' && (
          <>
            <div className="field-group">
              <label className="field-label" htmlFor="description-input">
                Current Description
              </label>
              <div className="description-read-row">
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={autoReadDescription}
                    onChange={(e) => setAutoReadDescription(e.target.checked)}
                    disabled={isProcessing}
                  />
                  <span>Read automatically from the current Jira page</span>
                </label>
                <button
                  type="button"
                  className="btn btn-subtle"
                  onClick={readDescriptionFromCurrentPage}
                  disabled={isProcessing || activeTabId === null}
                >
                  Refresh
                </button>
              </div>
              {descriptionReadStatus && (
                <div className="description-read-status">{descriptionReadStatus}</div>
              )}
              <textarea
                id="description-input"
                className="description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Paste the Jira issue description here…"
                rows={6}
                disabled={isProcessing}
              />
            </div>

            {isStoryIssue && (
              <>
                <div className="field-group compact-field-group">
                  <label className="field-label" htmlFor="story-points-input">
                    Story Points
                  </label>
                  <input
                    id="story-points-input"
                    type="text"
                    className="text-input"
                    value={storyPoints}
                    onChange={(e) => setStoryPoints(e.target.value)}
                    placeholder="Story points…"
                    disabled={isProcessing}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label" htmlFor="acceptance-criteria-input">
                    Acceptance Criteria
                  </label>
                  <textarea
                    id="acceptance-criteria-input"
                    className="description-input acceptance-criteria-input"
                    value={acceptanceCriteria}
                    onChange={(e) => setAcceptanceCriteria(e.target.value)}
                    placeholder="Paste or load acceptance criteria here…"
                    rows={4}
                    disabled={isProcessing}
                  />
                </div>
              </>
            )}

            {resultHistory.length > 0 && (
              <details className="previous-results" open={fullPage}>
                <summary>Previous enhancement results ({resultHistory.length})</summary>
                {resultHistory.length > 1 && showPreviousCompare && (
                  <div className="previous-compare-panel">
                    <div className="previous-compare-controls">
                      <label>
                        Compare from
                        <select
                          value={compareLeftId}
                          onChange={(e) => selectCompareLeft(e.target.value)}
                        >
                          <option value="">Select result…</option>
                          {resultHistory.map((result) => (
                            <option value={result.id} key={result.id}>
                              {new Date(result.createdAt).toLocaleString()}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        to
                        <select
                          value={compareRightId}
                          onChange={(e) => selectCompareRight(e.target.value)}
                        >
                          <option value="">Select result…</option>
                          {resultHistory.map((result) => (
                            <option value={result.id} key={result.id}>
                              {new Date(result.createdAt).toLocaleString()}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn btn-subtle"
                        onClick={closePreviousCompare}
                      >
                        Close compare
                      </button>
                    </div>
                    {compareLeft && compareRight && compareLeft.id !== compareRight.id ? (
                      <div className="previous-compare-diffs">
                        {compareFieldRows.map(([fieldKey, label]) => (
                          <div className="previous-compare-field" key={fieldKey}>
                            <h4>{label}</h4>
                            <div className="diff-viewer-container compact-diff">
                              <ReactDiffViewer
                                oldValue={compareLeft.enhancedFields[fieldKey] || ''}
                                newValue={compareRight.enhancedFields[fieldKey] || ''}
                                splitView
                                compareMethod={DiffMethod.WORDS}
                                showDiffOnly={false}
                                hideLineNumbers={false}
                                leftTitle="Previous"
                                rightTitle="Selected"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="previous-compare-empty">
                        Select two different results to compare.
                      </p>
                    )}
                  </div>
                )}
                <div className="previous-results-list">
                  {resultHistory.map((result) => (
                    <div className="previous-result-card" key={result.id}>
                      <div>
                        <strong>{new Date(result.createdAt).toLocaleString()}</strong>
                        <span>
                          {[result.modelProvider, result.model].filter(Boolean).join(' / ') ||
                            'Default model'}
                        </span>
                        <p>{result.enhancedFields.description}</p>
                      </div>
                      <div className="previous-result-actions">
                        <button
                          type="button"
                          className="btn btn-subtle"
                          onClick={() => selectCompareLeft(result.id)}
                        >
                          Compare from
                        </button>
                        <button
                          type="button"
                          className="btn btn-subtle"
                          onClick={() => selectCompareRight(result.id)}
                        >
                          Compare to
                        </button>
                        <button
                          type="button"
                          className="btn btn-default"
                          onClick={() => {
                            skipNextHistorySave.current = true;
                            loadCompletedResult(result);
                          }}
                        >
                          Review without rerun
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() =>
                            previewFieldsInSourceTab(
                              fieldsToJiraMarkup(result.enhancedFields),
                              result.id,
                            )
                          }
                        >
                          Preview in Jira
                        </button>
                        <button
                          type="button"
                          className="btn btn-default"
                          onClick={() => void applyPreviewedFieldsWithJiraApi()}
                          disabled={previewedSourceId !== result.id}
                          title={
                            previewedSourceId !== result.id
                              ? 'Preview this result in Jira before applying with the Jira API.'
                              : undefined
                          }
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <EnhancePanel
              issueKey={issueKey}
              components={components}
              onEnhance={handleEnhance}
              isProcessing={isProcessing}
            />
          </>
        )}

        {currentView === 'review-request' && (
          <div className="review-panel">
            <div className="review-header">
              <h2>Review enhancement request</h2>
              <p>
                Check the Jira fields and harness settings below. When everything looks right, start
                the harness enhancement.
              </p>
            </div>
            <div className="metadata-grid">
              <div>
                <strong>Harness</strong>
                <span>{pendingEnhancement?.app}</span>
              </div>
              <div>
                <strong>Provider</strong>
                <span>{pendingEnhancement?.modelProvider || 'Default'}</span>
              </div>
              <div>
                <strong>Model</strong>
                <span>{pendingEnhancement?.model || 'Default'}</span>
              </div>
              <div>
                <strong>Launch path</strong>
                <span>{pendingEnhancement?.launchPath || 'Configured project path'}</span>
              </div>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="enhancement-input-preview">
                Prompt sent to harness
              </label>
              <textarea
                id="enhancement-input-preview"
                className="review-output"
                value={promptPreview}
                readOnly
                rows={12}
              />
            </div>
            {pendingEnhancement?.customPrompt && (
              <div className="field-group">
                <label className="field-label">Custom instructions</label>
                <pre className="review-preformatted">{pendingEnhancement.customPrompt}</pre>
              </div>
            )}
            <div className="action-bar">
              <button
                className="btn btn-primary"
                onClick={executeEnhancement}
                disabled={isProcessing}
              >
                Enhance
              </button>
              <button className="btn btn-default" onClick={() => setCurrentView('enhance')}>
                Back to edit
              </button>
            </div>
          </div>
        )}

        {currentView === 'activity' && (
          <div className="activity-panel">
            <div className="review-header activity-header-row">
              <div>
                <h2>Harness is enhancing the Jira fields</h2>
                <p>
                  Keep this page open to watch live activity, or come back later. The latest state
                  is restored when you reopen the enhancer.
                </p>
              </div>
              <div className="activity-header-actions">
                <div className="activity-status-pill" aria-label={`Status: ${status}`}>
                  <span className="mini-spinner" />
                  <span>{status}</span>
                  {progress !== undefined && <span>{Math.round(progress)}%</span>}
                </div>
                <button type="button" className="btn btn-default" onClick={handleCancelProcessing}>
                  Stop/reset
                </button>
              </div>
            </div>
            <div className="processing-panel">
              <div className="harness-activity-header">
                <div>
                  <div className="field-label">Processing</div>
                  <p className="processing-help">
                    Readable harness reasoning, tool calls, and results.
                  </p>
                </div>
              </div>
              <div
                className="processing-log"
                ref={processingLogRef}
                onScroll={handleProcessingScroll}
              >
                {processingRows.length === 0 ? (
                  <div className="description-read-status">Waiting for harness processing…</div>
                ) : (
                  processingRows.map((row, index) => (
                    <div className={`processing-row ${row.kind}`} key={`${row.timestamp}-${index}`}>
                      <span className="processing-kind">{row.label}</span>
                      <span className="processing-text">{row.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {currentView === 'diff' && (
          <>
            <div className="review-panel">
              <div className="review-header">
                <h2>Review enhanced Jira fields</h2>
                <p>
                  The harness has finished. Review the generated Jira-formatted fields below, edit
                  if needed, then accept to write them back to Jira.
                </p>
              </div>
              <div className="action-bar review-mode-bar">
                <button
                  className="btn btn-default"
                  type="button"
                  onClick={() => setShowReadOnlyDiff((value) => !value)}
                >
                  {showReadOnlyDiff ? 'Edit enhanced fields' : 'View read-only diff'}
                </button>
              </div>
              <div className="field-review-grid">
                {reviewFieldRows.map(([fieldKey, label]) => (
                  <div className="field-review-card" key={fieldKey}>
                    <h3>{label}</h3>
                    {showReadOnlyDiff ? (
                      <div className="diff-viewer-container">
                        <ReactDiffViewer
                          oldValue={restoreImageUrls(displayOriginalFields[fieldKey] || '')}
                          newValue={restoreImageUrls(editedFields[fieldKey] || '')}
                          splitView
                          compareMethod={DiffMethod.WORDS}
                          showDiffOnly={false}
                          hideLineNumbers={false}
                          leftTitle="Original"
                          rightTitle="Enhanced"
                        />
                      </div>
                    ) : (
                      <div className="field-review-columns">
                        <div>
                          <label className="field-label" htmlFor={`original-${fieldKey}`}>
                            Original
                          </label>
                          <textarea
                            id={`original-${fieldKey}`}
                            className="review-output field-review-editor"
                            value={restoreImageUrls(displayOriginalFields[fieldKey] || '')}
                            readOnly
                            rows={fieldKey === 'storyPoints' ? 2 : 8}
                          />
                        </div>
                        <div>
                          <label className="field-label" htmlFor={`edited-${fieldKey}`}>
                            Enhanced (editable)
                          </label>
                          <textarea
                            id={`edited-${fieldKey}`}
                            className="review-output field-review-editor"
                            value={restoreImageUrls(editedFields[fieldKey] || '')}
                            onChange={(event) =>
                              setEditedFields((current) => ({
                                ...current,
                                [fieldKey]: event.target.value,
                              }))
                            }
                            rows={fieldKey === 'storyPoints' ? 2 : 8}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {displayEnhancedFields.notes && (
                <div className="field-group">
                  <label className="field-label">Harness notes</label>
                  <pre className="review-preformatted">{displayEnhancedFields.notes}</pre>
                </div>
              )}
            </div>
            <div className="action-bar">
              <button className="btn btn-primary" onClick={handlePreview}>
                Preview in Jira
              </button>
              <button
                className="btn btn-default"
                onClick={() => void applyPreviewedFieldsWithJiraApi()}
                disabled={!previewedFields}
                title={
                  !previewedFields
                    ? 'Preview in Jira before applying with the Jira API.'
                    : undefined
                }
              >
                Apply
              </button>
              <button className="btn btn-default" onClick={handleEdit}>
                Edit
              </button>
              <button className="btn btn-default" onClick={handleNewAlternative}>
                New Alternative
              </button>
            </div>
          </>
        )}

        {currentView === 'edit' && (
          <>
            <MarkdownEditor value={editedDescription} onChange={setEditedDescription} />
            <div className="action-bar">
              <button className="btn btn-primary" onClick={handlePreview}>
                Preview edited in Jira
              </button>
              <button
                className="btn btn-default"
                onClick={() => void applyPreviewedFieldsWithJiraApi()}
                disabled={!previewedFields}
                title={
                  !previewedFields
                    ? 'Preview in Jira before applying with the Jira API.'
                    : undefined
                }
              >
                Apply
              </button>
              <button className="btn btn-default" onClick={handleBack}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
