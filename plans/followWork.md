# followWork — Jira Enhancer Implementation Plan

## Summary
Monorepo using **pnpm workspaces + Turborepo** with three packages: `shared`, `bridge`, `extension`.

---

## Task 1: Monorepo Scaffold & Tooling

Set up the repo root with pnpm workspaces, Turborepo, TypeScript, ESLint, Prettier, Vitest, and Playwright.

**Deliverables:**
- `pnpm-workspace.yaml`
- `turbo.json`
- `package.json` (root)
- `tsconfig.base.json`
- `.eslintrc.cjs`
- `.prettierrc.json`
- `vitest.config.ts`
- `playwright.config.ts`
- `.gitignore`

---

## Task 2: Shared Package — Types & Protocol

Create `packages/shared` with all shared TypeScript types: native messaging protocol, Jira/ADF schemas, config types, and error codes.

**Deliverables:**
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `packages/shared/src/index.ts`
- `packages/shared/src/protocol.ts` — message interfaces (extension ↔ bridge)
- `packages/shared/src/jira-types.ts` — ADF document nodes, Jira issue shapes
- `packages/shared/src/config-types.ts` — project mapping, bridge config
- `packages/shared/src/errors.ts` — error codes & typed error class

---

## Task 3: Shared Package — ADF ↔ Markdown Transformer

Implement bidirectional ADF ↔ Markdown conversion inside `packages/shared`.

**Deliverables:**
- `packages/shared/src/adf-to-markdown.ts`
- `packages/shared/src/markdown-to-adf.ts`
- `packages/shared/__tests__/adf-to-markdown.test.ts`
- `packages/shared/__tests__/markdown-to-adf.test.ts`

**Dependencies:** `marklassian` (MD→ADF, lightweight).  
For ADF→MD, implement a minimal recursive renderer (ADF nodes are well-structured JSON).

---

## Task 4: Bridge Package — Message Protocol

Create `packages/bridge` with the async native messaging protocol (32-bit length-prefixed JSON over stdin/stdout).

**Deliverables:**
- `packages/bridge/package.json`
- `packages/bridge/tsconfig.json`
- `packages/bridge/src/message-protocol.ts` — async read/write with length validation (max 1 MB)
- `packages/bridge/__tests__/message-protocol.test.ts`

---

## Task 5: Bridge Package — Config Manager

Load and validate the `config.json` project-key-to-path mapping.

**Deliverables:**
- `packages/bridge/src/config-manager.ts` — load, validate, resolve paths
- `packages/bridge/config/config.example.json`
- `packages/bridge/__tests__/config-manager.test.ts`

---

## Task 6: Bridge Package — LLM Process Manager

Spawn and manage OpenCode (ACP) and Pi (RPC) CLI processes with timeout, stdout/stderr capture, and lifecycle management.

**Deliverables:**
- `packages/bridge/src/process-manager.ts` — spawn, capture output, timeout, kill
- `packages/bridge/src/llm/opencode-adapter.ts` — ACP protocol adapter
- `packages/bridge/src/llm/pi-adapter.ts` — RPC mode adapter
- `packages/bridge/__tests__/process-manager.test.ts`

---

## Task 7: Bridge Package — Request Handler & Entry Point

Wire protocol + config + process manager into the main bridge entry point.

**Deliverables:**
- `packages/bridge/src/request-handler.ts` — route extension requests, transform ADF↔MD, invoke LLM
- `packages/bridge/src/index.ts` — main entry, async event loop
- `packages/bridge/__tests__/request-handler.test.ts`

---

## Task 8: Bridge Package — Native Host Manifests & Install Script

Generate platform-specific native host manifest JSON files and an install script.

**Deliverables:**
- `packages/bridge/config/native-host-manifest.linux.json`
- `packages/bridge/config/native-host-manifest.macos.json`
- `packages/bridge/config/native-host-manifest.windows.json`
- `packages/bridge/scripts/install-host.sh` — copy manifest + set permissions

---

## Task 9: Extension Package — Manifest & Build Setup

Create `packages/extension` with Vite build, manifest.json (MV3), and entry points.

**Deliverables:**
- `packages/extension/package.json`
- `packages/extension/tsconfig.json`
- `packages/extension/vite.config.ts`
- `packages/extension/public/manifest.json`
- `packages/extension/public/icons/` (placeholder PNGs)

---

## Task 10: Extension Package — Background Service Worker

Implement the service worker that relays messages between content script and native bridge.

**Deliverables:**
- `packages/extension/src/background/background.ts` — native messaging port, message routing
- `packages/extension/src/background/native-messaging.ts` — connect/disconnect/send wrapper
- `packages/extension/__tests__/background.test.ts`

---

## Task 11: Extension Package — Content Script & DOM Injection

Inject the "Enhance" button into Jira ticket pages and handle click events.

**Deliverables:**
- `packages/extension/src/content/inject.ts` — content script entry
- `packages/extension/src/content/dom-injection.ts` — button creation, placement, event listeners
- `packages/extension/src/content/jira-detector.ts` — detect issue key from URL
- `packages/extension/__tests__/dom-injection.test.ts`

---

## Task 12: Extension Package — Popup UI (React)

Build the popup panel with diff view, editable markdown buffer, mode selector, and alternative-version button.

**Deliverables:**
- `packages/extension/src/popup/index.html`
- `packages/extension/src/popup/popup.tsx` — root component
- `packages/extension/src/popup/components/EnhancePanel.tsx` — mode selector (Default / Custom)
- `packages/extension/src/popup/components/DiffView.tsx` — side-by-side diff
- `packages/extension/src/popup/components/MarkdownEditor.tsx` — editable buffer
- `packages/extension/src/popup/components/LoadingState.tsx`
- `packages/extension/src/popup/hooks/useRefinement.ts` — refinement state machine
- `packages/extension/src/popup/hooks/useNativeMessaging.ts` — bridge communication
- `packages/extension/src/popup/styles/popup.css`

**Dependencies:** `react`, `react-dom`, `react-diff-viewer-continued`.

---

## Task 13: Extension E2E Tests (Playwright)

Write Playwright tests that load the unpacked extension and verify the core flow.

**Deliverables:**
- `packages/extension/__tests__/e2e/extension-flow.spec.ts`
- `packages/extension/__tests__/e2e/fixtures/mock-jira.ts`

---

## Task 14: Final Wiring, Lint, & Validation

Run `pnpm lint`, `pnpm test`, `pnpm build` across the entire monorepo. Fix any issues.

**Deliverables:**
- All packages build cleanly
- All unit tests pass
- Lint passes with zero errors
