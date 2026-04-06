export const MOCK_ISSUE_KEY = 'PROJ-123';

export const MOCK_ADF_DESCRIPTION = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'As a user, I want to be able to log in so that I can access my dashboard.',
        },
      ],
    },
  ],
};

export function createMockJiraPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${MOCK_ISSUE_KEY}: Test Issue</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      background: #f4f5f7;
      color: #172b4d;
    }
    .issue-header {
      display: flex;
      align-items: center;
      padding: 16px 24px;
      background: #fff;
      border-bottom: 1px solid #dfe1e6;
    }
    .breadcrumb-item {
      font-size: 14px;
      color: #0052cc;
      font-weight: 500;
    }
    .issue-view {
      max-width: 960px;
      margin: 24px auto;
      background: #fff;
      border-radius: 4px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.1);
      padding: 24px;
    }
    .issue-title {
      font-size: 24px;
      font-weight: 600;
      margin: 0 0 16px;
    }
    .description-area {
      line-height: 1.6;
      color: #42526e;
    }
    .description-area h3 {
      font-size: 16px;
      margin: 16px 0 8px;
    }
  </style>
</head>
<body>
  <div class="issue-header">
    <span
      data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"
      class="breadcrumb-item"
    >${MOCK_ISSUE_KEY}</span>
  </div>
  <div class="issue-view">
    <h1 class="issue-title">${MOCK_ISSUE_KEY}: Test Issue</h1>
    <div class="description-area" data-testid="issue-description">
      <p>As a user, I want to be able to log in so that I can access my dashboard.</p>
      <h3>Acceptance Criteria</h3>
      <ul>
        <li>User can enter email and password</li>
        <li>Invalid credentials show an error message</li>
        <li>Successful login redirects to the dashboard</li>
      </ul>
    </div>
  </div>
</body>
</html>`;
}
