import {
  BridgeError,
  ErrorCode,
  type GeneratedSubtask,
  type GeneratedSubtaskCategory,
  type StructuredEnhancementResult,
  type SubtaskGenerationResult,
} from '@jira-enhancer/shared';

export function parseStructuredEnhancementOutput(output: string): StructuredEnhancementResult {
  const jsonText = extractJson(output);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new BridgeError(
      ErrorCode.LLM_PROCESS_ERROR,
      `Harness returned invalid JSON output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BridgeError(ErrorCode.LLM_PROCESS_ERROR, 'Harness JSON output must be an object.');
  }

  const value = parsed as Record<string, unknown>;
  return {
    description: stringField(value.description),
    acceptanceCriteria: stringField(value.acceptanceCriteria),
    storyPoints: stringField(value.storyPoints),
    ...(typeof value.notes === 'string' && value.notes.trim() ? { notes: value.notes.trim() } : {}),
  };
}

export function parseSubtaskGenerationOutput(
  issueKey: string,
  output: string,
  titleOnly = false,
): SubtaskGenerationResult {
  const jsonText = extractJson(output, 'subtasks');
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new BridgeError(
      ErrorCode.LLM_PROCESS_ERROR,
      `Harness returned invalid subtask JSON output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BridgeError(
      ErrorCode.LLM_PROCESS_ERROR,
      'Harness subtask JSON output must be an object.',
    );
  }

  const value = parsed as Record<string, unknown>;
  if (!Array.isArray(value.subtasks)) {
    throw new BridgeError(
      ErrorCode.LLM_PROCESS_ERROR,
      'Harness subtask JSON output must include a subtasks array.',
    );
  }

  const subtasks = value.subtasks.flatMap((entry, index): GeneratedSubtask[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const title = stringField(record.title);
    const description = stringField(record.description);
    if (!title || (!titleOnly && !description)) return [];
    const category = stringField(record.category) as GeneratedSubtaskCategory;
    const acceptanceCriteria = Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria.map(stringField).filter(Boolean)
      : undefined;
    return [
      {
        id: stringField(record.id) || slugify(title) || `subtask-${index + 1}`,
        title,
        description,
        category: category || 'other',
        required: typeof record.required === 'boolean' ? record.required : true,
        ...(stringField(record.rationale) ? { rationale: stringField(record.rationale) } : {}),
        ...(acceptanceCriteria && acceptanceCriteria.length > 0 ? { acceptanceCriteria } : {}),
      },
    ];
  });

  if (subtasks.length === 0) {
    throw new BridgeError(
      ErrorCode.LLM_PROCESS_ERROR,
      'Harness subtask JSON output did not contain any valid subtasks.',
    );
  }

  return {
    issueKey,
    subtasks,
    ...(typeof value.notes === 'string' && value.notes.trim() ? { notes: value.notes.trim() } : {}),
  };
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function extractJson(output: string, requiredKey = 'description'): string {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  if (looksLikeStructuredJson(trimmed, requiredKey)) return trimmed;

  const candidates = findJsonObjectCandidates(trimmed);
  const structuredCandidate = candidates.find((candidate) =>
    looksLikeStructuredJson(candidate, requiredKey),
  );
  if (structuredCandidate) return structuredCandidate;

  return candidates[0] ?? trimmed;
}

function looksLikeStructuredJson(text: string, requiredKey: string): boolean {
  try {
    const value = JSON.parse(text) as unknown;
    return Boolean(
      value && typeof value === 'object' && !Array.isArray(value) && requiredKey in value,
    );
  } catch {
    return false;
  }
}

function findJsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue;
    const end = findMatchingBrace(text, start);
    if (end !== -1) candidates.push(text.slice(start, end + 1));
  }
  return candidates;
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}
