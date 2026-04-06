# Jira Enhancer

An AI-powered productivity tool that refines Jira ticket descriptions by contextualising them against your local codebase. It uses a Chrome Extension as the UI layer, a local Node.js bridge for secure OS access, and either **OpenCode** or **Pi CLI** as the agentic LLM engine.

---

## How It Works

```
  Jira (browser)
       │  clicks "✨ Enhance"
       ▼
  Chrome Extension
  ├── content script  — detects issue key from URL, injects button
  ├── service worker  — routes messages to native host
  └── popup (React)   — diff view, editor, mode/provider selector
       │  chrome.runtime.connectNative
       ▼
  Native Messaging Bridge  (Node.js / this repo)
  ├── reads ADF description from Jira REST API
  ├── converts ADF → Markdown
  ├── spawns LLM CLI (OpenCode ACP or Pi RPC)
  │       └── CLI explores codebase with grep/glob/read tools
  ├── receives refined Markdown
  ├── converts Markdown → ADF
  └── returns result to extension
       │
       ▼
  Extension renders side-by-side diff.
  User edits and accepts → Jira description updated.
```

The bridge communicates with Chrome over **stdin/stdout** using the [Chrome Native Messaging protocol](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): every JSON message is prefixed with a 4-byte little-endian length header.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 20 | Bridge runtime |
| pnpm ≥ 9 | Package manager (`npm i -g pnpm`) |
| Chrome / Chromium | Extension host |
| [OpenCode](https://opencode.ai) **or** [Pi CLI](https://pi.ai/cli) | Must be installed and authenticated |

---

## Repository Structure

```
jira-enhancer/
├── packages/
│   ├── shared/          # Types, protocol definitions, ADF↔Markdown transformers
│   ├── bridge/          # Native Messaging bridge (Node.js / TypeScript)
│   └── extension/       # Chrome Extension (Manifest V3 / React)
├── plans/               # Design documents
├── turbo.json           # Turborepo pipeline
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### `packages/shared`

Shared TypeScript interfaces and pure utilities consumed by both the bridge and the extension.

```
src/
├── protocol.ts        # Message schemas (BridgeMessage, ExtensionMessage, enums)
├── jira-types.ts      # AdfDocument, AdfNode, JiraIssue
├── config-types.ts    # BridgeConfig, ProjectMapping
├── errors.ts          # ErrorCode enum, BridgeError class
├── adf-to-markdown.ts # Recursive ADF → Markdown renderer (no external deps)
└── markdown-to-adf.ts # Line-by-line Markdown → ADF parser (no external deps)
```

### `packages/bridge`

Standalone Node.js process registered as a [Native Messaging Host](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host).

```
src/
├── index.ts             # Entry point, message loop, signal handlers
├── message-protocol.ts  # NativeMessagingProtocol (async stream framing, 1 MB limit)
├── config-manager.ts    # Load & validate config.json, project path resolution
├── request-handler.ts   # Dispatch EnhanceRequest → LLM adapter → response
├── process-manager.ts   # Spawn LLM CLI, capture output, enforce timeouts, cleanup
└── llm/
    ├── opencode-adapter.ts  # OpenCode ACP mode (pipe JSON to stdin)
    ├── pi-adapter.ts        # Pi RPC mode
    └── index.ts             # createAdapter() factory
config/
├── config.example.json          # Template for user config
├── native-host-manifest.linux.json
├── native-host-manifest.macos.json
└── native-host-manifest.windows.json
scripts/
└── install-host.sh   # Copies manifest to Chrome's NativeMessagingHosts directory
```

### `packages/extension`

Chrome Extension built with Vite + React.

```
src/
├── background/
│   ├── background.ts          # Service worker: routes messages to native host
│   └── native-messaging.ts    # NativeMessagingClient wrapper (auto-connect, routing)
├── content/
│   ├── inject.ts              # Content script entry (MutationObserver for SPA nav)
│   ├── dom-injection.ts       # injectEnhanceButton(), updateButtonState()
│   └── jira-detector.ts       # detectIssueKey() from URL
└── popup/
    ├── popup.tsx              # Root component (enhance → diff → edit flow)
    ├── components/
    │   ├── EnhancePanel.tsx   # Mode selector, provider picker, trigger button
    │   ├── DiffView.tsx       # Side-by-side diff (react-diff-viewer-continued)
    │   ├── MarkdownEditor.tsx # Editable buffer for the refined description
    │   └── LoadingState.tsx   # Spinner + status text + optional progress bar
    └── hooks/
        ├── useNativeMessaging.ts  # Chrome messaging bridge hook
        └── useRefinement.ts       # Refinement state machine hook
```

---

## Installation

### 1. Install dependencies

```bash
pnpm install
```

### 2. Build all packages

```bash
pnpm build
```

### 3. Configure the bridge

Copy the example config:

```bash
cp packages/bridge/config/config.example.json packages/bridge/config.json
```

Edit `packages/bridge/config.json` to map your Jira project keys to local repo paths:

```json
{
  "mappings": {
    "PROJ": "/home/you/repos/my-project",
    "WEB":  "/home/you/repos/frontend"
  },
  "defaultProvider": "opencode",
  "timeout": 120000
}
```

| Field | Description |
|---|---|
| `mappings` | Object mapping Jira project key prefixes (e.g. `"PROJ"`) to absolute local paths |
| `defaultProvider` | `"opencode"` or `"pi"` |
| `timeout` | Max LLM runtime in milliseconds (default 120 000 = 2 minutes) |

### 4. Install the native messaging host

After building, install the bridge binary and register it with Chrome:

```bash
# Find your extension ID on chrome://extensions after loading it
bash packages/bridge/scripts/install-host.sh <YOUR_EXTENSION_ID>
```

The script auto-detects Linux vs macOS and copies the manifest to the correct Chrome directory.

**Windows:** Manually copy `packages/bridge/config/native-host-manifest.windows.json` to `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jira_enhancer.bridge` in the registry (value = path to the JSON file).

### 5. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `packages/extension/dist`

---

## Development

### Commands

| Command | Description |
|---|---|
| `pnpm build` | Build all packages (respects Turborepo dependency order) |
| `pnpm test` | Run all unit tests (Vitest) |
| `pnpm lint` | ESLint across all packages |
| `pnpm format` | Prettier write |
| `pnpm format:check` | Prettier check (used in CI) |

### Watch mode (extension)

```bash
pnpm --filter @jira-enhancer/extension dev
```

Rebuilds the extension on file changes. Reload the extension in `chrome://extensions` after each rebuild.

### Running only one package

```bash
pnpm --filter @jira-enhancer/bridge test
pnpm --filter @jira-enhancer/shared build
```

### Unit tests

76 tests across 8 test files. Run with:

```bash
pnpm test
```

Coverage report is written to `packages/*/coverage/`.

### E2E tests (Playwright)

E2E tests load the extension as an unpacked extension into a real Chromium instance:

```bash
# Build the extension first
pnpm --filter @jira-enhancer/extension build

# Run Playwright tests
npx playwright test
```

Tests live in `packages/extension/__tests__/e2e/`.

---

## Native Messaging Protocol

Messages between the extension and bridge follow the [Chrome Native Messaging framing](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-protocol):

```
[ 4 bytes: message length (UInt32LE) ][ N bytes: UTF-8 JSON payload ]
```

Maximum message size: **1 MB**.

### Extension → Bridge (`BridgeMessage`)

```typescript
// Refinement request
{
  type: "ENHANCE_REQUEST",
  id: "uuid-v4",
  issueKey: "PROJ-123",
  description: "Markdown text of current description",
  mode: "default" | "custom",
  customPrompt?: "Make it more technical",
  provider: "opencode" | "pi"
}

// Cancel in-flight request
{ type: "CANCEL", id: "uuid-v4" }
```

### Bridge → Extension (`ExtensionMessage`)

```typescript
// Success
{
  type: "ENHANCE_RESPONSE",
  id: "uuid-v4",
  originalDescription: "...",
  refinedDescription: "..."
}

// Status update (streaming progress)
{
  type: "STATUS",
  id: "uuid-v4",
  status: "processing" | "exploring" | "refining" | "complete",
  progress?: 0.65
}

// Error
{
  type: "ERROR",
  id: "uuid-v4",
  code: "PROJECT_NOT_FOUND" | "LLM_TIMEOUT" | "LLM_PROCESS_ERROR" | ...,
  message: "Human-readable description"
}
```

---

## LLM Providers

### OpenCode (default)

The bridge spawns `opencode acp --cwd <projectPath>` and writes a JSON prompt to stdin:

```json
{ "type": "prompt", "content": "Refine this Jira ticket description using context from the codebase:\n\n..." }
```

OpenCode then explores the codebase with its built-in tools (`grep`, `glob`, `read`) and returns the refined Markdown on stdout.

### Pi CLI

The bridge spawns `pi --mode rpc --cwd <projectPath>` and pipes the Markdown description to stdin. Pi's RPC mode supports "steering" — queuing follow-up refinement messages while the agent is still running.

---

## ADF ↔ Markdown

Jira stores descriptions as **Atlassian Document Format (ADF)** — a structured JSON tree. LLMs work in plain text, so the bridge transparently converts:

```
Jira ADF ──[adfToMarkdown]──► Markdown ──[LLM]──► Markdown ──[markdownToAdf]──► Jira ADF
```

Both converters live in `packages/shared` and have **no external dependencies** — they are small, fully-typed recursive implementations.

Supported ADF node types: `doc`, `paragraph`, `text` (with marks: bold, italic, code, link, strikethrough, underline), `heading`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `blockquote`, `rule`, `hardBreak`, `table`/`tableRow`/`tableHeader`/`tableCell`, `mention`, `inlineCard`, `mediaSingle`, `status`.

---

## Error Reference

| Code | Cause |
|---|---|
| `INVALID_MESSAGE` | Malformed JSON or unknown message type |
| `PROJECT_NOT_FOUND` | Issue key prefix not present in `config.json` mappings |
| `LLM_TIMEOUT` | LLM process exceeded configured timeout |
| `LLM_PROCESS_ERROR` | LLM CLI exited with non-zero code |
| `CONFIG_ERROR` | `config.json` missing, unreadable, or invalid |
| `ADF_TRANSFORM_ERROR` | ADF parsing or serialisation failed |
| `UNKNOWN` | Unexpected / uncaught exception |

---

## Contributing

```bash
# Install
pnpm install

# Develop (watch mode for extension)
pnpm --filter @jira-enhancer/extension dev

# Before committing — lint-staged runs automatically via Husky
pnpm lint && pnpm test
```

TypeScript `strict` mode is enabled in all packages. ESLint enforces `@typescript-eslint/recommended`. Prettier is enforced on all `.ts`, `.tsx`, `.json`, `.yaml`, and `.md` files.
