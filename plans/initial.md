# Technical Specification: Jira Enhancer System
## 1. Project Overview
The Jira Enhancer is a productivity tool designed to automate and refine Jira ticket descriptions by contextualizing them against a local or remote codebase. It consists of three primary layers:

1. Chrome Extension: The UI/UX layer that extracts ticket data and presents AI refinements.
2. Native Messaging Bridge (Node.js/TS): A secure, local intermediary that bypasses browser security to talk to the OS.
3. LLM Processor (OpenCode/Pi/Copilot): The agentic engine that explores the codebase and transforms content.

## 2. Browser Extension Specifications (Chrome Manifest V3)
The extension follows the Manifest V3 standard, utilizing Service Workers for background logic. 

### Core Capabilities:
- Data Extraction: Automatically detects Jira issue keys from the URL and fetches the description (Atlassian Document Format - ADF) and custom fields via the Jira REST API. 
- UI Overlay: Injects an "Enhance" button into the Jira ticket header. Upon result, it renders a Split-Pane Diff View and an Editable Markdown Buffer. 
- Refinement Control: Supports two modes:
    1. Default: Refine description by exploring the repository (requires mapping the Jira Project Key to a local path).
    2. Custom: Direct prompt input from the user to steer the LLM. 

### Manifest Requirements:
- Permissions: `nativeMessaging`, `storage`, `tabs`, `host_permissions` (for `*.atlassian.net`).
- Content Scripts: Injected into `atlassian.net` to handle DOM events and UI injection.

## 3. Native Messaging Bridge (Node.js/TypeScript)
The bridge is a standalone Node.js application that communicates with Chrome via `stdin` and `stdout`. It acts as the process manager for the LLM CLI tools.

### Implementation Requirements:
- Protocol Handling: Every message must be a JSON object preceded by a 32-bit unsigned integer representing the message length in native byte order.
- Project Context Mapping: The bridge maintains a `config.json` mapping Jira project values (e.g., `PROJ`) to local absolute filesystem paths. 
- Process Spawning: The bridge uses `child_process.spawn` to initiate the LLM processor in its specific integration mode (ACP or RPC). 

### Implementation Code (TypeScript):

```typescript
import * as fs from 'fs';

// Helper to read 32-bit length header
function readMessage() {
  const header = Buffer.alloc(4);
  const bytesRead = fs.readSync(0, header, 0, 4, null);
  if (bytesRead === 0) process.exit(0);
  const length = header.readUInt32LE(0);
  const message = Buffer.alloc(length);
  fs.readSync(0, message, 0, length, null);
  return JSON.parse(message.toString('utf-8'));
}

// Helper to send message with 32-bit header
function sendMessage(msg: object) {
  const buffer = Buffer.from(JSON.stringify(msg));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}

// Main Loop
process.stdin.on('readable', () => {
  const payload = readMessage();
  handleExtensionRequest(payload);
});
```

## 4. LLM Processor Passthrough (OpenCode / Pi CLI)
The bridge transforms extension requests into CLI-specific commands.

### OpenCode (via Agent Client Protocol)
- Command: `opencode acp --cwd [project_path]` 
- Input: Send a JSON prompt: `{"type": "prompt", "content": "Refine Jira description: [desc] using codebase context."}`
- Transformation: OpenCode explores the codebase using tools like `grep`, `glob`, and `read` to ensure the ticket reflects reality. 

### Pi CLI (via RPC Mode)
- Command: `pi --mode rpc` 
- Interaction: Supports "Steering" behavior, allowing the extension to queue follow-up refinement messages while the agent is still running. 
- Session Management: Sessions are stored as trees, allowing the user to query "Alternative Versions" by branching the session history. 

## 5. Jira Data Interaction & Transformation
Large Language Models cannot natively process Atlassian Document Format (ADF) JSON. The bridge or extension must implement a transformation layer. 
- ADF to Markdown: Use a library like `extended-markdown-adf-parser` or `marklassian` to convert Jira descriptions into a format the LLM understands. 
- Markdown to ADF: After refinement, the Markdown output must be converted back into valid ADF to update the ticket via the Jira REST API. 

## 6. User Experience & Feedback Loops
- Diff Visualization: Use `react-diff-view` or `react-diff-viewer-continued` to show the side-by-side comparison of the original vs. AI-refined description. 
- Human-in-the-Loop: Provide an editable text area where the user can tweak the AI's proposal before committing.
- Iteration: A "Query New Alternative" button triggers a new LLM turn with a prompt like "Give me a more high-level/technical version." 

## 7. Configuration & Installation Requirements
1. LLM Processor: OpenCode or Pi CLI must be installed and authenticated on the user's machine. 
2. Native Host Manifest: A JSON file must be registered in the OS's native messaging directory (e.g., `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`) linking the bridge executable to the extension ID.
3. Project Mapping: A `config.json` file in the bridge directory must map Jira Project Keys to local repo paths:

```json
{
  "mappings": {
    "CORE": "/Users/dev/repos/core-api",
    "WEB": "/Users/dev/repos/frontend-ui"
  }
}```

## 8. Formatting && Testing
1. Each part must have unit tests
2. Use browser tools (playwright) to test extension, doc `https://playwright.dev/docs/chrome-extensions`
3. Code must be linted before running