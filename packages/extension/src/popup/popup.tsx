import React, { useState, useEffect, useCallback } from 'react';
import type { EnhanceMode, LlmProvider } from '@jira-enhancer/shared';
import { useRefinement } from './hooks/useRefinement';
import { EnhancePanel } from './components/EnhancePanel';
import { DiffView } from './components/DiffView';
import { MarkdownEditor } from './components/MarkdownEditor';
import { LoadingState } from './components/LoadingState';

type View = 'enhance' | 'diff' | 'edit';

const JIRA_ISSUE_PATTERN = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/;

function extractIssueKey(url: string): string | null {
  const match = url.match(JIRA_ISSUE_PATTERN);
  return match ? match[1] : null;
}

export function Popup() {
  const {
    enhance,
    cancel: _cancel,
    status,
    originalDescription,
    refinedDescription,
    error,
    isProcessing,
    progress,
  } = useRefinement();

  const [currentView, setCurrentView] = useState<View>('enhance');
  const [editedDescription, setEditedDescription] = useState('');
  const [issueKey, setIssueKey] = useState<string | null>(null);
  const [description, setDescription] = useState('');

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.url) {
        const key = extractIssueKey(tab.url);
        setIssueKey(key);
      }
    });
  }, []);

  useEffect(() => {
    if (status === 'complete' && refinedDescription) {
      setCurrentView('diff');
      setEditedDescription(refinedDescription);
    }
  }, [status, refinedDescription]);

  const handleEnhance = useCallback(
    (mode: EnhanceMode, provider: LlmProvider, customPrompt?: string) => {
      if (!issueKey) return;
      enhance(issueKey, description, mode, provider, customPrompt);
    },
    [issueKey, description, enhance],
  );

  const handleAccept = () => {
    const finalDescription = currentView === 'edit' ? editedDescription : refinedDescription;
    console.log('Accepted description for', issueKey, finalDescription);
    setCurrentView('enhance');
  };

  const handleEdit = () => {
    setEditedDescription(refinedDescription);
    setCurrentView('edit');
  };

  const handleNewAlternative = () => {
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
      <div className="popup-container">
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
    <div className="popup-container">
      <header className="popup-header">
        <h1 className="popup-title">Jira Enhancer</h1>
        {currentView !== 'enhance' && (
          <button className="btn btn-subtle back-btn" onClick={handleBack}>
            ← Back
          </button>
        )}
      </header>

      <div className="popup-body">
        {error && (
          <div className="error-banner">
            <span className="error-icon">⚠</span>
            <span>{error}</span>
          </div>
        )}

        {currentView === 'enhance' && (
          <>
            <div className="field-group">
              <label className="field-label" htmlFor="description-input">
                Current Description
              </label>
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

            <EnhancePanel
              issueKey={issueKey}
              onEnhance={handleEnhance}
              isProcessing={isProcessing}
            />

            {isProcessing && <LoadingState status={status} progress={progress} />}
          </>
        )}

        {currentView === 'diff' && (
          <>
            <DiffView original={originalDescription} refined={refinedDescription} />
            <div className="action-bar">
              <button className="btn btn-primary" onClick={handleAccept}>
                Accept
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
              <button className="btn btn-primary" onClick={handleAccept}>
                Save
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
