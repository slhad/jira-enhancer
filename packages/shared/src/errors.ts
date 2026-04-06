export enum ErrorCode {
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  PROJECT_NOT_FOUND = 'PROJECT_NOT_FOUND',
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  LLM_PROCESS_ERROR = 'LLM_PROCESS_ERROR',
  CONFIG_ERROR = 'CONFIG_ERROR',
  ADF_TRANSFORM_ERROR = 'ADF_TRANSFORM_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class BridgeError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeError';
  }
}
