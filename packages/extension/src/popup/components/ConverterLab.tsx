import React, { useEffect, useMemo, useRef, useState } from 'react';
import { jiraMarkupToMarkdown, markdownToJiraMarkup, MessageType } from '@jira-enhancer/shared';
import { renderJiraMarkup } from '../../content/dom-injection';

const STARTER_JIRA_MARKUP = `h2. Converter smoke test

This is *strong*, _emphasis_, ??citation??, -deleted-, +inserted+, ^superscript^, ~subscript~, and {{monospaced}}.

[Atlassian|https://atlassian.com] [#anchor] [^attachment.ext] [~username]

{anchor:anchor}
{color:red}
red text
{color}

* bullet
** nested bullet
# numbered
#* mixed bullet

||Heading 1||Heading 2||
|Cell A|Cell B|

{code:ts}
const ok = true;
{code}

:) (y) (flag)`;

type ConverterInputSource = 'issue' | 'draft' | 'smoke';

interface ConverterPreviewResult {
  ok: boolean;
  message?: string;
}

interface ConverterLabProps {
  currentIssueDescription: string;
  onBack: () => void;
  onPreviewInJira: (jiraMarkup: string, renderedHtml: string) => Promise<ConverterPreviewResult>;
}

export function ConverterLab({
  currentIssueDescription,
  onBack,
  onPreviewInJira,
}: ConverterLabProps) {
  const renderRef = useRef<HTMLDivElement | null>(null);
  const initialSavedDraft = localStorage.getItem('jiraEnhancer.converterLab.input') || '';
  const initialIssueDescription = currentIssueDescription.trim();
  const [inputSource, setInputSource] = useState<ConverterInputSource>(() =>
    initialIssueDescription ? 'issue' : initialSavedDraft ? 'draft' : 'smoke',
  );
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [draftMarkup, setDraftMarkup] = useState(initialSavedDraft);
  const [jiraMarkup, setJiraMarkup] = useState(
    () => initialIssueDescription || initialSavedDraft || STARTER_JIRA_MARKUP,
  );

  useEffect(() => {
    if (inputSource === 'issue' && currentIssueDescription.trim()) {
      setJiraMarkup(currentIssueDescription);
    }
  }, [currentIssueDescription, inputSource]);

  const conversion = useMemo(() => {
    const markdown = jiraMarkupToMarkdown(jiraMarkup);
    const roundTripJira = markdownToJiraMarkup(markdown);
    return { markdown, roundTripJira };
  }, [jiraMarkup]);

  useEffect(() => {
    const target = renderRef.current;
    if (!target) return;
    const rendered = renderJiraMarkup(conversion.roundTripJira);
    target.replaceChildren(...Array.from(rendered.childNodes));
  }, [conversion.roundTripJira]);

  const updateInput = (value: string) => {
    setInputSource('draft');
    setJiraMarkup(value);
    setDraftMarkup(value);
    localStorage.setItem('jiraEnhancer.converterLab.input', value);
  };

  const useIssueDescription = () => {
    setInputSource('issue');
    setJiraMarkup(currentIssueDescription || '');
    setPreviewStatus(null);
  };

  const useSmokeTest = () => {
    setInputSource('smoke');
    setJiraMarkup(STARTER_JIRA_MARKUP);
    setPreviewStatus(null);
  };

  const applyPreviewToJiraDom = async () => {
    setPreviewStatus('Rendering preview into Jira description DOM…');
    const result = await onPreviewInJira(
      conversion.roundTripJira,
      renderRef.current?.innerHTML ?? '',
    );
    setPreviewStatus(
      result.ok
        ? 'Preview rendered in the Jira page DOM only. Jira was not saved.'
        : `Could not render preview in Jira. ${result.message ?? 'Keep the Jira issue tab open and try again.'}`,
    );
  };

  const sendDebugSnapshot = () => {
    const renderedPreview = renderRef.current;
    chrome.runtime?.sendMessage?.({
      type: MessageType.DEBUG_LOG_REQUEST,
      id: crypto.randomUUID(),
      source: 'converter-lab-snapshot',
      payload: {
        inputSource,
        jiraMarkupInput: jiraMarkup,
        markdownOutput: conversion.markdown,
        roundTripJiraMarkup: conversion.roundTripJira,
        renderedPreviewText: renderedPreview?.textContent ?? '',
        renderedPreviewHtml: renderedPreview?.outerHTML ?? '',
      },
    });
    setPreviewStatus('Converter Lab snapshot sent to the debug log request channel.');
  };

  return (
    <div className="converter-lab-page">
      <div className="review-header">
        <div>
          <h2>Jira Markup Converter Lab</h2>
          <p>
            Test Jira markup → Markdown → Jira markup → HTML render. You can also render the preview
            into the current Jira page DOM without saving to Jira.
          </p>
        </div>
        <button type="button" className="btn btn-default" onClick={onBack}>
          Back
        </button>
      </div>

      <div className="converter-toolbar">
        <div className="segmented-control" role="group" aria-label="Converter input source">
          <button
            type="button"
            className={inputSource === 'issue' ? 'active' : ''}
            onClick={useIssueDescription}
            disabled={!currentIssueDescription.trim()}
          >
            Current issue
          </button>
          <button
            type="button"
            className={inputSource === 'draft' ? 'active' : ''}
            onClick={() => {
              setInputSource('draft');
              setJiraMarkup(draftMarkup || jiraMarkup);
            }}
          >
            Draft
          </button>
          <button
            type="button"
            className={inputSource === 'smoke' ? 'active' : ''}
            onClick={useSmokeTest}
          >
            Smoke test
          </button>
        </div>
        <div className="converter-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void applyPreviewToJiraDom()}
          >
            Preview in Jira description (DOM only)
          </button>
          <button type="button" className="btn btn-default" onClick={sendDebugSnapshot}>
            Send lab snapshot to debug log
          </button>
        </div>
      </div>

      {previewStatus && <div className="status-banner">{previewStatus}</div>}

      <div className="converter-grid">
        <label className="converter-pane">
          <span className="field-label">Jira markup input</span>
          <textarea
            className="review-output converter-textarea"
            value={jiraMarkup}
            onChange={(event) => updateInput(event.target.value)}
            rows={16}
          />
        </label>

        <label className="converter-pane">
          <span className="field-label">Markdown output</span>
          <textarea
            className="review-output converter-textarea"
            value={conversion.markdown}
            readOnly
            rows={16}
          />
        </label>

        <label className="converter-pane">
          <span className="field-label">Round-trip Jira markup</span>
          <textarea
            className="review-output converter-textarea"
            value={conversion.roundTripJira}
            readOnly
            rows={16}
          />
        </label>

        <div className="converter-pane converter-render-pane">
          <span className="field-label">Rendered HTML preview</span>
          <div className="converter-rendered" ref={renderRef} />
        </div>
      </div>
    </div>
  );
}
