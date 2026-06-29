# Jira Enhancer Specification

This file is the source of truth for Jira Enhancer product and technical behavior. Update it in the same change whenever behavior, protocol, UI, persistence, security posture, or setup assumptions change.

For project overview, setup, development commands, and package layout, see [README.md](./README.md). For coding-agent workflow rules, see [AGENTS.md](./AGENTS.md).

---

## 1. Product scope

Jira Enhancer is a Chrome Extension + native Node.js bridge that helps refine Jira issue descriptions using a local agentic LLM harness and local codebase context.

The product must support:

- Reading the current Jira issue key from the active tab URL.
- Reading the current Jira issue description, preferably as raw Jira wiki/text markup.
- Reading Jira component names for the current issue.
- Selecting an LLM harness, provider, model, and launch path.
- Mapping Jira components to local launch paths so future issues select the correct repo automatically.
- Downloading authenticated Jira images in the browser and exposing them to the local harness as temporary files.
- Restoring original Jira image URLs before showing or writing back refined text.
- Showing a diff, allowing edits, and writing accepted text back to the Jira page when possible.

---

## 2. Documentation contract

- `README.md` is an overview + install/setup/development guide. It should not be treated as the full behavior spec.
- `SPECS.md` is the product/technical specification and must be updated with behavior changes.
- `AGENTS.md` is the coding-agent guide and must point agents to both files.

---

## 3. Packages and boundaries

The monorepo has three packages:

| Package              | Role                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `packages/shared`    | Shared protocol, config types, errors, ADF/Markdown transformers            |
| `packages/bridge`    | Native Messaging host; spawns harness CLIs; writes temp images              |
| `packages/extension` | Chrome MV3 extension; popup UI, background routing, content/page extraction |

Dependency direction:

```text
extension -> shared
bridge    -> shared
```

`shared` must not import from `bridge` or `extension`. `bridge` and `extension` must not import from each other.

---

## 4. Chrome extension manifest and allowed sites

Allowed Jira sites are configured at build time through `ALLOWED_SITES`.

- `.env` is gitignored and may contain private host patterns.
- `.env.example` must contain only non-sensitive generic examples.
- `packages/extension/vite.config.ts` reads `ALLOWED_SITES` from either repo root or `packages/extension`.
- The build writes the resolved sites to `packages/extension/dist/manifest.json`:
  - `host_permissions`
  - `content_scripts[].matches`

`ALLOWED_SITES` is comma-separated Chrome match patterns, for example:

```env
ALLOWED_SITES=https://*.atlassian.net/*,https://*.jira.com/*
```

Never commit company/private Jira hostnames or customer-identifying hostnames. Local setup may use `scripts/install-unix.sh` or `scripts/install-windows.ps1` to prompt for private domains and save them to the gitignored `.env` before building the extension.

---

## 5. Popup workflow

The popup is the primary UI. It is implemented in `packages/extension/src/popup/popup.tsx` and `components/EnhancePanel.tsx`.

### 5.1 Issue detection

- The popup queries the active tab with `chrome.tabs.query({ active: true, currentWindow: true })`.
- It extracts the issue key from URLs matching `/browse/<PROJECT>-<number>`.
- If no issue key is detected, the popup shows an empty state.

### 5.2 Description loading

When auto-read is enabled, the popup reads the current description on open and on manual refresh.

Order of attempts:

1. **Jira REST API** using authenticated browser cookies:
   - `GET <origin>/rest/api/2/issue/<issueKey>?fields=*all&expand=names`
   - `credentials: 'include'`
   - If `fields.description` is present, use it as raw Jira wiki/text markup or convert ADF documents to Markdown.
   - If `fields.components` exists, store component names.
   - Use `names` metadata to find custom fields named `Story Points`, `Story point estimate`, and `Acceptance Criteria` regardless of Jira custom-field IDs.
   - Read `fields.issuetype.name`; story points and acceptance criteria are shown and sent to the harness only when the issue type is Story.
2. **Page script fallback** via `chrome.scripting.executeScript`:
   - First looks for an active Jira description editor textarea, especially Text mode.
   - Otherwise converts rendered description DOM to Markdown-like text.
   - Also collects authenticated images from `<img>` tags.
3. **Content script fallback** via `GET_JIRA_DESCRIPTION` message.

The UI shows debug/status text indicating which source was used and how many chars/images/components/custom fields were read.

### 5.3 Full-page enhancement and review

When the user starts an enhancement from the popup, the popup stores the gathered issue context and selected harness settings in local `localStorage` session data, opens `src/full-page/index.html`, and closes. The full page owns the long-running harness activity UI and final review.

The full-page review must:

- keep the originating Jira tab ID and issue key from the popup session;
- show harness activity and raw IPC behind the existing toggle;
- show structured original/enhanced field cards;
- make enhanced fields editable before validation;
- preview the edited structured fields back in the originating Jira tab with `SET_JIRA_FIELDS` when requested.

Current Jira preview is DOM-level only: it renders the enhanced description into the visible Jira page through the content script or `chrome.scripting.executeScript` fallback, refuses to overwrite an open Jira editor, and does not guarantee Jira persistence. A separate `Apply` action is enabled only after previewing; it attempts authenticated Jira REST write-back using the same browser session path as REST field loading. Story points and acceptance criteria are carried in the structured payload and are sent only when their Jira field IDs were discovered.

### 5.4 Sub-task generation

The popup/full-page UI exposes a top-level `Sub-tasks` tab alongside the default `Enhance Issue` flow. It generates editable Jira sub-task definitions; creating actual Jira issues is a separate future/explicit action and must not happen during generation.

Sub-task generation uses `GENERATE_SUBTASKS_REQUEST` / `GENERATE_SUBTASKS_RESPONSE` and returns structured JSON containing `SubtaskGenerationResult.subtasks`. Default expected task families are Pull Request, Copilot Quality, QA Tests, Dev Tests, Unit Tests when needed, Documentation when needed, Release Procedure when needed, plus implementation sub-tasks inferred from the current Jira fields and any available enhanced fields. The Sub-tasks tab includes a persisted `Generate titles only` option stored in `localStorage['jiraEnhancer.subtaskTitleOnly']`; it defaults on, is shown under a collapsed-by-default `Sub-task Content` card, and instructs the harness to produce title-only sub-tasks with blank descriptions for teams that only use Jira sub-task summaries. Saved custom sub-task prompts support favorite/unfavorite and delete actions like saved enhancement prompts.

Harness sessions are tracked with `HarnessSessionRef`. Enhancement responses store a session reference when available. The Sub-tasks tab shows a reuse indicator/toggle when a same-issue enhancement session is available; it defaults on. When session reuse is enabled, harness/provider/model/launch path/safety are locked to the reused session. Intentional same-issue session context reuse is allowed so the harness can use repository facts gathered during enhancement. Pi reuse uses `--session-id` instead of `--no-session`; read-only mode still applies `--tools read,grep,find,ls`. OpenCode reuse continues the known ACP session id when provided.

Sub-task generation history is stored separately under `localStorage['jiraEnhancer.subtaskHistory.<issueKey>']`. Generated sub-tasks are reviewed as editable cards and can be accepted into local history or cancelled.

### 5.5 History and rollback

The popup/full-page UI exposes a top-level `History` page for the current issue. It takes over the popup body and provides a Back button through the normal page navigation.

History sources:

- local enhancement history stored under `localStorage['jiraEnhancer.resultHistory.<issueKey>']`;
- Jira REST changelog entries loaded from authenticated Jira REST (`/rest/api/3/issue/<key>/changelog` when available, otherwise `/rest/api/2/issue/<key>?fields=none&expand=changelog`).

Only fields the extension can interact with are shown: description, Story Points, and Acceptance Criteria. Jira changelog rollback candidates use the changelog `fromString` value merged with freshly read current Jira fields. Because Jira changelog rich-text fidelity can vary by Jira deployment and field type, changelog rollback is best-effort and always requires user confirmation before REST apply.

Each history entry provides:

- `View` to inspect the stored field values;
- `Compare with current` to diff the historical candidate against freshly fetched Jira REST fields;
- `Preview` to render the candidate into the Jira page without persistence using the same Jira-wiki-to-DOM preview renderer used by enhancement results;
- `Apply…` to persist the candidate via Jira REST after browser confirmation.

### 5.6 Converter lab

A header `+` button opens a local converter lab page. The lab is intended as a future settings/tools entry point and currently lets users paste Jira wiki markup and inspect:

1. Jira markup input;
2. converted Markdown;
3. round-tripped Jira markup;
4. a local HTML preview rendered from the round-tripped Jira markup.

By default, the lab input uses the current Jira issue description. Users can switch to their editable draft or the built-in smoke-test fixture. The draft input is stored in `localStorage['jiraEnhancer.converterLab.input']`. The lab must not call the native bridge except for explicit debug-log requests. It may render the current round-trip preview into the visible Jira description DOM via the content script for comparison, but this is DOM-only preview and must not call Jira REST or persist changes. A debug snapshot action sends the Jira markup input, Markdown output, round-trip Jira markup, rendered preview text, and rendered preview HTML to the existing opt-in debug log channel. Its preview uses the same `renderJiraMarkup()` DOM renderer as Jira-page preview and should visually approximate Jira Server/DC output for inline formatting, links, attachment links/images, user mentions, tables, code/noformat panels, color/quote/panel macros, mixed nested lists, inline double/triple dash symbols, and emoticon tokens.

### 5.7 Auto-read setting

- Checkbox label: `Read automatically from the current Jira page`.
- Stored in `localStorage['jiraEnhancer.autoReadDescription']`.
- Default is enabled unless the stored value is exactly `'false'`.
- Manual `Refresh` must still work when auto-read is disabled.

---

## 6. Description extraction details

### 6.1 REST source

REST is preferred because it can return raw Jira wiki/text markup such as:

```text
h3. Current behavior

!image.png!

h3. Expected behavior
```

If REST returns an object/ADF instead of a string, the popup converts ADF documents to Markdown when possible.

Jira wiki markup and Markdown conversion lives in `packages/shared/src/markdown-to-jira-markup.ts` and `packages/shared/src/jira-markup-to-markdown.ts`, not in popup-local helpers. The shared converters currently cover headings, bold/italic/strike/underline/citation/superscript/subscript/monospace, links/images/attachments/anchors/user mentions, fenced code blocks with languages and common `{code}` options, `{noformat}`, `bq.` and `{quote}`, `{color}`, panels as blockquote-style Markdown, horizontal rules, nested and mixed bullet/ordered lists (`*`, `#`, `#*`, `*#`), Jira/Markdown tables, Jira escaping, and preservation of Jira emoticon/icon tokens such as `:)`, `(y)`, `(!)`, and `(flag)`. Popup preview and Jira Cloud REST apply must use these shared converters consistently.

The REST source requests all fields plus Jira field display-name metadata because Jira custom-field IDs vary by instance. The popup identifies story points and acceptance criteria by display name, normalizes string/number/list/ADF values, and displays them in fields separate from the main description for Story issues. Harness requests are structured JSON fields; non-Story issues send only `description`.

### 6.2 Editor textarea source

When the user has opened the Jira description editor, the extractor checks textareas such as:

- `#descriptionmodule textarea`
- `textarea[name="description"]`
- `textarea#description`
- `textarea.wiki-textfield`
- `.wiki-edit textarea`
- `.jira-wiki-editor textarea`

If any textarea has a non-empty value, that value is used as the description.

### 6.3 Rendered DOM source

When raw/editor text is unavailable, rendered HTML is converted into Markdown-like text:

| HTML       | Output                    |
| ---------- | ------------------------- |
| `h1`       | `# heading`               |
| `h2`       | `## heading`              |
| `h3`       | `### heading`             |
| `h4`       | `#### heading`            |
| `p`        | paragraph with blank line |
| `li`       | `- item`                  |
| `a[href]`  | `[text](href)`            |
| `img[src]` | `![alt](src)`             |

Selectors currently include classic Jira Server/DC and Jira Cloud-ish forms:

- `[data-testid="issue-description"]`
- `[data-testid="issue.views.field.rich-text.description"]`
- `#description-val`
- `#descriptionmodule .mod-content`
- `#descriptionmodule`
- `[data-field-id="description"]`
- `[data-fieldtype="textarea"]`
- `.user-content-block`

---

## 7. Authenticated images

Jira images may require browser-authenticated cookies, so the Node bridge cannot fetch them directly.

Current image flow:

1. Page script finds `<img>` elements during description extraction.
2. Browser downloads each image with:
   ```ts
   fetch(img.src, { credentials: 'include' });
   ```
3. Browser converts each `Blob` to base64.
4. Extension sends `SAVE_IMAGES_REQUEST` to the bridge.
5. Bridge writes files under a temporary directory:
   ```text
   /tmp/jira-enhancer-<request-id>-*/image-N.<ext>
   ```
6. Before enhance, extension replaces original image URLs in Markdown with temp file paths.
7. After harness response, extension replaces temp paths back to the original Jira URLs before display/writeback.

Images should only appear where they were present in the extracted description. Do not append a catch-all list of all page images to the end of the description.

---

## 8. Harness, provider, model, and launch path

### 8.1 Terms

- **Harness**: the CLI/runtime launched by the bridge. Current values: `opencode`, `pi`.
- **Provider**: model provider inside a harness, e.g. `amazon-bedrock`, `github-copilot`, etc.
- **Model**: model identifier inside a provider.
- **Launch path**: local filesystem path used as the harness working directory.

### 8.2 Model listing

The popup requests models through native messaging.

- For OpenCode, bridge runs:
  ```bash
  opencode models
  ```
  It parses lines as `provider/model`.
- For Pi, bridge runs:
  ```bash
  pi --list-models
  ```
  It parses provider/model/context/max-out/thinking/images columns.
- Model listing receives the selected harness environment overrides, so providers such as Bedrock can appear when `AWS_PROFILE`/`AWS_REGION` are required.
- On Windows, the bridge must resolve npm-installed harness command shims such as `opencode.cmd` and `pi.cmd` so Chrome native-host launches can list models and run harnesses even when the executable is a command shim.
- Duplicate provider/model pairs are removed.
- Provider dropdown is populated from available providers.
- Model dropdown is filtered by selected provider and deduplicated.

### 8.3 OpenCode ACP enhancement activity

For OpenCode enhancement, the bridge runs OpenCode as an ACP subprocess:

```bash
opencode acp --cwd <launchPath>
```

The bridge speaks ACP JSON-RPC over stdio:

1. `initialize`
2. `session/new` with the selected launch path as `cwd`
3. `session/set_config_option` for `model` when the selected `provider/model` appears in OpenCode session config options
4. `session/set_config_option` for `mode=plan` when Harness Safety is read-only and OpenCode exposes that mode option
5. `session/prompt` with the structured Jira enhancement prompt

The bridge accumulates `agent_message_chunk` text from `session/update` notifications and parses the final assistant text as structured JSON. It emits `HARNESS_EVENT` messages for OpenCode status, assistant chunks, tool calls, tool updates, usage updates, and final structured output readiness.

OpenCode ACP support depends on OpenCode's own configured permissions, MCP servers, slash commands, and project rules. Harness Safety read-only uses the strongest bridge-driven ACP setting currently available (`mode=plan`) when OpenCode exposes it; this is not equivalent to Pi's strict tool allowlist.

### 8.4 Pi enhancement activity

For Pi enhancement, the bridge runs Pi in RPC mode and sends a JSONL `prompt` command. The prompt sends structured Jira fields and requires strict JSON final output with Markdown string values. `description` is always included; `acceptanceCriteria` and `storyPoints` are included only for Story issues. In Harness Safety read-only mode, Pi is launched with an explicit tool allowlist (`read,grep,find,ls`); in Trust AI mode, the bridge does not restrict Pi tools beyond the read-only prompt instruction. The child process working directory is set to the selected launch path.

The bridge parses Pi RPC JSON events and emits `HARNESS_EVENT` messages for:

- status changes (`agent_start`, `turn_start`)
- assistant message deltas
- tool calls
- tool results
- final structured output readiness

Raw RPC JSON must never be shown as refined output unless the user enables the raw IPC toggle. Only parsed structured JSON extracted from Pi events becomes the refined result.

### 8.5 Persistence

The popup stores selections in `localStorage`:

| Key                                   | Meaning                                               |
| ------------------------------------- | ----------------------------------------------------- |
| `jiraEnhancer.harness`                | selected harness (`opencode` or `pi`)                 |
| `jiraEnhancer.provider`               | selected model provider                               |
| `jiraEnhancer.model`                  | selected model                                        |
| `jiraEnhancer.enhanceMode`            | selected enhancement mode (`default` or `custom`)     |
| `jiraEnhancer.safetyMode`             | selected harness safety mode (`read-only`/`trust-ai`) |
| `jiraEnhancer.launchPath`             | current launch path text                              |
| `jiraEnhancer.launchPaths`            | saved launch paths array                              |
| `jiraEnhancer.componentPathMap`       | object mapping Jira component name to launch path     |
| `jiraEnhancer.customPromptDraft`      | current custom prompt draft                           |
| `jiraEnhancer.customPromptTitleDraft` | current custom prompt title draft                     |
| `jiraEnhancer.customPrompts`          | saved custom prompt library                           |
| `jiraEnhancer.selectedCustomPromptId` | currently selected saved prompt id                    |
| `jiraEnhancer.autoReadDescription`    | auto-read toggle                                      |
| `jiraEnhancer.harnessEnv.<app>`       | newline-delimited env overrides for a harness         |
| `jiraEnhancer.showRawIpc`             | raw IPC visibility toggle                             |

### 8.6 Harness environment settings

- The popup has a collapsed-by-default Harness env settings card.
- Values are edited as newline-delimited `KEY=value` pairs, for example:
  ```text
  AWS_PROFILE=bedrock
  AWS_REGION=eu-west-1
  ```
- Environment settings are saved per harness in `localStorage['jiraEnhancer.harnessEnv.<app>']`.
- The saved value is restored when the popup opens and whenever the selected harness changes.
- Parsed variables are passed to both `LIST_MODELS_REQUEST` and `ENHANCE_REQUEST`.
- The bridge merges overrides with its inherited `process.env` before spawning the harness process.

### 8.6 Component-to-launch-path mapping

- Jira components are fetched from REST `fields.components`.
- Components are displayed as badges beside the issue key.
- If a component has a mapped launch path, a Launch Path badge is shown beside it.
- Launch Path badge displays only the final folder name; full path is retained in tooltip/title.
- The Launch Path configuration card collapses when the selected component already has a mapping.
- Expanding the card allows:
  - editing launch path
  - selecting saved launch path
  - saving/removing launch paths
  - linking selected component to current launch path
  - managing/deleting all component mappings
- When an issue has multiple components, the first component with a mapping auto-selects its path.

---

## 9. Native bridge behavior

### 9.1 Protocol framing

The bridge speaks Chrome Native Messaging over stdin/stdout:

- 4-byte little-endian message length
- UTF-8 JSON payload
- stdout is reserved exclusively for framed protocol messages
- logging must go to stderr
- opt-in debug logging is controlled by `JIRA_ENHANCER_DEBUG_LOG` / `JIRA_ENHANCER_LOG_FILE` for bridge/harness diagnostics and `JIRA_ENHANCER_PREVIEW_DEBUG_LOG` / `JIRA_ENHANCER_PREVIEW_LOG_FILE` for preview/debug snapshots

### 9.2 Config loading

`ConfigManager` loads `config.json` relative to built bridge output, not `process.cwd()`, so Chrome launches resolve config reliably.

The config contains:

- `mappings`: Jira project key -> local path
- `defaultProvider`: legacy default harness/provider value
- `timeout`: process timeout in milliseconds

### 9.3 Enhance request

For `ENHANCE_REQUEST`:

1. Validate issue key contains `-`.
2. Determine project path:
   - use `launchPath` if provided
   - otherwise use config mapping by issue project key
3. Create harness adapter from `app ?? provider`.
4. Pass description, custom prompt, timeout, and selection to adapter.
5. Return refined description.

### 9.4 Process timeout

`ProcessManager.spawnWithTimeout` must kill the exact child process it spawned when timeout is reached.

### 9.5 Save images

For `SAVE_IMAGES_REQUEST`, bridge writes base64 image data to temp files and returns `{ originalUrl, tmpPath }` mappings.

---

## 10. Native messaging request/response types

Defined in `packages/shared/src/protocol.ts`.

Current message types:

- `ENHANCE_REQUEST`
- `ENHANCE_RESPONSE`
- `ERROR`
- `STATUS`
- `CANCEL`
- `LIST_MODELS_REQUEST`
- `LIST_MODELS_RESPONSE`
- `SAVE_IMAGES_REQUEST`
- `SAVE_IMAGES_RESPONSE`
- `GET_ENHANCEMENT_STATE`
- `ENHANCEMENT_STATE`
- `HARNESS_EVENT`

Runtime protocol changes must update:

1. `packages/shared/src/protocol.ts`
2. bridge request handling
3. extension background routing final-response logic
4. popup/content callers
5. tests
6. this `SPECS.md`

---

## 11. Background/service worker routing

`packages/extension/src/background/background.ts` owns native host routing.

- Tab-originated requests route final responses back with `chrome.tabs.sendMessage`.
- Popup/runtime-originated requests keep `sendResponse` and return `true` for async replies.
- Final responses include:
  - `ENHANCE_RESPONSE`
  - `ERROR`
  - `LIST_MODELS_RESPONSE`
  - `SAVE_IMAGES_RESPONSE`
- Native disconnect sends `NATIVE_HOST_ERROR` to all pending requests.
- Enhancement status, refined output, and harness events are persisted in `chrome.storage.local` and restored through `GET_ENHANCEMENT_STATE` / `ENHANCEMENT_STATE` when the popup reopens.

---

## 12. Content script behavior

The content script:

- detects the issue key from the URL
- injects the `✨ Enhance` button into Jira pages when possible
- handles `GET_JIRA_DESCRIPTION`
- handles `SET_JIRA_DESCRIPTION`
- uses DOM extraction fallback for descriptions

The content button currently uses the default OpenCode harness unless expanded in a future change.

---

## 13. Accept/writeback behavior

When the user accepts or saves refined text:

- Extension restores original Jira image URLs if temporary image paths are present.
- Extension sends `SET_JIRA_DESCRIPTION` to the content script.
- Current writeback is DOM/text replacement best-effort, not a full Jira REST update with attachment management.

Future changes that implement robust Jira update via REST must update this section.

---

## 14. Testing and verification

Before stopping after code changes, run:

```bash
pnpm test
pnpm build
pnpm lint
pnpm format:check
```

`pnpm test` runs Vitest with V8 coverage enabled. Coverage must stay at or above 90% for lines, branches, functions, and statements for the configured unit-test coverage targets.

For extension UI/E2E:

```bash
pnpm build
pnpm exec playwright test --headed --project=chromium --workers=1
```

Playwright loads `packages/extension/dist`. Full native messaging tests may require installed host manifest and matching extension ID.

---

## 15. Security and privacy constraints

- Do not commit private Jira hostnames, customer names, account identifiers, secrets, cookies, or tokens.
- `.env` and `packages/bridge/config.json` are gitignored and are the correct place for local/private configuration.
- Bridge must never log to stdout.
- Browser-authenticated image bytes are written only to local temp files.
- Temp image paths must be replaced back to original Jira URLs before user-facing final text/writeback.
- Avoid broad host permissions; use `ALLOWED_SITES` for local builds.

---

## 16. Known limitations

- REST raw description handling currently expects `fields.description` to be a string. ADF/object descriptions fall back to page extraction.
- Content-script writeback is best-effort and may not persist through Jira’s internal model unless the DOM/editor state accepts it.
- Image temp files are not currently cleaned up by a retention policy.
- Component-to-path mapping is local-only in browser `localStorage`.
- Chrome action popup size is capped by Chrome; the UI is designed within that limit.
