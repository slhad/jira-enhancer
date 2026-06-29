export enum MessageType {
  ENHANCE_REQUEST = 'ENHANCE_REQUEST',
  ENHANCE_RESPONSE = 'ENHANCE_RESPONSE',
  GENERATE_SUBTASKS_REQUEST = 'GENERATE_SUBTASKS_REQUEST',
  GENERATE_SUBTASKS_RESPONSE = 'GENERATE_SUBTASKS_RESPONSE',
  ERROR = 'ERROR',
  STATUS = 'STATUS',
  CANCEL = 'CANCEL',
  LIST_MODELS_REQUEST = 'LIST_MODELS_REQUEST',
  LIST_MODELS_RESPONSE = 'LIST_MODELS_RESPONSE',
  SAVE_IMAGES_REQUEST = 'SAVE_IMAGES_REQUEST',
  SAVE_IMAGES_RESPONSE = 'SAVE_IMAGES_RESPONSE',
  GET_ENHANCEMENT_STATE = 'GET_ENHANCEMENT_STATE',
  ENHANCEMENT_STATE = 'ENHANCEMENT_STATE',
  HARNESS_EVENT = 'HARNESS_EVENT',
  DEBUG_LOG_REQUEST = 'DEBUG_LOG_REQUEST',
  DEBUG_LOG_RESPONSE = 'DEBUG_LOG_RESPONSE',
}

export type EnhanceMode = 'default' | 'custom';

export type LlmApp = 'opencode' | 'pi';

export type HarnessSafetyMode = 'read-only' | 'trust-ai';

/** @deprecated Use LlmApp for the CLI app/runtime selector. */
export type LlmProvider = LlmApp;

export type EnhancementFieldKey = 'description' | 'acceptanceCriteria' | 'storyPoints';

export interface JiraEnhancementFields {
  description: string;
  acceptanceCriteria?: string;
  storyPoints?: string;
}

export interface StructuredEnhancementResult extends JiraEnhancementFields {
  notes?: string;
}

export interface HarnessSessionRef {
  id: string;
  app: LlmApp;
  issueKey: string;
  source: 'enhancement' | 'subtasks';
  createdAt: number;
  provider?: string;
  model?: string;
  launchPath?: string;
  safetyMode?: HarnessSafetyMode;
}

export type GeneratedSubtaskCategory =
  | 'implementation'
  | 'pullRequest'
  | 'copilotQuality'
  | 'qaTests'
  | 'devTests'
  | 'unitTests'
  | 'documentation'
  | 'releaseProcedure'
  | 'other';

export interface GeneratedSubtask {
  id: string;
  title: string;
  description: string;
  category: GeneratedSubtaskCategory;
  required: boolean;
  rationale?: string;
  acceptanceCriteria?: string[];
}

export interface SubtaskGenerationResult {
  issueKey: string;
  subtasks: GeneratedSubtask[];
  notes?: string;
}

export interface LlmSelection {
  /** CLI app/runtime used by the bridge. Defaults to provider for backward compatibility. */
  app?: LlmApp;
  /** Model provider inside the selected app, for example anthropic, openai, or google. */
  modelProvider?: string;
  /** Model name/id passed to the selected app when supported. */
  model?: string;
  /** Optional local directory where the harness should be launched. */
  launchPath?: string;
  /** Optional environment overrides for harness processes, for example AWS_PROFILE/AWS_REGION. */
  env?: Record<string, string>;
  /** Tool policy for harness execution. Defaults to read-only. */
  safetyMode?: HarnessSafetyMode;
  /** Existing or newly reserved harness session for same-issue continuation. */
  sessionRef?: HarnessSessionRef;
  /** When true, adapters should continue sessionRef instead of starting from a blank context. */
  reuseSession?: boolean;
  /** When true for sub-task generation, only titles are needed; descriptions may be blank. */
  subtaskTitleOnly?: boolean;
}

export interface EnhanceRequest extends LlmSelection {
  type: MessageType.ENHANCE_REQUEST;
  id: string;
  issueKey: string;
  /** Legacy combined Markdown description. Prefer fields for new callers. */
  description: string;
  /** Structured Jira fields to enhance. */
  fields?: JiraEnhancementFields;
  mode: EnhanceMode;
  customPrompt?: string;
  /** Backward-compatible app/runtime selector. Prefer app for new callers. */
  provider: LlmProvider;
}

export interface GenerateSubtasksRequest extends LlmSelection {
  type: MessageType.GENERATE_SUBTASKS_REQUEST;
  id: string;
  issueKey: string;
  fields: JiraEnhancementFields;
  enhancedFields?: StructuredEnhancementResult;
  mode: EnhanceMode;
  customPrompt?: string;
  /** When true, generated sub-tasks should only include titles; descriptions may be blank. */
  titleOnly?: boolean;
  provider: LlmProvider;
}

export interface EnhanceResponse {
  type: MessageType.ENHANCE_RESPONSE;
  id: string;
  /** Legacy refined markdown description, mirrors enhancedFields.description. */
  refinedDescription: string;
  /** Legacy original markdown description, mirrors originalFields.description or request description. */
  originalDescription: string;
  originalFields?: JiraEnhancementFields;
  enhancedFields?: StructuredEnhancementResult;
  sessionRef?: HarnessSessionRef;
  reusedSession?: boolean;
}

export interface GenerateSubtasksResponse {
  type: MessageType.GENERATE_SUBTASKS_RESPONSE;
  id: string;
  result: SubtaskGenerationResult;
  sessionRef?: HarnessSessionRef;
  reusedSession?: boolean;
}

export interface ErrorResponse {
  type: MessageType.ERROR;
  id: string;
  code: string;
  message: string;
}

export interface StatusUpdate {
  type: MessageType.STATUS;
  id: string;
  status: 'processing' | 'exploring' | 'refining' | 'complete';
  progress?: number;
}

export interface CancelRequest {
  type: MessageType.CANCEL;
  id: string;
}

export interface ModelInfo {
  provider: string;
  model: string;
  context?: string;
  maxOut?: string;
  thinking?: boolean;
  images?: boolean;
}

export interface ListModelsRequest {
  type: MessageType.LIST_MODELS_REQUEST;
  id: string;
  app: LlmApp;
  /** Optional environment overrides for model discovery. */
  env?: Record<string, string>;
}

export interface ListModelsResponse {
  type: MessageType.LIST_MODELS_RESPONSE;
  id: string;
  app: LlmApp;
  models: ModelInfo[];
}

export interface ImageAttachment {
  originalUrl: string;
  alt?: string;
  mimeType: string;
  base64: string;
}

export interface SavedImage {
  originalUrl: string;
  tmpPath: string;
}

export interface SaveImagesRequest {
  type: MessageType.SAVE_IMAGES_REQUEST;
  id: string;
  images: ImageAttachment[];
}

export interface SaveImagesResponse {
  type: MessageType.SAVE_IMAGES_RESPONSE;
  id: string;
  images: SavedImage[];
}

export interface GetEnhancementStateRequest {
  type: MessageType.GET_ENHANCEMENT_STATE;
  issueKey?: string;
}

export interface DebugLogRequest {
  type: MessageType.DEBUG_LOG_REQUEST;
  id: string;
  source: string;
  payload: unknown;
}

export interface DebugLogResponse {
  type: MessageType.DEBUG_LOG_RESPONSE;
  id: string;
  ok: boolean;
  path: string;
}

export interface HarnessEvent {
  type: MessageType.HARNESS_EVENT;
  id: string;
  app: LlmApp;
  kind: 'status' | 'message' | 'tool_call' | 'tool_result' | 'final' | 'raw';
  text: string;
  timestamp: number;
  raw?: string;
  sessionRef?: HarnessSessionRef;
}

export interface EnhancementStateResponse {
  type: MessageType.ENHANCEMENT_STATE;
  issueKey?: string;
  requestId?: string;
  status?: 'idle' | 'processing' | 'exploring' | 'refining' | 'complete' | 'error';
  progress?: number;
  originalDescription?: string;
  refinedDescription?: string;
  originalFields?: JiraEnhancementFields;
  enhancedFields?: StructuredEnhancementResult;
  error?: string;
  events?: HarnessEvent[];
  sessionRef?: HarnessSessionRef;
}

/** Messages sent from extension to bridge */
export type BridgeMessage =
  | EnhanceRequest
  | GenerateSubtasksRequest
  | CancelRequest
  | ListModelsRequest
  | SaveImagesRequest
  | DebugLogRequest;

/** Messages sent from bridge/background to extension */
export type ExtensionMessage =
  | EnhanceResponse
  | GenerateSubtasksResponse
  | ErrorResponse
  | StatusUpdate
  | ListModelsResponse
  | SaveImagesResponse
  | DebugLogResponse
  | EnhancementStateResponse
  | HarnessEvent;
