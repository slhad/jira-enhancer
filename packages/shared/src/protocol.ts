export enum MessageType {
  ENHANCE_REQUEST = 'ENHANCE_REQUEST',
  ENHANCE_RESPONSE = 'ENHANCE_RESPONSE',
  ERROR = 'ERROR',
  STATUS = 'STATUS',
  CANCEL = 'CANCEL',
}

export type EnhanceMode = 'default' | 'custom';

export type LlmProvider = 'opencode' | 'pi';

export interface EnhanceRequest {
  type: MessageType.ENHANCE_REQUEST;
  id: string;
  issueKey: string;
  /** Markdown description */
  description: string;
  mode: EnhanceMode;
  customPrompt?: string;
  provider: LlmProvider;
}

export interface EnhanceResponse {
  type: MessageType.ENHANCE_RESPONSE;
  id: string;
  /** Refined markdown description */
  refinedDescription: string;
  originalDescription: string;
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

/** Messages sent from extension to bridge */
export type BridgeMessage = EnhanceRequest | CancelRequest;

/** Messages sent from bridge to extension */
export type ExtensionMessage = EnhanceResponse | ErrorResponse | StatusUpdate;
