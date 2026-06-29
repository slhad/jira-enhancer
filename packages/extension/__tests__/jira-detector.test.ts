// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { detectIssueKey, isJiraIssuePage } from '../src/content/jira-detector.js';

function setUrl(path: string): void {
  window.history.pushState({}, '', path);
}

describe('jira-detector', () => {
  it('detects issue keys from browse URLs', () => {
    setUrl('/browse/TICP-4644');

    expect(detectIssueKey()).toBe('TICP-4644');
    expect(isJiraIssuePage()).toBe(true);
  });

  it('detects issue keys from selectedIssue query parameter', () => {
    setUrl('/secure/RapidBoard.jspa?rapidView=1&selectedIssue=ABC123-99');

    expect(detectIssueKey()).toBe('ABC123-99');
  });

  it('returns null when no issue key is present', () => {
    setUrl('/secure/Dashboard.jspa');

    expect(detectIssueKey()).toBeNull();
    expect(isJiraIssuePage()).toBe(false);
  });
});
