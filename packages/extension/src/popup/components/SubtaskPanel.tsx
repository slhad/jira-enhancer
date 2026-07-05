import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildSubtaskGenerationPrompt, MessageType } from '@jira-enhancer/shared';
import { filterIgnoredModelProviders } from '../model-filter';
import type {
  EnhanceMode,
  HarnessSafetyMode,
  HarnessSessionRef,
  JiraEnhancementFields,
  LlmApp,
  ListModelsResponse,
  ModelInfo,
  StructuredEnhancementResult,
} from '@jira-enhancer/shared';

interface SubtaskPanelProps {
  issueKey: string;
  fields: JiraEnhancementFields;
  enhancedFields?: StructuredEnhancementResult;
  reusableSession?: HarnessSessionRef | null;
  onGenerate: (
    mode: EnhanceMode,
    app: LlmApp,
    modelProvider?: string,
    model?: string,
    launchPath?: string,
    customPrompt?: string,
    env?: Record<string, string>,
    safetyMode?: HarnessSafetyMode,
    sessionRef?: HarnessSessionRef,
    reuseSession?: boolean,
    titleOnly?: boolean,
    availableSubtaskCategories?: string[],
    titleMaxLength?: number,
  ) => void;
  isProcessing: boolean;
  availableSubtaskCategories?: string[];
}

interface SavedSubtaskPrompt {
  id: string;
  name: string;
  prompt: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_SUBTASK_PROMPT = `Generate a useful default set of Jira sub-task definitions.

Include Pull Request, Copilot Quality, QA Tests, Dev Tests, Unit Tests if needed, Documentation if needed, Release Procedure if needed, and implementation sub-tasks for the important issue steps.`;

function loadSavedPrompts(): SavedSubtaskPrompt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('jiraEnhancer.subtaskPrompts') || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is SavedSubtaskPrompt =>
            entry &&
            typeof entry === 'object' &&
            typeof entry.id === 'string' &&
            typeof entry.name === 'string' &&
            typeof entry.prompt === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function parseEnvText(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .flatMap((line) => {
        const separator = line.indexOf('=');
        if (separator <= 0) return [];
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? [[key, value]] : [];
      }),
  );
}

export function SubtaskPanel({
  issueKey,
  fields,
  enhancedFields,
  reusableSession,
  onGenerate,
  isProcessing,
  availableSubtaskCategories = [],
}: SubtaskPanelProps) {
  const [mode, setMode] = useState<EnhanceMode>(
    () => (localStorage.getItem('jiraEnhancer.subtaskMode') as EnhanceMode) || 'default',
  );
  const [app, setApp] = useState<LlmApp>(
    () => (localStorage.getItem('jiraEnhancer.harness') as LlmApp) || 'opencode',
  );
  const [modelProvider, setModelProvider] = useState(
    () => localStorage.getItem('jiraEnhancer.provider') || '',
  );
  const [model, setModel] = useState(() => localStorage.getItem('jiraEnhancer.model') || '');
  const [launchPath, setLaunchPath] = useState(
    () => localStorage.getItem('jiraEnhancer.launchPath') || '',
  );
  const [safetyMode, setSafetyMode] = useState<HarnessSafetyMode>(
    () => (localStorage.getItem('jiraEnhancer.safetyMode') as HarnessSafetyMode) || 'read-only',
  );
  const [envText, setEnvText] = useState(
    () => localStorage.getItem(`jiraEnhancer.harnessEnv.${app}`) || '',
  );
  const [customPromptTitle, setCustomPromptTitle] = useState(
    () => localStorage.getItem('jiraEnhancer.subtaskPromptTitleDraft') || '',
  );
  const [customPrompt, setCustomPrompt] = useState(
    () => localStorage.getItem('jiraEnhancer.subtaskPromptDraft') || DEFAULT_SUBTASK_PROMPT,
  );
  const [savedPrompts, setSavedPrompts] = useState<SavedSubtaskPrompt[]>(() => loadSavedPrompts());
  const [selectedPromptId, setSelectedPromptId] = useState(
    () => localStorage.getItem('jiraEnhancer.selectedSubtaskPromptId') || '',
  );
  const [reuseSession, setReuseSession] = useState(() => Boolean(reusableSession));
  const [titleOnly, setTitleOnly] = useState(
    () => localStorage.getItem('jiraEnhancer.subtaskTitleOnly') !== 'false',
  );
  const [titleMaxLength, setTitleMaxLength] = useState(
    () => localStorage.getItem('jiraEnhancer.subtaskTitleMaxLength') || '80',
  );
  const [models, setModels] = useState<ModelInfo[]>([]);
  const previousAppRef = useRef(app);
  const skipNextEnvSaveRef = useRef(false);
  const [modeCollapsed, setModeCollapsed] = useState(true);
  const [contentCollapsed, setContentCollapsed] = useState(true);
  const [sessionCollapsed, setSessionCollapsed] = useState(true);
  const [harnessCollapsed, setHarnessCollapsed] = useState(true);
  const [launchPathCollapsed, setLaunchPathCollapsed] = useState(true);
  const [safetyCollapsed, setSafetyCollapsed] = useState(true);
  const [modelConfigCollapsed, setModelConfigCollapsed] = useState(true);

  const locked = Boolean(reuseSession && reusableSession);
  const harnessEnv = useMemo(() => parseEnvText(envText), [envText]);

  useEffect(() => setReuseSession(Boolean(reusableSession)), [reusableSession]);
  useEffect(() => localStorage.setItem('jiraEnhancer.subtaskMode', mode), [mode]);
  useEffect(
    () => localStorage.setItem('jiraEnhancer.subtaskTitleOnly', String(titleOnly)),
    [titleOnly],
  );
  useEffect(() => {
    localStorage.setItem('jiraEnhancer.subtaskTitleMaxLength', titleMaxLength);
  }, [titleMaxLength]);
  useEffect(
    () => localStorage.setItem('jiraEnhancer.subtaskPromptTitleDraft', customPromptTitle),
    [customPromptTitle],
  );
  useEffect(
    () => localStorage.setItem('jiraEnhancer.subtaskPromptDraft', customPrompt),
    [customPrompt],
  );
  useEffect(
    () => localStorage.setItem('jiraEnhancer.subtaskPrompts', JSON.stringify(savedPrompts)),
    [savedPrompts],
  );
  useEffect(() => {
    if (selectedPromptId) {
      localStorage.setItem('jiraEnhancer.selectedSubtaskPromptId', selectedPromptId);
    } else {
      localStorage.removeItem('jiraEnhancer.selectedSubtaskPromptId');
    }
  }, [selectedPromptId]);
  useEffect(() => {
    if (previousAppRef.current === app) return;
    skipNextEnvSaveRef.current = true;
    setEnvText(localStorage.getItem(`jiraEnhancer.harnessEnv.${app}`) || '');
    previousAppRef.current = app;
  }, [app]);

  useEffect(() => {
    if (skipNextEnvSaveRef.current) {
      skipNextEnvSaveRef.current = false;
      return;
    }
    localStorage.setItem(`jiraEnhancer.harnessEnv.${app}`, envText);
  }, [app, envText]);

  useEffect(() => {
    if (locked && reusableSession) {
      setApp(reusableSession.app);
      setModelProvider(reusableSession.provider ?? '');
      setModel(reusableSession.model ?? '');
      setLaunchPath(reusableSession.launchPath ?? '');
      setSafetyMode(reusableSession.safetyMode ?? 'read-only');
      return;
    }
    localStorage.setItem('jiraEnhancer.harness', app);
    localStorage.setItem('jiraEnhancer.provider', modelProvider);
    localStorage.setItem('jiraEnhancer.model', model);
    localStorage.setItem('jiraEnhancer.launchPath', launchPath);
    localStorage.setItem('jiraEnhancer.safetyMode', safetyMode);
  }, [app, locked, model, modelProvider, launchPath, reusableSession, safetyMode]);

  useEffect(() => {
    const id = crypto.randomUUID();
    chrome.runtime.sendMessage(
      { type: MessageType.LIST_MODELS_REQUEST, id, app, env: harnessEnv },
      (response?: ListModelsResponse) => {
        if (chrome.runtime.lastError || !response) return;
        if (response.type === MessageType.LIST_MODELS_RESPONSE && response.id === id) {
          setModels(filterIgnoredModelProviders(response.models));
        }
      },
    );
  }, [app, harnessEnv]);

  const providerOptions = useMemo(
    () => Array.from(new Set(models.map((entry) => entry.provider))).sort(),
    [models],
  );
  const modelOptions = useMemo(
    () => models.filter((entry) => entry.provider === modelProvider),
    [modelProvider, models],
  );

  useEffect(() => {
    if (providerOptions.length === 0 || locked) return;
    if (!modelProvider || !providerOptions.includes(modelProvider)) {
      setModelProvider(providerOptions[0]);
    }
  }, [locked, modelProvider, providerOptions]);

  const savePrompt = () => {
    const now = Date.now();
    const name = (customPromptTitle.trim() || 'Sub-task prompt').slice(0, 60);
    const existing = selectedPromptId
      ? savedPrompts.find((prompt) => prompt.id === selectedPromptId)
      : undefined;
    const nextPrompt: SavedSubtaskPrompt = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      prompt: customPrompt,
      favorite: existing?.favorite ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    setSavedPrompts([nextPrompt, ...savedPrompts.filter((prompt) => prompt.id !== nextPrompt.id)]);
    setSelectedPromptId(nextPrompt.id);
  };

  const sortedSavedPrompts = useMemo(
    () =>
      [...savedPrompts].sort((left, right) => {
        if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
        return right.updatedAt - left.updatedAt;
      }),
    [savedPrompts],
  );

  const selectedSavedPrompt = useMemo(
    () => savedPrompts.find((prompt) => prompt.id === selectedPromptId),
    [savedPrompts, selectedPromptId],
  );

  const togglePromptFavorite = () => {
    if (!selectedPromptId) return;
    setSavedPrompts((prompts) =>
      prompts.map((prompt) =>
        prompt.id === selectedPromptId
          ? { ...prompt, favorite: !prompt.favorite, updatedAt: Date.now() }
          : prompt,
      ),
    );
  };

  const deleteSelectedPrompt = () => {
    if (!selectedPromptId) return;
    setSavedPrompts((prompts) => prompts.filter((prompt) => prompt.id !== selectedPromptId));
    setSelectedPromptId('');
  };

  const selectedSession = locked ? reusableSession : undefined;
  const selectedApp = selectedSession?.app ?? app;
  const selectedProvider = (selectedSession?.provider ?? modelProvider) || undefined;
  const selectedModel = (selectedSession?.model ?? model) || undefined;
  const selectedLaunchPath = (selectedSession?.launchPath ?? launchPath) || undefined;
  const selectedSafetyMode = selectedSession?.safetyMode ?? safetyMode;
  const sessionLabel = reusableSession
    ? `${reusableSession.app === 'pi' ? 'Pi' : 'OpenCode'} · ${reusableSession.model ?? 'Default model'} · ${reusableSession.launchPath ?? 'Configured path'}`
    : 'Unavailable until an enhancement session exists for this issue';
  const modelConfigLabel = `${modelProvider || 'Default provider'} → ${model || 'Default model'}`;
  const titleMaxLengthNumber = Math.max(20, Number(titleMaxLength) || 80);
  const fieldSummary =
    [
      fields.description ? 'Description' : undefined,
      fields.acceptanceCriteria !== undefined ? 'Acceptance Criteria' : undefined,
      fields.storyPoints !== undefined ? 'Story Points' : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || 'No fields loaded';
  const promptPreview = buildSubtaskGenerationPrompt(
    issueKey,
    fields,
    enhancedFields,
    mode === 'custom' ? customPrompt : undefined,
    {
      modelProvider: selectedProvider,
      model: selectedModel,
      safetyMode: selectedSafetyMode,
      sessionRef: selectedSession,
      reuseSession: Boolean(selectedSession),
      subtaskTitleOnly: titleOnly,
      availableSubtaskCategories,
      subtaskTitleMaxLength: titleMaxLengthNumber,
    },
  );

  return (
    <div className="review-panel subtask-panel">
      <div className="review-header">
        <h2>Generate sub-task definitions</h2>
        <p>
          Review the issue context and harness settings before asking the harness to propose
          editable Jira sub-task definitions. No Jira issues are created by this step.
        </p>
      </div>
      <div className="metadata-grid">
        <div>
          <strong>Issue</strong>
          <span>{issueKey}</span>
        </div>
        <div>
          <strong>Context</strong>
          <span>{enhancedFields ? 'Enhanced result available' : 'Raw Jira fields'}</span>
        </div>
        <div>
          <strong>Fields</strong>
          <span>{fieldSummary}</span>
        </div>
        <div>
          <strong>Output</strong>
          <span>{titleOnly ? 'Titles only' : 'Titles + descriptions'}</span>
        </div>
        <div>
          <strong>Title limit</strong>
          <span>{titleMaxLengthNumber} characters</span>
        </div>
        <div>
          <strong>Jira sub-task types</strong>
          <span className="metadata-wrap">
            {availableSubtaskCategories.length > 0
              ? availableSubtaskCategories.join(' · ')
              : 'Unavailable — using editable fallback categories'}
          </span>
        </div>
      </div>
      {availableSubtaskCategories.length === 0 && (
        <div className="description-read-status">
          Jira sub-task types could not be loaded from create metadata. Category remains editable
          free text and the harness will use fallback task families.
        </div>
      )}

      <div className="field-group launch-config-card mode-config-card">
        <div className="launch-config-header">
          <span className="field-label">Sub-task Mode</span>
          <button
            type="button"
            className="btn btn-subtle launch-collapse-toggle"
            onClick={() => setModeCollapsed((collapsed) => !collapsed)}
            disabled={isProcessing}
          >
            {modeCollapsed ? (mode === 'custom' ? 'Custom' : 'Default') : 'Collapse mode settings'}
          </button>
        </div>
        {!modeCollapsed && (
          <>
            <div className="radio-group safety-mode-group">
              <label className="radio-option safety-mode-option">
                <input
                  type="radio"
                  name="subtask-mode"
                  value="default"
                  checked={mode === 'default'}
                  onChange={() => setMode('default')}
                  disabled={isProcessing}
                />
                <span className="radio-text">Default</span>
                <span className="radio-description">
                  Generate standard delivery tasks plus issue-specific implementation steps
                </span>
              </label>
              <label className="radio-option safety-mode-option">
                <input
                  type="radio"
                  name="subtask-mode"
                  value="custom"
                  checked={mode === 'custom'}
                  onChange={() => setMode('custom')}
                  disabled={isProcessing}
                />
                <span className="radio-text">Custom</span>
                <span className="radio-description">Use saved or custom sub-task instructions</span>
              </label>
            </div>

            {mode === 'custom' ? (
              <div className="compact-field-group custom-prompt-section">
                <label className="field-label" htmlFor="subtask-prompt-select">
                  Custom Prompt
                </label>
                <div className="prompt-select-row">
                  <select
                    id="subtask-prompt-select"
                    className="provider-select"
                    value={selectedPromptId}
                    onChange={(event) => {
                      const prompt = savedPrompts.find((entry) => entry.id === event.target.value);
                      setSelectedPromptId(event.target.value);
                      if (prompt) {
                        setCustomPromptTitle(prompt.name);
                        setCustomPrompt(prompt.prompt);
                      }
                    }}
                    disabled={isProcessing || savedPrompts.length === 0}
                  >
                    <option value="">Saved prompts…</option>
                    {sortedSavedPrompts.map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        {prompt.favorite ? '★ ' : ''}
                        {prompt.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-subtle"
                    onClick={() => {
                      setSelectedPromptId('');
                      setCustomPromptTitle('');
                      setCustomPrompt(DEFAULT_SUBTASK_PROMPT);
                    }}
                    disabled={isProcessing}
                  >
                    Starter
                  </button>
                </div>
                <input
                  className="path-input prompt-title-input"
                  type="text"
                  value={customPromptTitle}
                  onChange={(event) => setCustomPromptTitle(event.target.value)}
                  placeholder="Prompt title, e.g. Release-heavy backend task split"
                  disabled={isProcessing}
                />
                <textarea
                  className="custom-prompt-input"
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                  disabled={isProcessing}
                  rows={7}
                />
                <div className="launch-actions custom-prompt-actions">
                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={savePrompt}
                    disabled={isProcessing || !customPrompt.trim()}
                  >
                    {selectedPromptId ? 'Update prompt' : 'Save prompt'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-subtle"
                    onClick={() => setCustomPrompt(DEFAULT_SUBTASK_PROMPT)}
                    disabled={isProcessing}
                  >
                    Reset starter
                  </button>
                  <button
                    type="button"
                    className="btn btn-subtle"
                    onClick={togglePromptFavorite}
                    disabled={isProcessing || !selectedPromptId}
                  >
                    {selectedSavedPrompt?.favorite ? 'Unfavorite' : 'Favorite'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-subtle"
                    onClick={deleteSelectedPrompt}
                    disabled={isProcessing || !selectedPromptId}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="field-group launch-config-card safety-config-card">
        <div className="launch-config-header">
          <span className="field-label">Sub-task Content</span>
          <button
            type="button"
            className="btn btn-subtle launch-collapse-toggle"
            onClick={() => setContentCollapsed((collapsed) => !collapsed)}
            disabled={isProcessing}
          >
            {contentCollapsed
              ? titleOnly
                ? 'Titles only'
                : 'Titles + descriptions'
              : 'Collapse content settings'}
          </button>
        </div>
        {!contentCollapsed && (
          <>
            <label className="checkbox-row prompt-link-row">
              <input
                type="checkbox"
                checked={titleOnly}
                disabled={isProcessing}
                onChange={(event) => setTitleOnly(event.target.checked)}
              />
              <span>Generate titles only</span>
            </label>
            <div className="field-group compact-field-group">
              <label className="field-label" htmlFor="subtask-title-max-length">
                Maximum title length
              </label>
              <input
                id="subtask-title-max-length"
                className="text-input"
                type="number"
                min="20"
                max="255"
                value={titleMaxLength}
                disabled={isProcessing}
                onChange={(event) => setTitleMaxLength(event.target.value)}
              />
            </div>
            <div className="field-help">
              Enabled by default for teams that only use the Jira sub-task summary/title. Disable it
              to ask the harness for developer-ready sub-task descriptions too. The title limit is
              passed to the harness and defaults to 80 characters.
            </div>
          </>
        )}
      </div>

      <div className="field-group launch-config-card safety-config-card">
        <div className="launch-config-header">
          <span className="field-label">Reuse Enhancement Session</span>
          <button
            type="button"
            className="btn btn-subtle launch-collapse-toggle"
            onClick={() => setSessionCollapsed((collapsed) => !collapsed)}
            disabled={isProcessing}
          >
            {sessionCollapsed
              ? reuseSession && reusableSession
                ? 'Enabled'
                : 'Disabled'
              : 'Collapse session settings'}
          </button>
        </div>
        {!sessionCollapsed && (
          <>
            <label className="checkbox-row prompt-link-row">
              <input
                type="checkbox"
                checked={reuseSession && Boolean(reusableSession)}
                disabled={!reusableSession || isProcessing}
                onChange={(event) => setReuseSession(event.target.checked)}
              />
              <span>{sessionLabel}</span>
            </label>
            <div className="field-help">
              When enabled, Sub-tasks intentionally continue the same issue harness context and lock
              the harness settings below.
            </div>
          </>
        )}
      </div>

      <div className="field-group launch-config-card launch-path-card">
        <div className="launch-config-header">
          <span className="field-label">Launch Path</span>
          <button
            type="button"
            className="btn btn-subtle launch-collapse-toggle"
            onClick={() => setLaunchPathCollapsed((collapsed) => !collapsed)}
            disabled={isProcessing}
          >
            {launchPathCollapsed ? launchPath || 'Configured project path' : 'Collapse launch path'}
          </button>
        </div>
        {!launchPathCollapsed && (
          <input
            className="path-input"
            value={launchPath}
            onChange={(event) => setLaunchPath(event.target.value)}
            disabled={isProcessing || locked}
            placeholder="Global/default"
          />
        )}
      </div>

      <div className="field-group launch-config-card harness-config-card">
        <div className="launch-config-header">
          <span className="field-label">Harness</span>
          <button
            type="button"
            className="btn btn-subtle launch-collapse-toggle"
            onClick={() => setHarnessCollapsed((collapsed) => !collapsed)}
            disabled={isProcessing}
          >
            {harnessCollapsed
              ? `${app === 'pi' ? 'Pi' : 'OpenCode'}${locked ? ' · locked by session' : ''}${Object.keys(harnessEnv).length ? ` + Env settings (${Object.keys(harnessEnv).length})` : ''}`
              : 'Collapse harness settings'}
          </button>
        </div>
        {!harnessCollapsed && (
          <>
            <div className="field-group compact-field-group">
              <label className="field-label" htmlFor="subtask-harness-select">
                App
              </label>
              <select
                id="subtask-harness-select"
                className="provider-select"
                value={app}
                onChange={(event) => setApp(event.target.value as LlmApp)}
                disabled={isProcessing || locked}
              >
                <option value="opencode">OpenCode</option>
                <option value="pi">Pi</option>
              </select>
            </div>
            <label className="field-label" htmlFor="subtask-harness-env-input">
              Environment variables
            </label>
            <textarea
              id="subtask-harness-env-input"
              className="harness-env-input"
              value={envText}
              onChange={(event) => setEnvText(event.target.value)}
              disabled={isProcessing || locked}
              rows={3}
              placeholder={'AWS_PROFILE=my-profile\nAWS_REGION=eu-west-1'}
            />
          </>
        )}
      </div>

      <div className="field-group launch-config-card safety-config-card">
        <div className="launch-config-header">
          <span className="field-label">Harness Safety</span>
          <button
            type="button"
            className="btn btn-subtle launch-collapse-toggle"
            onClick={() => setSafetyCollapsed((collapsed) => !collapsed)}
            disabled={isProcessing}
          >
            {safetyCollapsed
              ? safetyMode === 'trust-ai'
                ? 'Trust AI'
                : 'Read-only'
              : 'Collapse safety settings'}
          </button>
        </div>
        {!safetyCollapsed && (
          <div className="radio-group safety-mode-group">
            <label className="radio-option safety-mode-option">
              <input
                type="radio"
                name="subtask-safety-mode"
                value="read-only"
                checked={safetyMode === 'read-only'}
                onChange={() => setSafetyMode('read-only')}
                disabled={isProcessing || locked}
              />
              <span className="radio-text">
                Read-only
                <span
                  className="info-dot"
                  title="Enforced tool allowlist. Pi can inspect with read/search/list tools only; bash, edit/write, MCP/custom tools, and mutating actions are unavailable."
                >
                  ?
                </span>
              </span>
            </label>
            <label className="radio-option safety-mode-option trust-ai-option">
              <input
                type="radio"
                name="subtask-safety-mode"
                value="trust-ai"
                checked={safetyMode === 'trust-ai'}
                onChange={() => setSafetyMode('trust-ai')}
                disabled={isProcessing || locked}
              />
              <span className="radio-text">
                Trust AI
                <span
                  className="info-dot"
                  title="No tool restriction from the bridge. The prompt still says read-only, but the harness may use available tools, skills, MCP, or bash to gather context."
                >
                  ?
                </span>
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="field-group launch-config-card model-config-card">
        <div className="launch-config-header">
          <span className="field-label">Provider / Model</span>
          <button
            type="button"
            className="btn btn-subtle launch-collapse-toggle"
            onClick={() => setModelConfigCollapsed((collapsed) => !collapsed)}
            disabled={isProcessing}
          >
            {modelConfigCollapsed
              ? locked
                ? `${modelConfigLabel} · locked`
                : modelConfigLabel
              : 'Collapse model settings'}
          </button>
        </div>
        {!modelConfigCollapsed && (
          <>
            <div className="field-group compact-field-group">
              <label className="field-label" htmlFor="subtask-model-provider-input">
                Provider
              </label>
              <select
                id="subtask-model-provider-input"
                className="provider-select"
                value={modelProvider}
                onChange={(event) => {
                  setModelProvider(event.target.value);
                  setModel('');
                }}
                disabled={isProcessing || locked}
              >
                <option value="">Default provider</option>
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group compact-field-group">
              <label className="field-label" htmlFor="subtask-model-input">
                Model
              </label>
              <select
                id="subtask-model-input"
                className="provider-select"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={isProcessing || locked}
              >
                <option value="">Default model</option>
                {modelOptions.map((entry) => (
                  <option key={`${entry.provider}/${entry.model}`} value={entry.model}>
                    {entry.model}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <details className="review-command-details">
        <summary>Prompt sent to harness</summary>
        <pre className="review-preformatted command-preview">{promptPreview}</pre>
      </details>

      <div className="action-bar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={isProcessing || !issueKey || !fields.description}
          onClick={() =>
            onGenerate(
              mode,
              selectedApp,
              selectedProvider,
              selectedModel,
              selectedLaunchPath,
              mode === 'custom' ? customPrompt : undefined,
              harnessEnv,
              selectedSafetyMode,
              selectedSession,
              Boolean(selectedSession),
              titleOnly,
              availableSubtaskCategories,
              titleMaxLengthNumber,
            )
          }
        >
          {isProcessing ? 'Generating…' : 'Generate sub-tasks'}
        </button>
      </div>
    </div>
  );
}
