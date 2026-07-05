import {
  BridgeError,
  buildEnhancementPrompt,
  buildSubtaskGenerationPrompt,
  ErrorCode,
  type HarnessEvent,
  type JiraEnhancementFields,
  type LlmSelection,
  type StructuredEnhancementResult,
  type SubtaskGenerationResult,
} from '@jira-enhancer/shared';
import { debugLog } from '../debug-logger.js';
import type { ProcessManager } from '../process-manager.js';
import {
  parseStructuredEnhancementOutput,
  parseSubtaskGenerationOutput,
} from './structured-output.js';

type HarnessEventEmitter = (event: Omit<HarnessEvent, 'type' | 'id' | 'timestamp'>) => void;

export class PiAdapter {
  constructor(private readonly processManager: ProcessManager) {}

  async refine(
    projectPath: string,
    fields: JiraEnhancementFields,
    customPrompt?: string,
    timeoutMs?: number,
    selection?: LlmSelection,
    onEvent?: HarnessEventEmitter,
  ): Promise<StructuredEnhancementResult> {
    const input = buildEnhancementPrompt(fields, customPrompt, selection);
    const output = await this.runPrompt(projectPath, input, timeoutMs, selection, onEvent);
    return parseStructuredEnhancementOutput(output);
  }

  async generateSubtasks(
    projectPath: string,
    issueKey: string,
    fields: JiraEnhancementFields,
    enhancedFields?: StructuredEnhancementResult,
    customPrompt?: string,
    timeoutMs?: number,
    selection?: LlmSelection,
    onEvent?: HarnessEventEmitter,
  ): Promise<SubtaskGenerationResult> {
    const input = buildSubtaskGenerationPrompt(
      issueKey,
      fields,
      enhancedFields,
      customPrompt,
      selection,
    );
    const output = await this.runPrompt(projectPath, input, timeoutMs, selection, onEvent);
    return parseSubtaskGenerationOutput(issueKey, output, selection?.subtaskTitleOnly);
  }

  private async runPrompt(
    projectPath: string,
    input: string,
    timeoutMs?: number,
    selection?: LlmSelection,
    onEvent?: HarnessEventEmitter,
  ): Promise<string> {
    debugLog('pi prompt', { projectPath, selection, input });
    const args = ['--mode', 'rpc'];
    if (selection?.reuseSession && selection.sessionRef?.id) {
      args.push('--session-id', selection.sessionRef.id);
    } else {
      args.push('--no-session');
    }
    if (selection?.safetyMode !== 'trust-ai') {
      args.push('--tools', 'read,grep,find,ls');
    }
    if (selection?.modelProvider) args.push('--provider', selection.modelProvider);
    if (selection?.model) args.push('--model', selection.model);

    let lineBuffer = '';
    let finalMarkdown = '';
    let lastTextBlock = '';
    let detectedUserActionError = '';

    const captureFinalOutput = (text: string): boolean => {
      const candidate = stripPromptEcho(stripMarkdownFences(text));
      if (!looksLikeFinalJson(candidate)) return false;
      finalMarkdown = candidate;
      onEvent?.({
        app: 'pi',
        kind: 'final',
        text: 'Pi produced structured enhancement output.',
      });
      return true;
    };

    const handleJsonLine = (line: string): boolean => {
      if (!line.trim()) return false;
      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
        return false;
      }
      if (!event || typeof event !== 'object') return false;
      const record = event as Record<string, unknown>;
      const raw = JSON.stringify(record);
      debugLog('pi rpc stdout', record);
      const awsSsoError = detectAwsSsoError(raw);
      if (awsSsoError) {
        detectedUserActionError = awsSsoError;
        onEvent?.({ app: 'pi', kind: 'status', text: awsSsoError });
      }
      onEvent?.({
        app: 'pi',
        kind: 'raw',
        text: `Raw RPC: ${String(record.type ?? 'unknown')}`,
        raw,
      });

      emitRpcEventSummary(record, onEvent);

      if (record.type === 'agent_start') {
        onEvent?.({ app: 'pi', kind: 'status', text: 'Pi started processing.' });
        return false;
      }
      if (record.type === 'turn_start') {
        onEvent?.({ app: 'pi', kind: 'status', text: 'Pi started a reasoning turn.' });
        return false;
      }
      if (record.type === 'tool_execution_start') {
        onEvent?.({
          app: 'pi',
          kind: 'tool_call',
          text: formatToolExecutionStart(record),
        });
        return false;
      }
      if (record.type === 'tool_execution_end') {
        onEvent?.({
          app: 'pi',
          kind: 'tool_result',
          text: formatToolExecutionEnd(record),
        });
        return false;
      }
      if (record.type === 'message_update') {
        const delta = (record.assistantMessageEvent ?? {}) as Record<string, unknown>;
        const deltaType = String(delta.type ?? 'update');
        if (delta.type === 'text_delta' && typeof delta.delta === 'string') {
          lastTextBlock += delta.delta;
          onEvent?.({ app: 'pi', kind: 'message', text: delta.delta });
        } else if (delta.type === 'thinking_delta' && typeof delta.delta === 'string') {
          onEvent?.({ app: 'pi', kind: 'message', text: `Thinking: ${delta.delta}` });
        } else if (delta.type === 'toolcall_start') {
          onEvent?.({ app: 'pi', kind: 'tool_call', text: 'Pi is preparing a tool call.' });
        } else if (delta.type === 'toolcall_end') {
          onEvent?.({ app: 'pi', kind: 'tool_call', text: 'Pi requested a tool call.' });
        } else if (delta.type === 'done') {
          onEvent?.({
            app: 'pi',
            kind: 'status',
            text: `Assistant message done (${String(delta.reason ?? 'stop')}).`,
          });
        } else if (delta.type === 'error') {
          onEvent?.({
            app: 'pi',
            kind: 'status',
            text: `Assistant message error: ${String(delta.reason ?? 'error')}`,
          });
        } else {
          onEvent?.({ app: 'pi', kind: 'status', text: `Message update: ${deltaType}` });
        }
        if (delta.type === 'text_end' && typeof delta.content === 'string') {
          lastTextBlock = delta.content;
          if (captureFinalOutput(lastTextBlock)) return true;
        }
        if (delta.type === 'done' && captureFinalOutput(lastTextBlock)) return true;
        return false;
      }
      if (record.type === 'message_end') {
        if (isAssistantMessage(record.message)) {
          const text = extractText(record.message);
          if (text) {
            lastTextBlock = text;
            if (captureFinalOutput(lastTextBlock)) return true;
          }
        }
        return false;
      }
      if (record.type === 'turn_end') {
        const text = extractText(record.message) || extractAnyText(record);
        if (text) {
          lastTextBlock = text;
          onEvent?.({ app: 'pi', kind: 'status', text: `Pi turn produced ${text.length} chars.` });
        }
        return false;
      }
      if (record.type === 'agent_end') {
        const text =
          extractLastAssistantText(record.messages) || extractAnyText(record) || lastTextBlock;
        if (text) {
          finalMarkdown = stripPromptEcho(stripMarkdownFences(text));
          onEvent?.({
            app: 'pi',
            kind: 'final',
            text: 'Pi produced structured enhancement output.',
          });
        }
        return true;
      }
      return false;
    };

    let result = { stdout: '', stderr: '', exitCode: 0 };
    try {
      result = await this.processManager.spawnWithTimeout(
        'pi',
        args,
        `${JSON.stringify({ type: 'prompt', message: input })}\n`,
        timeoutMs,
        selection?.env,
        projectPath,
        {
          keepStdinOpen: true,
          resolveOnStdoutSignal: true,
          onStdout: (chunk) => {
            debugLog('pi stdout chunk', chunk);
            let shouldCloseStdin = false;
            lineBuffer += chunk;
            let newlineIndex = lineBuffer.indexOf('\n');
            while (newlineIndex !== -1) {
              const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, '');
              lineBuffer = lineBuffer.slice(newlineIndex + 1);
              shouldCloseStdin = handleJsonLine(line) || shouldCloseStdin;
              newlineIndex = lineBuffer.indexOf('\n');
            }
            return shouldCloseStdin;
          },
          onStderr: (chunk) => {
            debugLog('pi stderr chunk', chunk);
            const awsSsoError = detectAwsSsoError(chunk);
            if (awsSsoError) detectedUserActionError = awsSsoError;
          },
        },
      );
    } catch (err) {
      if (lineBuffer.trim()) handleJsonLine(lineBuffer);
      if (detectedUserActionError) {
        throw new BridgeError(ErrorCode.CONFIG_ERROR, detectedUserActionError);
      }
      const finalOutput = finalMarkdown || stripPromptEcho(lastTextBlock);
      if (finalOutput) {
        debugLog('pi process failed after final output; using captured final output', {
          error: err instanceof Error ? err.message : String(err),
        });
        return finalOutput;
      }
      throw err;
    }

    if (lineBuffer.trim()) handleJsonLine(lineBuffer);
    if (detectedUserActionError) {
      throw new BridgeError(ErrorCode.CONFIG_ERROR, detectedUserActionError);
    }
    const finalOutput =
      finalMarkdown || stripPromptEcho(stripRpcNoise(result.stdout) || lastTextBlock);
    if (!finalOutput) {
      throw new BridgeError(
        ErrorCode.LLM_PROCESS_ERROR,
        'Pi completed without returning structured JSON output. Check harness activity and raw IPC for details.',
      );
    }
    return finalOutput;
  }
}

function looksLikeFinalJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Boolean(
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      ('description' in parsed || 'subtasks' in parsed),
    );
  } catch {
    return false;
  }
}

function formatToolExecutionStart(record: Record<string, unknown>): string {
  const toolName = String(record.toolName ?? 'tool');
  const details = extractToolDetails(record);
  return `Using read-only tool: ${toolName}${details ? `\n${details}` : ''}`;
}

function formatToolExecutionEnd(record: Record<string, unknown>): string {
  const toolName = String(record.toolName ?? 'tool');
  const details = extractToolResultDetails(record);
  return `${toolName} completed${record.isError ? ' with an error' : ''}.${details ? `\n${details}` : ''}`;
}

function extractToolDetails(record: Record<string, unknown>): string {
  for (const key of ['args', 'arguments', 'input', 'params', 'parameters']) {
    const value = record[key];
    if (value === undefined) continue;
    return formatUnknownValue(value);
  }
  return '';
}

function extractToolResultDetails(record: Record<string, unknown>): string {
  for (const key of ['result', 'output', 'stdout', 'stderr', 'error']) {
    const value = record[key];
    if (value === undefined) continue;
    const formatted = formatUnknownValue(value);
    if (formatted) return formatted.slice(0, 1200);
  }
  return '';
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function detectAwsSsoError(text: string): string {
  if (!text.includes('Token is expired') && !text.includes('aws sso login')) return '';
  const profileMatch = text.match(/profile[=: ]+([A-Za-z0-9_.@-]+)/i);
  const profileHint = profileMatch?.[1] ? ` --profile ${profileMatch[1]}` : '';
  return `AWS SSO session expired. Run \`aws sso login${profileHint}\` in a terminal, then retry enhancement.`;
}

function emitRpcEventSummary(record: Record<string, unknown>, onEvent?: HarnessEventEmitter): void {
  const type = String(record.type ?? 'unknown');
  if (type === 'message_update') return;
  if (type === 'tool_execution_start' || type === 'tool_execution_end') return;

  if (type === 'response') {
    const command = String(record.command ?? 'command');
    const success = record.success === true ? 'accepted' : 'failed';
    onEvent?.({ app: 'pi', kind: 'status', text: `RPC ${command} ${success}.` });
    return;
  }

  if (type === 'message_start') {
    onEvent?.({
      app: 'pi',
      kind: 'status',
      text: isAssistantMessage(record.message)
        ? 'Pi started an assistant message.'
        : 'Pi recorded the user prompt.',
    });
    return;
  }

  if (type === 'message_end') {
    const text = extractText(record.message);
    const role = isAssistantMessage(record.message) ? 'assistant message' : 'user prompt';
    onEvent?.({
      app: 'pi',
      kind: 'status',
      text: text ? `Pi completed ${role} (${text.length} chars).` : `Pi completed ${role}.`,
    });
    return;
  }

  if (type === 'agent_end') {
    onEvent?.({ app: 'pi', kind: 'status', text: 'Pi agent run completed.' });
    return;
  }

  onEvent?.({ app: 'pi', kind: 'status', text: `Pi RPC event: ${type}` });
}

function isAssistantMessage(message: unknown): boolean {
  return Boolean(
    message && typeof message === 'object' && (message as { role?: unknown }).role === 'assistant',
  );
}

function extractText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(extractAnyText).join('');
}

function extractAnyText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'message', 'result', 'output', 'final', 'delta']) {
    const nested = record[key];
    if (typeof nested === 'string') return nested;
    if (Array.isArray(nested)) {
      const text = nested.map(extractAnyText).join('');
      if (text) return text;
    }
    if (nested && typeof nested === 'object') {
      const text = extractAnyText(nested);
      if (text) return text;
    }
  }
  return '';
}

function extractLastAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown };
    if (message?.role === 'assistant') {
      const text = extractText(message);
      if (text) return text;
    }
  }
  return '';
}

function stripMarkdownFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|markdown|md)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function stripPromptEcho(text: string): string {
  const marker = 'Final answer requirement: output valid JSON only.';
  const markerIndex = text.indexOf(marker);
  if (markerIndex !== -1) return text.slice(markerIndex + marker.length).trim();

  const sectionMatch = text.match(
    /(?:^|\n)(#{1,3}\s+Description|Description\s*:|Acceptance Criteria\s*:|Story Points\s*:)/i,
  );
  if (
    text.startsWith('You are enhancing Jira issue fields.') &&
    sectionMatch?.index !== undefined
  ) {
    return text.slice(sectionMatch.index).trim();
  }

  return text.trim();
}

function stripRpcNoise(stdout: string): string {
  return stdout
    .split('\n')
    .filter((line) => {
      try {
        JSON.parse(line);
        return false;
      } catch {
        return Boolean(line.trim());
      }
    })
    .join('\n')
    .trim();
}
