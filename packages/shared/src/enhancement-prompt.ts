import type {
  JiraEnhancementFields,
  LlmSelection,
  StructuredEnhancementResult,
} from './protocol.js';

export function buildEnhancementPrompt(
  fields: JiraEnhancementFields,
  customPrompt?: string,
  selection?: Pick<LlmSelection, 'modelProvider' | 'model' | 'safetyMode'>,
): string {
  const inputPayload = JSON.stringify(fields, null, 2);
  const outputSchema = Object.fromEntries(
    Object.keys(fields).map((key) => [
      key,
      key === 'storyPoints' ? 'string' : 'enhanced Markdown string',
    ]),
  );
  let input = `You are enhancing Jira issue fields using repository context.

Rules:
- You may inspect available project or Jira/Confluence context, but only for reading.
- Do not modify files, run write operations, update Jira/Confluence, create comments, transition issues, or apply changes.
- Enhance each input field independently and preserve its intent.
- Only return keys that are present in the input JSON.
- Description and acceptanceCriteria values may contain Markdown when present.
- storyPoints must remain a short string when present; change it only if the input is clearly wrong or missing and repository context strongly supports a better value.
- Return ONLY valid JSON. Do not wrap it in Markdown fences. Do not include prose outside JSON.

Input JSON:
${inputPayload}

Output JSON schema:
${JSON.stringify({ ...outputSchema, notes: 'optional short explanation of meaningful changes' }, null, 2)}`;

  input += `\n\nHarness safety mode: ${selection?.safetyMode === 'trust-ai' ? 'Trust AI' : 'Read-only'}. ${
    selection?.safetyMode === 'trust-ai'
      ? 'The runtime may expose broader tools, but you are still explicitly instructed to read only and never mutate files, Jira, Confluence, comments, issue states, or external systems.'
      : 'The runtime should restrict tools to read-only inspection. Treat any available write-capable operation as forbidden.'
  }`;

  if (selection?.modelProvider || selection?.model) {
    input += `\n\nLLM selection: ${[
      selection.modelProvider ? `provider=${selection.modelProvider}` : undefined,
      selection.model ? `model=${selection.model}` : undefined,
    ]
      .filter(Boolean)
      .join(', ')}`;
  }

  if (customPrompt) {
    input += `\n\nAdditional user instructions:\n${customPrompt}`;
  }

  input += '\n\nFinal answer requirement: output valid JSON only.';
  return input;
}

export function buildSubtaskGenerationPrompt(
  issueKey: string,
  fields: JiraEnhancementFields,
  enhancedFields?: StructuredEnhancementResult,
  customPrompt?: string,
  selection?: Pick<
    LlmSelection,
    'modelProvider' | 'model' | 'safetyMode' | 'reuseSession' | 'sessionRef' | 'subtaskTitleOnly'
  >,
): string {
  const inputPayload = JSON.stringify(
    {
      issueKey,
      originalFields: fields,
      ...(enhancedFields ? { enhancedFields } : {}),
      sessionReuse: Boolean(selection?.reuseSession && selection.sessionRef),
    },
    null,
    2,
  );

  let input = `You are generating editable Jira sub-task definitions for a parent issue.

Rules:
- You may inspect available project or Jira/Confluence context, but only for reading.
- Do not modify files, run write operations, update Jira/Confluence, create comments, transition issues, or create Jira issues.
- Propose a practical default set of sub-tasks and implementation-specific sub-tasks inferred from the issue.
- Include these default categories when applicable: Pull Request, Copilot Quality, QA Tests, Dev Tests, Unit Tests if needed, Documentation if needed, Release Procedure if needed.
- Add one implementation sub-task for each important point or step needed to complete the Jira issue.
- Keep titles concise and actionable. Descriptions must be developer-ready Markdown unless title-only mode is enabled.
- Mark optional/conditional work with required=false and explain the rationale.
- Return ONLY valid JSON. Do not wrap it in Markdown fences. Do not include prose outside JSON.

Input JSON:
${inputPayload}

Output JSON schema:
${JSON.stringify(
  {
    subtasks: [
      {
        id: 'stable short slug string',
        title: 'concise sub-task summary',
        description: selection?.subtaskTitleOnly
          ? 'empty string; title-only mode is enabled'
          : 'developer-ready Markdown description',
        category:
          'implementation | pullRequest | copilotQuality | qaTests | devTests | unitTests | documentation | releaseProcedure | other',
        required: true,
        rationale: 'optional short reason, especially when required=false',
        acceptanceCriteria: ['optional testable criteria strings'],
      },
    ],
    notes: 'optional short explanation of generation choices',
  },
  null,
  2,
)}`;

  if (selection?.subtaskTitleOnly) {
    input +=
      '\n\nTitle-only mode: generate useful Jira sub-task titles only. Set every description to an empty string, omit acceptanceCriteria unless absolutely necessary, and put all essential meaning in the title.';
  }

  input += `\n\nHarness safety mode: ${selection?.safetyMode === 'trust-ai' ? 'Trust AI' : 'Read-only'}. ${
    selection?.safetyMode === 'trust-ai'
      ? 'The runtime may expose broader tools, but you are still explicitly instructed to read only and never mutate files, Jira, Confluence, comments, issue states, or external systems.'
      : 'The runtime should restrict tools to read-only inspection. Treat any available write-capable operation as forbidden.'
  }`;

  if (selection?.reuseSession && selection.sessionRef) {
    input += `\n\nContinue using the intentionally reused harness session for ${selection.sessionRef.issueKey}. Reuse relevant context already gathered in that session.`;
  }

  if (selection?.modelProvider || selection?.model) {
    input += `\n\nLLM selection: ${[
      selection.modelProvider ? `provider=${selection.modelProvider}` : undefined,
      selection.model ? `model=${selection.model}` : undefined,
    ]
      .filter(Boolean)
      .join(', ')}`;
  }

  if (customPrompt) {
    input += `\n\nAdditional user instructions:\n${customPrompt}`;
  }

  input += '\n\nFinal answer requirement: output valid JSON only.';
  return input;
}
