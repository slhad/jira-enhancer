import React, { useState } from 'react';
import type { EnhanceMode, LlmProvider } from '@jira-enhancer/shared';

interface EnhancePanelProps {
  issueKey: string;
  onEnhance: (mode: EnhanceMode, provider: LlmProvider, customPrompt?: string) => void;
  isProcessing: boolean;
}

export function EnhancePanel({ issueKey, onEnhance, isProcessing }: EnhancePanelProps) {
  const [mode, setMode] = useState<EnhanceMode>('default');
  const [provider, setProvider] = useState<LlmProvider>('opencode');
  const [customPrompt, setCustomPrompt] = useState('');

  const handleEnhance = () => {
    onEnhance(mode, provider, mode === 'custom' ? customPrompt : undefined);
  };

  return (
    <div className="enhance-panel">
      <div className="issue-key-badge">
        <span className="issue-key-label">Issue</span>
        <span className="issue-key-value">{issueKey}</span>
      </div>

      <div className="field-group">
        <label className="field-label">Enhancement Mode</label>
        <div className="radio-group">
          <label className="radio-option">
            <input
              type="radio"
              name="mode"
              value="default"
              checked={mode === 'default'}
              onChange={() => setMode('default')}
              disabled={isProcessing}
            />
            <span className="radio-text">Default</span>
            <span className="radio-description">Improve clarity, structure, and acceptance criteria</span>
          </label>
          <label className="radio-option">
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
      </div>

      {mode === 'custom' && (
        <div className="field-group">
          <label className="field-label" htmlFor="custom-prompt">
            Custom Prompt
          </label>
          <textarea
            id="custom-prompt"
            className="custom-prompt-input"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Describe how you want the description enhanced..."
            rows={4}
            disabled={isProcessing}
          />
        </div>
      )}

      <div className="field-group">
        <label className="field-label" htmlFor="provider-select">
          LLM Provider
        </label>
        <select
          id="provider-select"
          className="provider-select"
          value={provider}
          onChange={(e) => setProvider(e.target.value as LlmProvider)}
          disabled={isProcessing}
        >
          <option value="opencode">OpenCode</option>
          <option value="pi">Pi</option>
        </select>
      </div>

      <button
        className="btn btn-primary enhance-btn"
        onClick={handleEnhance}
        disabled={isProcessing || (mode === 'custom' && !customPrompt.trim())}
      >
        {isProcessing ? 'Enhancing…' : 'Enhance Description'}
      </button>
    </div>
  );
}
