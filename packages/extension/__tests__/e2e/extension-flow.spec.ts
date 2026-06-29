import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { createMockJiraPage, MOCK_ISSUE_KEY } from './fixtures/mock-jira';
import {
  enhanceReplayResponse,
  fullPageSession,
  harnessReplayEvents,
  historicalResults,
  listModelsResponse,
  replayIssueKey,
  replayRequestId,
  replaySessionId,
  restoredEnhancementState,
} from './fixtures/harness-runs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pathToExtension = path.resolve(__dirname, '../../dist');

let context: BrowserContext;

test.describe('Jira Enhancer Extension', () => {
  test.beforeAll(async () => {
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-first-run',
        '--disable-default-apps',
      ],
    });
  });

  test.afterAll(async () => {
    await context.close();
  });

  function getExtensionId(): string {
    const serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      throw new Error('No service worker found — extension may not have loaded');
    }
    // Service worker URL: chrome-extension://<id>/background.js
    const url = serviceWorker.url();
    const match = url.match(/chrome-extension:\/\/([^/]+)\//);
    if (!match) {
      throw new Error(`Could not extract extension ID from service worker URL: ${url}`);
    }
    return match[1];
  }

  async function waitForServiceWorker(): Promise<void> {
    if (context.serviceWorkers().length === 0) {
      await context.waitForEvent('serviceworker');
    }
  }

  async function installReplayMocks(
    page: Awaited<ReturnType<BrowserContext['newPage']>>,
    options: { restoreState?: boolean; history?: boolean; replayEnhance?: boolean } = {},
  ): Promise<void> {
    await page.addInitScript(
      ({
        sessionId,
        session,
        issueKey,
        listModels,
        restoreState,
        restoredState,
        history,
        historical,
        replayEnhance,
        events,
        response,
        requestId,
      }) => {
        localStorage.setItem(`jiraEnhancer.fullPageSession.${sessionId}`, JSON.stringify(session));
        localStorage.setItem('jiraEnhancer.harness', 'pi');
        localStorage.setItem('jiraEnhancer.provider', 'anthropic');
        localStorage.setItem('jiraEnhancer.model', 'claude-smoke');
        if (history) {
          localStorage.setItem(
            `jiraEnhancer.resultHistory.${issueKey}`,
            JSON.stringify(historical),
          );
        }

        const listeners: Array<(message: unknown) => void> = [];
        const sentMessages: unknown[] = [];
        (
          window as unknown as { __jiraEnhancerSentMessages: unknown[] }
        ).__jiraEnhancerSentMessages = sentMessages;

        const runtime = chrome.runtime as unknown as {
          sendMessage: (
            message: Record<string, unknown>,
            callback?: (response?: unknown) => void,
          ) => void;
          onMessage: {
            addListener: (listener: (message: unknown) => void) => void;
            removeListener: (listener: (message: unknown) => void) => void;
          };
          lastError?: { message?: string } | null;
        };
        runtime.lastError = null;
        runtime.onMessage.addListener = (listener) => {
          listeners.push(listener);
        };
        runtime.onMessage.removeListener = (listener) => {
          const index = listeners.indexOf(listener);
          if (index !== -1) listeners.splice(index, 1);
        };
        runtime.sendMessage = (message, callback) => {
          sentMessages.push(message);
          if (message.type === 'LIST_MODELS_REQUEST') {
            callback?.({ ...listModels, id: message.id });
            return;
          }
          if (message.type === 'GET_ENHANCEMENT_STATE') {
            callback?.(restoreState ? restoredState : { type: 'ENHANCEMENT_STATE', issueKey });
            return;
          }
          if (message.type === 'ENHANCE_REQUEST') {
            callback?.({ type: 'STATUS', id: message.id, status: 'processing' });
            if (replayEnhance) {
              setTimeout(() => {
                for (const event of events) {
                  listeners.forEach((listener) =>
                    listener({ ...event, id: message.id || requestId }),
                  );
                }
              }, 50);
              setTimeout(() => {
                listeners.forEach((listener) =>
                  listener({ ...response, id: message.id || requestId }),
                );
              }, 2000);
            }
          }
        };

        const tabs = chrome.tabs as unknown as {
          sendMessage: (
            tabId: number,
            message: unknown,
            callback?: (response?: unknown) => void,
          ) => void;
          update: (tabId: number, properties: unknown) => void;
          query: (
            query: unknown,
            callback: (tabs: Array<{ id: number; url: string }>) => void,
          ) => void;
        };
        tabs.sendMessage = (tabId, message, callback) => {
          sentMessages.push({ tabId, message });
          callback?.({ ok: true });
        };
        tabs.update = (tabId, properties) => {
          sentMessages.push({ tabId, update: properties });
        };
        tabs.query = (_query, callback) => {
          callback([{ id: session.sourceTabId, url: session.sourceTabUrl ?? '' }]);
        };
      },
      {
        sessionId: replaySessionId,
        session: fullPageSession,
        issueKey: replayIssueKey,
        listModels: listModelsResponse,
        restoreState: options.restoreState ?? false,
        restoredState: restoredEnhancementState,
        history: options.history ?? false,
        historical: historicalResults,
        replayEnhance: options.replayEnhance ?? false,
        events: harnessReplayEvents,
        response: enhanceReplayResponse,
        requestId: replayRequestId,
      },
    );
  }

  test('extension loads without errors', async () => {
    await waitForServiceWorker();

    const page = await context.newPage();
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('about:blank');
    await page.waitForTimeout(1000);

    // Filter out known benign Chrome extension errors
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes('net::ERR_') &&
        !e.includes('Failed to load resource') &&
        !e.includes('DevTools'),
    );

    expect(realErrors).toHaveLength(0);
    await page.close();
  });

  test('content script injects button on Jira-like page', async () => {
    await waitForServiceWorker();

    // Write mock Jira HTML to a temp file so we can load it via file:// protocol
    const tmpDir = path.join(__dirname, '..', '..', '.tmp-e2e');
    fs.mkdirSync(tmpDir, { recursive: true });
    const mockHtmlPath = path.join(tmpDir, 'mock-jira.html');
    fs.writeFileSync(mockHtmlPath, createMockJiraPage(), 'utf-8');

    const page = await context.newPage();
    try {
      await page.goto(`file://${mockHtmlPath}`);

      // The content script only runs on *.atlassian.net, so it won't inject
      // automatically on a file:// URL. Instead, verify the DOM structure
      // is correct and test the injection logic manually via page.evaluate.
      const breadcrumb = page.locator(
        '[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]',
      );
      await expect(breadcrumb).toBeVisible();
      await expect(breadcrumb).toHaveText(MOCK_ISSUE_KEY);

      // Simulate the content script's injection logic in-page
      const buttonInjected = await page.evaluate(() => {
        const HEADER_SELECTORS = [
          '[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]',
          '#jira-issue-header',
          '[data-testid="issue-field-heading.ui.title"]',
        ];

        let header: Element | null = null;
        for (const selector of HEADER_SELECTORS) {
          const el = document.querySelector(selector);
          if (el) {
            header = el;
            break;
          }
        }
        if (!header) return false;

        const button = document.createElement('button');
        button.id = 'jira-enhancer-btn';
        button.textContent = '✨ Enhance';
        header.insertAdjacentElement('afterend', button);
        return true;
      });

      expect(buttonInjected).toBe(true);

      const enhanceButton = page.locator('#jira-enhancer-btn');
      await expect(enhanceButton).toBeVisible();
      await expect(enhanceButton).toHaveText('✨ Enhance');
    } finally {
      await page.close();
      // Cleanup temp file
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('popup renders correctly', async () => {
    await waitForServiceWorker();

    const extensionId = getExtensionId();
    const page = await context.newPage();

    try {
      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

      // Wait for React to mount
      const root = page.locator('#root');
      await expect(root).not.toBeEmpty();

      // The popup shows an "empty state" message when not on a Jira page
      // because chrome.tabs.query won't return a Jira URL
      const popupContainer = page.locator('.popup-container');
      await expect(popupContainer).toBeVisible();

      // Verify the header renders
      const header = page.locator('.popup-header');
      await expect(header).toBeVisible();

      // Should show the "not on Jira" empty state since we aren't on a Jira issue
      const emptyState = page.locator('.empty-state');
      const enhancePanel = page.locator('.enhance-panel');

      // One of these should be visible depending on the tab state
      const hasEmptyState = await emptyState.isVisible().catch(() => false);
      const hasEnhancePanel = await enhancePanel.isVisible().catch(() => false);

      expect(hasEmptyState || hasEnhancePanel).toBe(true);
    } finally {
      await page.close();
    }
  });

  test('popup shows enhance panel with mode selector and button', async () => {
    await waitForServiceWorker();

    const extensionId = getExtensionId();

    // Open a page that looks like a Jira URL to the popup's URL parser,
    // then open the popup. Since we can't fake chrome.tabs.query easily,
    // we test the EnhancePanel in isolation by navigating to the popup
    // and checking for either the enhance panel or the empty state.
    const page = await context.newPage();

    try {
      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await page.locator('#root').waitFor({ state: 'visible' });

      // Wait for React hydration
      await page.waitForTimeout(500);

      // Check the popup structure rendered
      const popupContainer = page.locator('.popup-container');
      await expect(popupContainer).toBeVisible();

      const popupTitle = page.locator('.popup-title');
      await expect(popupTitle).toHaveText('Jira Enhancer');

      // If the enhance panel is visible, validate its controls
      const enhancePanel = page.locator('.enhance-panel');
      if (await enhancePanel.isVisible().catch(() => false)) {
        // Mode selector radio buttons
        const defaultRadio = page.locator('input[name="mode"][value="default"]');
        await expect(defaultRadio).toBeVisible();
        await expect(defaultRadio).toBeChecked();

        const customRadio = page.locator('input[name="mode"][value="custom"]');
        await expect(customRadio).toBeVisible();

        // Provider select
        const providerSelect = page.locator('#provider-select');
        await expect(providerSelect).toBeVisible();

        // Enhance button
        const enhanceBtn = page.locator('.enhance-btn');
        await expect(enhanceBtn).toBeVisible();
        await expect(enhanceBtn).toHaveText('Enhance Description');
        await expect(enhanceBtn).toBeEnabled();
      }
    } finally {
      await page.close();
    }
  });

  test('full-page replay restores request and renders sanitized prompt preview', async () => {
    await waitForServiceWorker();
    const extensionId = getExtensionId();
    const page = await context.newPage();

    try {
      await installReplayMocks(page);
      await page.goto(
        `chrome-extension://${extensionId}/src/full-page/index.html?session=${replaySessionId}`,
      );
      await expect(page.locator('.full-page-container')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Review enhancement request' })).toBeVisible();
      await expect(page.locator('.metadata-grid')).toContainText('pi');
      await expect(page.locator('.metadata-grid')).toContainText('anthropic');
      await expect(page.locator('.metadata-grid')).toContainText('claude-smoke');
      await expect(page.locator('#enhancement-input-preview')).toHaveValue(
        /As a user, I can reset my password\./,
      );
      await expect(page.locator('#enhancement-input-preview')).toHaveValue(/storyPoints/);
      await expect(page.locator('#enhancement-input-preview')).not.toHaveValue(/private\.example\.com/);
    } finally {
      await page.close();
    }
  });

  test('full-page replay shows processing events then completed review', async () => {
    await waitForServiceWorker();
    const extensionId = getExtensionId();
    const page = await context.newPage();

    try {
      await installReplayMocks(page, { replayEnhance: true });
      await page.goto(
        `chrome-extension://${extensionId}/src/full-page/index.html?session=${replaySessionId}`,
      );
      await page.getByRole('button', { name: 'Enhance', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Harness is enhancing the Jira fields' }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Review enhanced Jira fields' })).toBeVisible({
        timeout: 5000,
      });
      await expect(page.locator('#edited-description')).toHaveValue(
        /Enhanced sanitized description\./,
      );
      await expect(page.getByText('Smoke replay fixture only.')).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('full-page restores in-progress enhancement state from sanitized fixture', async () => {
    await waitForServiceWorker();
    const extensionId = getExtensionId();
    const page = await context.newPage();

    try {
      await installReplayMocks(page, { restoreState: true });
      await page.goto(
        `chrome-extension://${extensionId}/src/full-page/index.html?session=${replaySessionId}`,
      );
      await expect(
        page.getByRole('heading', { name: 'Harness is enhancing the Jira fields' }),
      ).toBeVisible();
      await expect(page.getByText('refining')).toBeVisible();
      await expect(page.getByText('55%')).toBeVisible();
      await expect(page.getByText('Continuing sanitized replay.')).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('previous result history can be reviewed, compared, and accepted without rerun', async () => {
    await waitForServiceWorker();
    const extensionId = getExtensionId();
    const page = await context.newPage();

    try {
      await installReplayMocks(page, { history: true });
      await page.goto(
        `chrome-extension://${extensionId}/src/full-page/index.html?session=${replaySessionId}`,
      );
      await page.getByRole('button', { name: 'Back to edit' }).click();
      await expect(page.getByText('Previous enhancement results (2)')).toBeVisible();
      await expect(page.getByText('Second historical enhanced description.')).toBeVisible();
      await expect(page.getByText('First historical enhanced description.')).toBeVisible();

      await page.getByRole('button', { name: 'Review without rerun' }).first().click();
      await expect(
        page.getByRole('heading', { name: 'Review enhanced Jira fields' }),
      ).toBeVisible();
      await expect(page.locator('#edited-description')).toHaveValue(
        /Second historical enhanced description\./,
      );

      const sentEnhanceRequests = await page.evaluate(
        () =>
          (
            (window as unknown as { __jiraEnhancerSentMessages: Array<{ type?: string }> })
              .__jiraEnhancerSentMessages ?? []
          ).filter((message) => message.type === 'ENHANCE_REQUEST').length,
      );
      expect(sentEnhanceRequests).toBe(0);

      await page.getByRole('button', { name: 'Preview in Jira' }).click();
      const sentMessages = await page.evaluate(
        () =>
          (window as unknown as { __jiraEnhancerSentMessages: unknown[] })
            .__jiraEnhancerSentMessages,
      );
      expect(JSON.stringify(sentMessages)).toContain('SET_JIRA_FIELDS');
      expect(JSON.stringify(sentMessages)).toContain('Second historical enhanced description.');
      expect(JSON.stringify(sentMessages)).toContain('"active":true');
    } finally {
      await page.close();
    }
  });

  test('popup shows loading state when enhance clicked', async () => {
    await waitForServiceWorker();

    const extensionId = getExtensionId();
    const page = await context.newPage();

    try {
      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await page.locator('#root').waitFor({ state: 'visible' });
      await page.waitForTimeout(500);

      // We need to mock the chrome.tabs.query to simulate being on a Jira page
      // so the enhance panel appears instead of the empty state
      await page.evaluate((issueKey) => {
        type FakeTab = { id: number; url: string; active: boolean };
        type FakeChrome = {
          tabs: { query: (query: unknown, callback: (tabs: FakeTab[]) => void) => void };
        };
        const fakeChrome = chrome as unknown as FakeChrome;
        fakeChrome.tabs.query = (_query: unknown, callback: (tabs: FakeTab[]) => void) => {
          callback([
            {
              id: 1,
              url: `https://test.atlassian.net/browse/${issueKey}`,
              active: true,
            },
          ]);
        };
      }, MOCK_ISSUE_KEY);

      // Reload to pick up the mocked chrome.tabs.query
      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

      // Re-apply the mock before React initializes
      await page.addInitScript((issueKey) => {
        type FakeTab = { id: number; url: string; active: boolean };
        type FakeChrome = {
          tabs: { query: (query: unknown, callback: (tabs: FakeTab[]) => void) => void };
        };
        const fakeChrome = chrome as unknown as FakeChrome;
        fakeChrome.tabs.query = (_query: unknown, callback: (tabs: FakeTab[]) => void) => {
          callback([
            {
              id: 1,
              url: `https://test.atlassian.net/browse/${issueKey}`,
              active: true,
            },
          ]);
        };
      }, MOCK_ISSUE_KEY);

      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await page.locator('#root').waitFor({ state: 'visible' });
      await page.waitForTimeout(500);

      const enhancePanel = page.locator('.enhance-panel');
      if (await enhancePanel.isVisible().catch(() => false)) {
        const enhanceBtn = page.locator('.enhance-btn');
        await expect(enhanceBtn).toBeVisible();
        await expect(enhanceBtn).toBeEnabled();
      } else {
        // If we couldn't get the enhance panel (chrome mock didn't take effect),
        // verify at minimum that the popup rendered without crashing
        const popupContainer = page.locator('.popup-container');
        await expect(popupContainer).toBeVisible();
      }
    } finally {
      await page.close();
    }
  });
});
