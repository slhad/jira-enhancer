const BROWSE_PATTERN = /\/browse\/([A-Z][A-Z0-9]+-\d+)/;
const SELECTED_ISSUE_PATTERN = /[?&]selectedIssue=([A-Z][A-Z0-9]+-\d+)/;

export function detectIssueKey(): string | null {
  const url = window.location.href;

  const browseMatch = url.match(BROWSE_PATTERN);
  if (browseMatch) return browseMatch[1];

  const selectedMatch = url.match(SELECTED_ISSUE_PATTERN);
  if (selectedMatch) return selectedMatch[1];

  return null;
}

export function isJiraIssuePage(): boolean {
  return detectIssueKey() !== null;
}
