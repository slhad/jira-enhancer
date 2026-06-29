import React, { useEffect, useMemo, useState } from 'react';
import { MessageType } from '@jira-enhancer/shared';
import type {
  EnhanceMode,
  HarnessSafetyMode,
  LlmApp,
  ListModelsResponse,
  ModelInfo,
} from '@jira-enhancer/shared';

interface SavedCustomPrompt {
  id: string;
  name: string;
  prompt: string;
  favorite: boolean;
  launchPath?: string;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_CUSTOM_PROMPT = `Use the default Jira enhancement behavior, then apply these extra preferences:

- Make the issue developer-ready and concrete.
- Preserve the original intent and do not invent requirements.
- Improve structure, wording, edge cases, and testability.
- Keep Jira fields independent: description stays description, acceptance criteria stay acceptance criteria, story points stay a short value when present.
- Mention assumptions or notable changes in notes only when useful.`;

function loadSavedCustomPrompts(): SavedCustomPrompt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('jiraEnhancer.customPrompts') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedCustomPrompt =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        typeof entry.name === 'string' &&
        typeof entry.prompt === 'string',
    );
  } catch {
    return [];
  }
}

function makePromptName(name: string): string {
  return (name.trim() || 'Custom prompt').slice(0, 60);
}

interface EnhancePanelProps {
  issueKey: string;
  components: string[];
  onEnhance: (
    mode: EnhanceMode,
    app: LlmApp,
    modelProvider?: string,
    model?: string,
    launchPath?: string,
    customPrompt?: string,
    env?: Record<string, string>,
    safetyMode?: HarnessSafetyMode,
  ) => void;
  isProcessing: boolean;
}

export function EnhancePanel({ issueKey, components, onEnhance, isProcessing }: EnhancePanelProps) {
  const [mode, setMode] = useState<EnhanceMode>(
    () => (localStorage.getItem('jiraEnhancer.enhanceMode') as EnhanceMode) || 'default',
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
  const [componentPathMap, setComponentPathMap] = useState<Record<string, string>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('jiraEnhancer.componentPathMap') || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  });
  const [selectedComponent, setSelectedComponent] = useState('');
  const [savedLaunchPaths, setSavedLaunchPaths] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('jiraEnhancer.launchPaths') || '[]');
      return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  });
  const [customPromptTitle, setCustomPromptTitle] = useState(
    () => localStorage.getItem('jiraEnhancer.customPromptTitleDraft') || '',
  );
  const [customPrompt, setCustomPrompt] = useState(
    () => localStorage.getItem('jiraEnhancer.customPromptDraft') || DEFAULT_CUSTOM_PROMPT,
  );
  const [savedCustomPrompts, setSavedCustomPrompts] = useState<SavedCustomPrompt[]>(() =>
    loadSavedCustomPrompts(),
  );
  const [selectedPromptId, setSelectedPromptId] = useState(
    () => localStorage.getItem('jiraEnhancer.selectedCustomPromptId') || '',
  );
  const [linkPromptToLaunchPath, setLinkPromptToLaunchPath] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modeCollapsed, setModeCollapsed] = useState(true);
  const [launchPathCollapsed, setLaunchPathCollapsed] = useState(true);
  const [envCollapsed, setEnvCollapsed] = useState(true);
  const [safetyCollapsed, setSafetyCollapsed] = useState(true);
  const [modelConfigCollapsed, setModelConfigCollapsed] = useState(true);
  const [envText, setEnvText] = useState(
    () => localStorage.getItem(`jiraEnhancer.harnessEnv.${app}`) || '',
  );
  const [safetyMode, setSafetyMode] = useState<HarnessSafetyMode>(
    () => (localStorage.getItem('jiraEnhancer.safetyMode') as HarnessSafetyMode) || 'read-only',
  );

  const parseEnvText = (text: string): Record<string, string> =>
    Object.fromEntries(
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

  const harnessEnv = useMemo(() => parseEnvText(envText), [envText]);

  useEffect(() => {
    setEnvText(localStorage.getItem(`jiraEnhancer.harnessEnv.${app}`) || '');
  }, [app]);

  useEffect(() => {
    localStorage.setItem(`jiraEnhancer.harnessEnv.${app}`, envText);
  }, [app, envText]);

  useEffect(() => {
    const id = crypto.randomUUID();
    setModels([]);
    setModelsLoading(true);

    chrome.runtime.sendMessage(
      { type: MessageType.LIST_MODELS_REQUEST, id, app, env: harnessEnv },
      (response?: ListModelsResponse) => {
        setModelsLoading(false);
        if (chrome.runtime.lastError || !response) return;
        if (response.type === MessageType.LIST_MODELS_RESPONSE && response.id === id) {
          setModels(response.models);
        }
      },
    );
  }, [app, harnessEnv]);

  const modelProviders = useMemo(
    () => Array.from(new Set(models.map((entry) => entry.provider))).sort(),
    [models],
  );

  useEffect(() => {
    if (modelProviders.length === 0) return;
    if (!modelProvider || !modelProviders.includes(modelProvider)) {
      setModelProvider(modelProviders[0]);
    }
  }, [modelProvider, modelProviders]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.enhanceMode', mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.harness', app);
  }, [app]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.provider', modelProvider);
  }, [modelProvider]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.model', model);
  }, [model]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.launchPath', launchPath);
  }, [launchPath]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.safetyMode', safetyMode);
  }, [safetyMode]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.launchPaths', JSON.stringify(savedLaunchPaths));
  }, [savedLaunchPaths]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.componentPathMap', JSON.stringify(componentPathMap));
  }, [componentPathMap]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.customPromptTitleDraft', customPromptTitle);
  }, [customPromptTitle]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.customPromptDraft', customPrompt);
  }, [customPrompt]);

  useEffect(() => {
    localStorage.setItem('jiraEnhancer.customPrompts', JSON.stringify(savedCustomPrompts));
  }, [savedCustomPrompts]);

  useEffect(() => {
    if (selectedPromptId) {
      localStorage.setItem('jiraEnhancer.selectedCustomPromptId', selectedPromptId);
    } else {
      localStorage.removeItem('jiraEnhancer.selectedCustomPromptId');
    }
  }, [selectedPromptId]);

  useEffect(() => {
    const title = customPromptTitle.trim();
    const promptText = customPrompt.trim();
    const selectedPrompt = savedCustomPrompts.find((prompt) => prompt.id === selectedPromptId);
    if (selectedPrompt?.name === title && selectedPrompt.prompt === promptText) {
      return;
    }
    const matchingPrompt = savedCustomPrompts.find(
      (prompt) => prompt.name === title && prompt.prompt === promptText,
    );
    if (matchingPrompt) {
      setSelectedPromptId(matchingPrompt.id);
      setLinkPromptToLaunchPath(Boolean(matchingPrompt.launchPath));
    } else if (selectedPromptId) {
      setSelectedPromptId('');
    }
  }, [customPrompt, customPromptTitle, savedCustomPrompts, selectedPromptId]);

  useEffect(() => {
    if (components.length === 0) return;
    setSelectedComponent((current) =>
      current && components.includes(current) ? current : components[0],
    );
  }, [components]);

  useEffect(() => {
    const mappedPath = components.map((component) => componentPathMap[component]).find(Boolean);
    if (mappedPath) setLaunchPath(mappedPath);
  }, [components, componentPathMap]);

  const saveLaunchPath = () => {
    const trimmed = launchPath.trim();
    if (!trimmed) return;
    setSavedLaunchPaths((paths) => Array.from(new Set([...paths, trimmed])).sort());
    setLaunchPath(trimmed);
  };

  const removeLaunchPath = () => {
    const trimmed = launchPath.trim();
    if (!trimmed) return;
    setSavedLaunchPaths((paths) => paths.filter((path) => path !== trimmed));
  };

  const linkComponentToPath = () => {
    const trimmed = launchPath.trim();
    if (!selectedComponent || !trimmed) return;
    setComponentPathMap((mapping) => ({ ...mapping, [selectedComponent]: trimmed }));
    setSavedLaunchPaths((paths) => Array.from(new Set([...paths, trimmed])).sort());
  };

  const componentMappings = useMemo(
    () => Object.entries(componentPathMap).sort(([left], [right]) => left.localeCompare(right)),
    [componentPathMap],
  );
  const selectedComponentPath = selectedComponent ? componentPathMap[selectedComponent] : undefined;
  const shouldCollapseLaunchPath = Boolean(selectedComponentPath && launchPathCollapsed);

  const removeComponentMapping = (component: string) => {
    setComponentPathMap((mapping) => {
      const next = { ...mapping };
      delete next[component];
      return next;
    });
  };

  const formatLaunchPathLabel = (path: string): string => {
    const normalized = path.replace(/\/+$/, '');
    return normalized.split('/').filter(Boolean).pop() || path;
  };

  const currentLaunchPathLabel = formatLaunchPathLabel(launchPath.trim());

  const sortedCustomPrompts = useMemo(() => {
    const currentPath = launchPath.trim();
    return [...savedCustomPrompts].sort((left, right) => {
      const leftNonMatching = Boolean(left.launchPath && left.launchPath !== currentPath);
      const rightNonMatching = Boolean(right.launchPath && right.launchPath !== currentPath);
      if (leftNonMatching !== rightNonMatching) return leftNonMatching ? 1 : -1;
      if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
      return right.updatedAt - left.updatedAt;
    });
  }, [launchPath, savedCustomPrompts]);

  const selectedSavedPrompt = useMemo(
    () => savedCustomPrompts.find((prompt) => prompt.id === selectedPromptId),
    [savedCustomPrompts, selectedPromptId],
  );

  const saveCustomPrompt = () => {
    const trimmed = customPrompt.trim();
    if (!trimmed) return;
    const now = Date.now();
    const name = makePromptName(customPromptTitle);
    const linkedPath = linkPromptToLaunchPath ? launchPath.trim() || undefined : undefined;
    setSavedCustomPrompts((prompts) => {
      if (selectedPromptId) {
        return prompts.map((prompt) =>
          prompt.id === selectedPromptId
            ? {
                ...prompt,
                name,
                prompt: trimmed,
                launchPath: linkedPath,
                updatedAt: now,
              }
            : prompt,
        );
      }
      const created: SavedCustomPrompt = {
        id: crypto.randomUUID(),
        name,
        prompt: trimmed,
        favorite: false,
        launchPath: linkedPath,
        createdAt: now,
        updatedAt: now,
      };
      setSelectedPromptId(created.id);
      setCustomPromptTitle(name);
      return [...prompts, created];
    });
  };

  const togglePromptFavorite = () => {
    if (!selectedPromptId) return;
    setSavedCustomPrompts((prompts) =>
      prompts.map((prompt) =>
        prompt.id === selectedPromptId
          ? { ...prompt, favorite: !prompt.favorite, updatedAt: Date.now() }
          : prompt,
      ),
    );
  };

  const deleteSelectedPrompt = () => {
    if (!selectedPromptId) return;
    setSavedCustomPrompts((prompts) => prompts.filter((prompt) => prompt.id !== selectedPromptId));
    setSelectedPromptId('');
  };

  const availableModels = useMemo(
    () =>
      Array.from(
        new Set(
          models
            .filter((entry) => modelProvider && entry.provider === modelProvider)
            .map((entry) => entry.model),
        ),
      ).sort(),
    [models, modelProvider],
  );

  const modelConfigLabel = modelsLoading
    ? 'Loading providers/models…'
    : `${modelProvider || 'Default provider'} → ${model || 'Default model'}`;

  const handleEnhance = () => {
    onEnhance(
      mode,
      app,
      modelProvider.trim() || undefined,
      model.trim() || undefined,
      launchPath.trim() || undefined,
      mode === 'custom' ? customPrompt : undefined,
      harnessEnv,
      safetyMode,
    );
  };

  return (
    <div className="enhance-panel">
      <div className="detected-metadata">
        <div className="issue-key-badge">
          <span className="issue-key-label">Issue</span>
          <span className="issue-key-value">{issueKey}</span>
        </div>
        {components.map((component) => (
          <React.Fragment key={component}>
            <div className="issue-key-badge">
              <span className="issue-key-label">Component</span>
              <span className="issue-key-value">{component}</span>
            </div>
            {componentPathMap[component] && (
              <div
                className="issue-key-badge launch-path-badge"
                title={componentPathMap[component]}
              >
                <span className="issue-key-label">Launch Path</span>
                <span className="issue-key-value">
                  {formatLaunchPathLabel(componentPathMap[component])}
                </span>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="field-group launch-config-card mode-config-card">
        <div className="launch-config-header">
          <span className="field-label">Enhancement Mode</span>
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
                  name="mode"
                  value="default"
                  checked={mode === 'default'}
                  onChange={() => setMode('default')}
                  disabled={isProcessing}
                />
                <span className="radio-text">Default</span>
                <span className="radio-description">
                  Improve clarity, structure, and acceptance criteria
                </span>
              </label>
              <label className="radio-option safety-mode-option">
                <input
                  type="radio"
                  name="mode"
                  value="custom"
                  checked={mode === 'custom'}
                  onChange={() => setMode('custom')}
                  disabled={isProcessing}
                />
                <span className="radio-text">Custom</span>
                <span className="radio-description">Provide your own enhancement instructions</span>
              </label>
            </div>

            {mode === 'custom' && (
              <div className="compact-field-group custom-prompt-section">
                <label className="field-label" htmlFor="custom-prompt-select">
                  Custom Prompt
                </label>
                <div className="prompt-select-row">
                  <select
                    id="custom-prompt-select"
                    className="provider-select"
                    value={selectedPromptId}
                    onChange={(e) => {
                      const prompt = savedCustomPrompts.find(
                        (entry) => entry.id === e.target.value,
                      );
                      setSelectedPromptId(e.target.value);
                      if (prompt) {
                        setCustomPromptTitle(prompt.name);
                        setCustomPrompt(prompt.prompt);
                        setLinkPromptToLaunchPath(Boolean(prompt.launchPath));
                      }
                    }}
                    disabled={isProcessing || savedCustomPrompts.length === 0}
                  >
                    <option value="">Saved prompts…</option>
                    {sortedCustomPrompts.map((prompt) => {
                      return (
                        <option key={prompt.id} value={prompt.id}>
                          {prompt.favorite ? '★ ' : ''}
                          {prompt.name}
                          {prompt.launchPath
                            ? ` · ${formatLaunchPathLabel(prompt.launchPath)}`
                            : ' · Global'}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    className="btn btn-subtle"
                    onClick={() => {
                      setSelectedPromptId('');
                      setCustomPromptTitle('');
                      setCustomPrompt(DEFAULT_CUSTOM_PROMPT);
                      setLinkPromptToLaunchPath(false);
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
                  onChange={(e) => setCustomPromptTitle(e.target.value)}
                  placeholder="Prompt title, e.g. Bug triage with related Jira context"
                  disabled={isProcessing}
                />
                <textarea
                  id="custom-prompt"
                  className="custom-prompt-input"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Describe how you want the description enhanced..."
                  rows={7}
                  disabled={isProcessing}
                />
                <label className="checkbox-row prompt-link-row">
                  <input
                    type="checkbox"
                    checked={linkPromptToLaunchPath}
                    onChange={(e) => setLinkPromptToLaunchPath(e.target.checked)}
                    disabled={isProcessing || !launchPath.trim()}
                  />
                  <span>
                    Prefer this prompt for Launch Path
                    {launchPath.trim() ? `: ${currentLaunchPathLabel}` : ''}
                  </span>
                </label>
                <div className="launch-actions custom-prompt-actions">
                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={saveCustomPrompt}
                    disabled={isProcessing || !customPrompt.trim()}
                  >
                    {selectedPromptId ? 'Update prompt' : 'Save prompt'}
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
                <div className="field-help">
                  Favorites and prompts for this launch path appear first; prompts for other paths
                  stay available at the end.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="field-group launch-config-card">
        <div className="launch-config-header">
          <label className="field-label" htmlFor="launch-path-input">
            Launch Path
          </label>
          {selectedComponentPath && (
            <button
              type="button"
              className="btn btn-subtle launch-collapse-toggle"
              onClick={() => setLaunchPathCollapsed((collapsed) => !collapsed)}
              disabled={isProcessing}
            >
              {shouldCollapseLaunchPath
                ? `${selectedComponent} → ${formatLaunchPathLabel(selectedComponentPath)}`
                : 'Collapse mapping'}
            </button>
          )}
        </div>

        {!shouldCollapseLaunchPath && components.length > 0 && (
          <div className="component-chip-row" aria-label="Jira components">
            {components.map((component) => (
              <button
                type="button"
                key={component}
                className={`component-chip ${component === selectedComponent ? 'active' : ''}`}
                onClick={() => {
                  setSelectedComponent(component);
                  if (componentPathMap[component]) setLaunchPath(componentPathMap[component]);
                }}
                disabled={isProcessing}
              >
                {component}
                {componentPathMap[component] ? ' ✓' : ''}
              </button>
            ))}
          </div>
        )}

        {!shouldCollapseLaunchPath && (
          <div className="launch-path-row">
            <input
              id="launch-path-input"
              className="path-input"
              type="text"
              value={launchPath}
              onChange={(e) => setLaunchPath(e.target.value)}
              placeholder="/home/you/repos/project"
              disabled={isProcessing}
            />
            <select
              className="saved-path-select"
              value={savedLaunchPaths.includes(launchPath) ? launchPath : ''}
              onChange={(e) => setLaunchPath(e.target.value)}
              disabled={isProcessing || savedLaunchPaths.length === 0}
              aria-label="Saved launch paths"
            >
              <option value="">Saved paths…</option>
              {savedLaunchPaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </div>
        )}

        {!shouldCollapseLaunchPath && (
          <div className="launch-actions">
            <button
              type="button"
              className="btn btn-default"
              onClick={saveLaunchPath}
              disabled={isProcessing || !launchPath.trim()}
            >
              Save path
            </button>
            {selectedComponent && (
              <button
                type="button"
                className="btn btn-default"
                onClick={linkComponentToPath}
                disabled={isProcessing || !launchPath.trim()}
              >
                Link to {selectedComponent}
              </button>
            )}
            <button
              type="button"
              className="btn btn-subtle"
              onClick={removeLaunchPath}
              disabled={isProcessing || !savedLaunchPaths.includes(launchPath.trim())}
            >
              Remove saved path
            </button>
          </div>
        )}

        {!shouldCollapseLaunchPath && componentMappings.length > 0 && (
          <details className="component-mapping-list">
            <summary>Manage {componentMappings.length} component mappings</summary>
            {componentMappings.map(([component, path]) => (
              <div className="component-mapping-row" key={component}>
                <button
                  type="button"
                  className="component-mapping-text mapping-select-button"
                  onClick={() => {
                    setSelectedComponent(component);
                    setLaunchPath(path);
                  }}
                  disabled={isProcessing}
                >
                  <strong>{component}</strong>
                  <span>{path}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-subtle"
                  onClick={() => removeComponentMapping(component)}
                  disabled={isProcessing}
                >
                  Delete
                </button>
              </div>
            ))}
          </details>
        )}
      </div>

      <div className="field-group launch-config-card harness-config-card">
        <div className="launch-config-header">
          <span className="field-label">Harness</span>
          <button
            type="button"
            className="btn btn-subtle launch-collapse-toggle"
            onClick={() => setEnvCollapsed((collapsed) => !collapsed)}
            disabled={isProcessing}
          >
            {envCollapsed
              ? `${app === 'pi' ? 'Pi' : 'OpenCode'}${Object.keys(harnessEnv).length ? ` + Env settings (${Object.keys(harnessEnv).length})` : ''}`
              : 'Collapse harness settings'}
          </button>
        </div>

        {!envCollapsed && (
          <>
            <div className="field-group compact-field-group">
              <label className="field-label" htmlFor="provider-select">
                App
              </label>
              <select
                id="provider-select"
                className="provider-select"
                value={app}
                onChange={(e) => setApp(e.target.value as LlmApp)}
                disabled={isProcessing}
              >
                <option value="opencode">OpenCode</option>
                <option value="pi">Pi</option>
              </select>
            </div>
            <label className="field-label" htmlFor="harness-env-input">
              Environment variables
            </label>
            <textarea
              id="harness-env-input"
              className="harness-env-input"
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={'AWS_PROFILE=my-profile\nAWS_REGION=eu-west-1'}
              rows={3}
              disabled={isProcessing}
            />
            <div className="field-help">
              Saved per harness and passed to model discovery plus enhancement processes.
            </div>
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
                name="safety-mode"
                value="read-only"
                checked={safetyMode === 'read-only'}
                onChange={() => setSafetyMode('read-only')}
                disabled={isProcessing}
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
                name="safety-mode"
                value="trust-ai"
                checked={safetyMode === 'trust-ai'}
                onChange={() => setSafetyMode('trust-ai')}
                disabled={isProcessing}
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
            {modelConfigCollapsed ? modelConfigLabel : 'Collapse model settings'}
          </button>
        </div>

        {!modelConfigCollapsed && (
          <>
            <div className="field-group compact-field-group">
              <label className="field-label" htmlFor="model-provider-input">
                Provider
              </label>
              <select
                id="model-provider-input"
                className="provider-select"
                value={modelProvider}
                onChange={(e) => {
                  setModelProvider(e.target.value);
                  setModel('');
                }}
                disabled={isProcessing || modelsLoading}
              >
                <option value="">
                  {modelsLoading ? 'Loading providers…' : 'Default provider'}
                </option>
                {modelProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group compact-field-group">
              <label className="field-label" htmlFor="model-input">
                Model
              </label>
              <select
                id="model-input"
                className="provider-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={isProcessing || modelsLoading}
              >
                <option value="">{modelsLoading ? 'Loading models…' : 'Default model'}</option>
                {availableModels.map((modelName) => (
                  <option key={modelName} value={modelName}>
                    {modelName}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <button
        className="btn btn-primary enhance-btn"
        onClick={handleEnhance}
        disabled={isProcessing || (mode === 'custom' && !customPrompt.trim())}
      >
        {isProcessing ? 'Enhancing…' : 'Review enhancement'}
      </button>
    </div>
  );
}
