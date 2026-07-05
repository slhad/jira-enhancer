# AGENTS.md — Jira Enhancer Codebase Guide

This file is for AI coding agents (GitHub Copilot, Claude, etc.) working in this repository. Read it before making any changes.

Documentation split:

- [`README.md`](./README.md) is the project overview, setup, install, build/test, and development guide.
- [`SPECS.md`](./SPECS.md) is the product and technical specification. Treat it as the source of truth for behavior.
- When changing behavior, protocol, UI, persistence keys, security/privacy rules, or setup assumptions, update `SPECS.md` in the same change. Update `README.md` only when overview/setup/development guidance changes.

---

## Project Summary

A pnpm monorepo with three TypeScript packages:

| Package              | Name                       | Role                                              |
| -------------------- | -------------------------- | ------------------------------------------------- |
| `packages/shared`    | `@jira-enhancer/shared`    | Shared types, protocol, ADF↔Markdown transformers |
| `packages/bridge`    | `@jira-enhancer/bridge`    | Node.js native messaging bridge, spawns LLM CLI   |
| `packages/extension` | `@jira-enhancer/extension` | Chrome Extension MV3, React popup UI              |

---

## Build & Test Commands

Always verify your changes compile and pass tests before stopping.

```bash
pnpm build          # Build all packages (order: shared → bridge & extension)
pnpm test           # Run unit tests with coverage thresholds (90% lines/branches/functions/statements)
pnpm lint           # ESLint across all packages
pnpm format:check   # Prettier check
```

Run a single package:

```bash
pnpm --filter @jira-enhancer/shared build
pnpm --filter @jira-enhancer/bridge test
pnpm --filter @jira-enhancer/extension lint
```

Turborepo caches outputs. If you change a file and `pnpm build` seems to skip it, run `turbo run build --force`.

---

## Architecture Constraints

### Package dependency direction

```
extension ──► shared
bridge    ──► shared
```

`shared` must never import from `bridge` or `extension`. `bridge` and `extension` must never import from each other. If you need something in both, put it in `shared`.

### stdout is sacred in the bridge

The bridge communicates with Chrome by writing length-prefixed JSON to **stdout**. Never use `console.log()` in bridge code — it will corrupt the stream. All logging must go to **stderr**:

```typescript
process.stderr.write(`[bridge] ${message}\n`);
```

This restriction applies to `packages/bridge/src/**` only.

### Chrome Extension environment split

| File location     | Runtime environment                     | Available globals                      |
| ----------------- | --------------------------------------- | -------------------------------------- |
| `src/background/` | Service Worker (no DOM)                 | `chrome.*`, `fetch`, no `window`       |
| `src/content/`    | Page context (injected into Jira page)  | `window`, `document`, `chrome.runtime` |
| `src/popup/`      | Extension popup page (full DOM + React) | `window`, `document`, `chrome.*`       |

Do not use `window` or `document` in `background.ts`. Do not use `chrome.nativeMessaging` in content scripts — route through the service worker.

---

## Key Files to Read First

When making changes, read these files to understand the contracts:

| File                                              | Why                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `SPECS.md`                                        | Product/technical behavior source of truth; update when behavior changes            |
| `README.md`                                       | Setup, install, build/test, and developer guide                                     |
| `packages/shared/src/protocol.ts`                 | All message types between extension and bridge                                      |
| `packages/shared/src/errors.ts`                   | ErrorCode enum — use existing codes, don't add new ones without updating both sides |
| `packages/bridge/src/request-handler.ts`          | How bridge routes incoming messages to LLM adapters                                 |
| `packages/bridge/src/message-protocol.ts`         | Stream framing; fragile — don't change without running all bridge tests             |
| `packages/extension/src/background/background.ts` | How messages are forwarded to/from the native host                                  |

---

## Patterns & Conventions

### Error handling

Always throw `BridgeError` (from `@jira-enhancer/shared`) in bridge code, not generic `Error`. The request handler catches `BridgeError` and maps it to an `ErrorResponse` with the correct code. Uncaught errors use `ErrorCode.UNKNOWN`.

```typescript
import { BridgeError, ErrorCode } from '@jira-enhancer/shared';

throw new BridgeError(ErrorCode.CONFIG_ERROR, 'config.json not found');
```

### Async patterns in the bridge

The bridge message loop is a `for (;;)` async loop in `src/index.ts`. Each `readMessage()` call awaits the next complete message. Do not use `process.stdin.on('data', ...)` — use the `NativeMessagingProtocol` class.

### React components (extension popup/full-page)

- Functional components with hooks only. No class components.
- `packages/extension/src/popup/popup.tsx` owns both popup and full-page review flows; `packages/extension/src/full-page/main.tsx` renders the same `Popup` component with `fullPage` enabled.
- Refinement request state is managed by `useRefinement`; selection/config UI state currently lives in `EnhancePanel` and is persisted in `localStorage`.
- Chrome API calls should stay in popup hooks/components, content scripts, or the background service worker according to runtime environment. Do not use DOM APIs in the service worker.
- Keep popup/full-page behavior aligned with `SPECS.md`, especially description loading, Story Points/Acceptance Criteria field handling, image handling, harness/provider/model selection, ignored provider filtering, launch path persistence, component-to-path mappings, full-page session restore, review-request UI, activity log readability, preview, and Apply behavior.
- Full-page enhancement starts from a popup-created `jiraEnhancer.fullPageSession.<id>` localStorage record. When changing pending enhancement shape, selected harness settings, env handling, or field payloads, update the session type/load path and preserve compatibility for already-open sessions where practical.
- The full-page **Review enhancement request** view should show the selected harness/provider/model/launch path, a collapsed wrapped harness command/IPC preview, the exact prompt sent to the harness, and custom instructions when present. Use `plans/design-screenshots/full-page-review-request.png` and `plans/design-screenshots/full-page-review-command-expanded.png` as visual references for spacing, metadata cards, folded command preview, and prompt review layout.
- The activity view should present readable harness output: assistant text, final output, tool calls, and tool results. Prefer interpreting escaped newlines and exposing useful tool arguments/results over raw one-line JSON dumps; keep raw IPC available only behind debug/raw paths. Use `plans/design-screenshots/full-page-activity-log.png` as the visual reference for readable processing rows and tool call/result formatting.
- Do not treat the current Sub-tasks screens as the design baseline. `SubtaskPanel`, `subtask-activity`, and `subtask-review` exist, but their UX is not yet on par with the full-page Enhance Issue flow. When touching sub-task UI, align it toward the full-page review/activity design references above rather than copying the current sub-task layout.
- Applying enhanced fields uses authenticated Jira REST from the browser session. It should send only fields with discovered IDs, retry without custom fields Jira rejects as not editable/unknown, and report skipped field IDs instead of failing the whole save when remaining fields can be saved.
- When changing behavior, protocol, UI persistence keys, Jira field handling, security/privacy rules, or setup assumptions, update `SPECS.md` in the same change.

### ADF transformers

`adfToMarkdown` and `markdownToAdf` in `packages/shared/src/` have **no external dependencies**. Keep them that way. If a new ADF node type needs support, add a case to the `renderNode` switch in `adf-to-markdown.ts` and a corresponding test.

---

## Testing

### Unit tests (Vitest)

Test files live next to source code in `__tests__/` directories. Use `vitest` (not Jest). Import as:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

For DOM tests in the extension, add `// @vitest-environment jsdom` at the top of the test file.

For Chrome API mocking in extension tests, mock the `chrome` global in `beforeEach`:

```typescript
const chromeMock = { runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() } } };
vi.stubGlobal('chrome', chromeMock);
```

For bridge tests that mock `child_process`, use `vi.mock('child_process')` at the module level.

Test fixtures must be synthetic. Before committing tests, scan for customer/company names, private Jira hosts, private project keys, real issue descriptions, emails, tokens, and product-specific terms. Use placeholders like `PROJ-123`, `example.com`, `private.example.com`, generic product names, and synthetic story text.

### E2E tests (Playwright)

Live in `packages/extension/__tests__/e2e/`. Requires a built extension at `packages/extension/dist`. Run with `npx playwright test` after `pnpm build`.

The Playwright config is at the repo root (`playwright.config.ts`). The vitest config (`vitest.config.ts`) explicitly excludes `e2e/**` so Playwright specs aren't picked up by vitest.

---

## Adding a New LLM Provider

1. Create `packages/bridge/src/llm/<name>-adapter.ts` implementing `refine(projectPath, markdown, customPrompt?): Promise<string>`.
2. Add the new provider string to `LlmProvider` in `packages/shared/src/protocol.ts`.
3. Add a case to `createAdapter()` in `packages/bridge/src/llm/index.ts`.
4. Update `BridgeConfig.defaultProvider` type in `packages/shared/src/config-types.ts`.
5. Add the new option to `EnhancePanel.tsx` provider dropdown in the extension.
6. Write unit tests for the adapter.

---

## Adding a New ADF Node Type

1. Add a case to the `renderNode` switch in `packages/shared/src/adf-to-markdown.ts`.
2. Add a corresponding builder in `packages/shared/src/markdown-to-adf.ts` if the node type has a Markdown representation.
3. Add tests in `packages/shared/__tests__/adf-to-markdown.test.ts`.

---

## File Creation Rules

- Do not create files outside the three packages, `plans/`, or root-level project docs unless there is a clear structural reason.
- Do not create `*.md` documentation files for individual changes — update `SPECS.md` for behavioral specs, `README.md` for setup/overview guidance, or this file for agent workflow guidance.
- Configuration files (ESLint, tsconfig, Prettier) live at repo root and are inherited by packages. Do not duplicate them in packages unless a package needs a specific override.

---

## Common Mistakes to Avoid

| Mistake                                                                   | Correct approach                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `console.log()` in bridge                                                 | `process.stderr.write(...)`                                                                                                                                                                                                          |
| `window` or `document` in `background.ts`                                 | Service worker has no DOM; use `chrome.*` APIs                                                                                                                                                                                       |
| `chrome.*` calls inside React components                                  | Put them in hooks (`useNativeMessaging`, `useRefinement`)                                                                                                                                                                            |
| Importing from `bridge` or `extension` inside `shared`                    | Shared is a leaf package — no upward imports                                                                                                                                                                                         |
| Adding external deps to `packages/shared`                                 | Keep shared dependency-free; embed small utilities                                                                                                                                                                                   |
| Writing to stdout in bridge outside `sendMessage`                         | Will corrupt the native messaging stream                                                                                                                                                                                             |
| Creating generic `Error` in bridge code                                   | Use `BridgeError(ErrorCode.X, message)`                                                                                                                                                                                              |
| Using `jest` APIs in test files                                           | This repo uses `vitest`; import from `'vitest'`                                                                                                                                                                                      |
| Changing `"default_popup"` in `manifest.json` to `"popup/index.html"`     | Vite preserves the input path structure; the correct value is `"src/popup/index.html"`                                                                                                                                               |
| Assuming the manifest templates contain a real binary path                | Templates use `BRIDGE_PATH_PLACEHOLDER` — always run `scripts/install-unix.sh` or `scripts/install-windows.ps1` to generate the installed manifest; never edit it by hand                                                            |
| Adding a `path` pointing to `/usr/local/bin/` in the native host manifest | The bridge is not installed system-wide; root-level install scripts resolve `packages/bridge/dist/index.js` relative to the repo and write the absolute path                                                                         |
| Treating `README.md` as the behavior spec                                 | Use `SPECS.md` for product/technical behavior; keep `README.md` as overview/setup/development guide                                                                                                                                  |
| Committing private Jira hosts in manifest/docs                            | Use gitignored `.env` and `ALLOWED_SITES`; examples must stay generic                                                                                                                                                                |
| Copying real Jira/customer text into tests or fixtures                    | Sanitize all fixtures: use `PROJ-123`, `example.com`, `private.example.com`, generic product names, and synthetic story text. Do not commit customer names, internal product names, real issue text, private hosts, or project keys. |
