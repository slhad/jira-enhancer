import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageType } from '@jira-enhancer/shared';
import type {
  EnhanceMode,
  ErrorResponse,
  GenerateSubtasksRequest,
  GenerateSubtasksResponse,
  HarnessEvent,
  HarnessSafetyMode,
  HarnessSessionRef,
  JiraEnhancementFields,
  LlmApp,
  StatusUpdate,
  StructuredEnhancementResult,
  SubtaskGenerationResult,
} from '@jira-enhancer/shared';
import { useNativeMessaging } from './useNativeMessaging';

type SubtaskGenerationStatus =
  | 'idle'
  | 'processing'
  | 'exploring'
  | 'refining'
  | 'complete'
  | 'error';

interface UseSubtaskGenerationReturn {
  generate: (
    issueKey: string,
    fields: JiraEnhancementFields,
    enhancedFields: StructuredEnhancementResult | undefined,
    mode: EnhanceMode,
    app: LlmApp,
    modelProvider?: string,
    model?: string,
    launchPath?: string,
    customPrompt?: string,
    env?: Record<string, string>,
    safetyMode?: HarnessSafetyMode,
    sessionRef?: HarnessSessionRef,
    reuseSession?: boolean,
    titleOnly?: boolean,
    availableSubtaskCategories?: string[],
    titleMaxLength?: number,
  ) => void;
  loadCompletedResult: (result: SubtaskGenerationResult, sessionRef?: HarnessSessionRef) => void;
  status: SubtaskGenerationStatus;
  result: SubtaskGenerationResult | null;
  sessionRef: HarnessSessionRef | null;
  error: string | null;
  isProcessing: boolean;
  progress: number | undefined;
  harnessEvents: HarnessEvent[];
}

export function useSubtaskGeneration(): UseSubtaskGenerationReturn {
  const { sendMessage, lastResponse, lastError } = useNativeMessaging();
  const [status, setStatus] = useState<SubtaskGenerationStatus>('idle');
  const [result, setResult] = useState<SubtaskGenerationResult | null>(null);
  const [sessionRef, setSessionRef] = useState<HarnessSessionRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [harnessEvents, setHarnessEvents] = useState<HarnessEvent[]>([]);
  const currentRequestId = useRef<string | null>(null);

  useEffect(() => {
    if (lastError) {
      setStatus('error');
      setError(lastError.message);
      return;
    }
    if (!lastResponse) return;
    const msg = lastResponse;
    if ('id' in msg && msg.id !== currentRequestId.current) return;

    if (msg.type === MessageType.HARNESS_EVENT) {
      setHarnessEvents((events) => [...events, msg as HarnessEvent]);
      return;
    }

    switch (msg.type) {
      case MessageType.GENERATE_SUBTASKS_RESPONSE: {
        const res = msg as GenerateSubtasksResponse;
        currentRequestId.current = null;
        setResult(res.result);
        setSessionRef(res.sessionRef ?? null);
        setStatus('complete');
        setProgress(undefined);
        setError(null);
        break;
      }
      case MessageType.ERROR: {
        const err = msg as ErrorResponse;
        setError(err.message);
        setStatus('error');
        setProgress(undefined);
        break;
      }
      case MessageType.STATUS: {
        const update = msg as StatusUpdate;
        setStatus(update.status === 'complete' ? 'complete' : update.status);
        setProgress(update.progress);
        setError(null);
        break;
      }
    }
  }, [lastResponse, lastError]);

  const generate = useCallback(
    (
      issueKey: string,
      fields: JiraEnhancementFields,
      enhancedFields: StructuredEnhancementResult | undefined,
      mode: EnhanceMode,
      app: LlmApp,
      modelProvider?: string,
      model?: string,
      launchPath?: string,
      customPrompt?: string,
      env?: Record<string, string>,
      safetyMode?: HarnessSafetyMode,
      reusableSessionRef?: HarnessSessionRef,
      reuseSession?: boolean,
      titleOnly?: boolean,
      availableSubtaskCategories?: string[],
      titleMaxLength?: number,
    ) => {
      const id = crypto.randomUUID();
      currentRequestId.current = id;
      setStatus('processing');
      setResult(null);
      setSessionRef(null);
      setError(null);
      setProgress(undefined);
      setHarnessEvents([]);

      const request: GenerateSubtasksRequest = {
        type: MessageType.GENERATE_SUBTASKS_REQUEST,
        id,
        issueKey,
        fields,
        ...(enhancedFields ? { enhancedFields } : {}),
        mode,
        app,
        provider: app,
        ...(modelProvider ? { modelProvider } : {}),
        ...(model ? { model } : {}),
        ...(launchPath ? { launchPath } : {}),
        ...(customPrompt ? { customPrompt } : {}),
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
        ...(safetyMode ? { safetyMode } : {}),
        ...(reuseSession && reusableSessionRef
          ? { reuseSession: true, sessionRef: reusableSessionRef }
          : {}),
        ...(titleOnly ? { titleOnly: true } : {}),
        ...(availableSubtaskCategories && availableSubtaskCategories.length > 0
          ? { availableSubtaskCategories }
          : {}),
        ...(titleMaxLength && titleMaxLength > 0 ? { subtaskTitleMaxLength: titleMaxLength } : {}),
      };
      sendMessage(request);
    },
    [sendMessage],
  );

  const loadCompletedResult = useCallback(
    (completedResult: SubtaskGenerationResult, completedSessionRef?: HarnessSessionRef) => {
      currentRequestId.current = null;
      setResult(completedResult);
      setSessionRef(completedSessionRef ?? null);
      setStatus('complete');
      setProgress(undefined);
      setError(null);
      setHarnessEvents([]);
    },
    [],
  );

  return {
    generate,
    loadCompletedResult,
    status,
    result,
    sessionRef,
    error,
    isProcessing: status === 'processing' || status === 'exploring' || status === 'refining',
    progress,
    harnessEvents,
  };
}
