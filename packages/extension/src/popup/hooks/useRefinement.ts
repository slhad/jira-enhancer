import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageType,
  type EnhanceMode,
  type LlmApp,
  type HarnessSafetyMode,
  type EnhanceRequest,
  type EnhanceResponse,
  type ErrorResponse,
  type StatusUpdate,
  type CancelRequest,
  type EnhancementStateResponse,
  type HarnessEvent,
  type JiraEnhancementFields,
  type StructuredEnhancementResult,
  type HarnessSessionRef,
} from '@jira-enhancer/shared';
import { useNativeMessaging } from './useNativeMessaging';

type RefinementStatus = 'idle' | 'processing' | 'exploring' | 'refining' | 'complete' | 'error';

function isRestorableState(status: RefinementStatus | undefined): boolean {
  return status === 'processing' || status === 'exploring' || status === 'refining';
}

interface UseRefinementReturn {
  enhance: (
    issueKey: string,
    fields: JiraEnhancementFields,
    mode: EnhanceMode,
    app: LlmApp,
    modelProvider?: string,
    model?: string,
    launchPath?: string,
    customPrompt?: string,
    env?: Record<string, string>,
    safetyMode?: HarnessSafetyMode,
  ) => void;
  cancel: () => void;
  restore: (issueKey: string) => void;
  loadCompletedResult: (result: {
    originalDescription: string;
    refinedDescription: string;
    originalFields: JiraEnhancementFields;
    enhancedFields: StructuredEnhancementResult;
    sessionRef?: HarnessSessionRef;
  }) => void;
  status: RefinementStatus;
  originalDescription: string;
  refinedDescription: string;
  originalFields: JiraEnhancementFields | null;
  enhancedFields: StructuredEnhancementResult | null;
  sessionRef: HarnessSessionRef | null;
  error: string | null;
  isProcessing: boolean;
  progress: number | undefined;
  harnessEvents: HarnessEvent[];
}

export function useRefinement(): UseRefinementReturn {
  const { sendMessage, lastResponse, lastError } = useNativeMessaging();
  const [status, setStatus] = useState<RefinementStatus>('idle');
  const [originalDescription, setOriginalDescription] = useState('');
  const [refinedDescription, setRefinedDescription] = useState('');
  const [originalFields, setOriginalFields] = useState<JiraEnhancementFields | null>(null);
  const [enhancedFields, setEnhancedFields] = useState<StructuredEnhancementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [harnessEvents, setHarnessEvents] = useState<HarnessEvent[]>([]);
  const [sessionRef, setSessionRef] = useState<HarnessSessionRef | null>(null);
  const currentRequestId = useRef<string | null>(null);
  const statusRef = useRef<RefinementStatus>('idle');

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (lastError) {
      const transientChannelError =
        /message port closed|message channel closed|receiving end does not exist/i.test(
          lastError.message,
        );
      if (statusRef.current !== 'complete' && !transientChannelError) {
        setStatus('error');
        setError(lastError.message);
      }
      return;
    }

    if (!lastResponse) return;

    const msg = lastResponse;

    if (msg.type === MessageType.ENHANCEMENT_STATE) {
      const state = msg as EnhancementStateResponse;
      if (!isRestorableState(state.status)) return;
      currentRequestId.current = state.requestId ?? null;
      setStatus(state.status);
      setProgress(state.progress);
      setError(state.error ?? null);
      if (state.originalDescription !== undefined)
        setOriginalDescription(state.originalDescription);
      if (state.refinedDescription !== undefined) setRefinedDescription(state.refinedDescription);
      if (state.originalFields !== undefined) setOriginalFields(state.originalFields);
      if (state.enhancedFields !== undefined) setEnhancedFields(state.enhancedFields);
      setSessionRef(state.sessionRef ?? null);
      setHarnessEvents(state.events ?? []);
      return;
    }

    if ('id' in msg && msg.id !== currentRequestId.current) return;

    if (msg.type === MessageType.HARNESS_EVENT) {
      setHarnessEvents((events) => [...events, msg as HarnessEvent]);
      return;
    }

    switch (msg.type) {
      case MessageType.ENHANCE_RESPONSE: {
        const res = msg as EnhanceResponse;
        currentRequestId.current = null;
        setError(null);
        setRefinedDescription(res.refinedDescription);
        setOriginalDescription(res.originalDescription);
        setOriginalFields(res.originalFields ?? null);
        setEnhancedFields(res.enhancedFields ?? null);
        setSessionRef(res.sessionRef ?? null);
        setStatus('complete');
        setProgress(undefined);
        break;
      }
      case MessageType.ERROR: {
        if (statusRef.current === 'complete') break;
        const err = msg as ErrorResponse;
        setError(err.message);
        setStatus('error');
        setProgress(undefined);
        break;
      }
      case MessageType.STATUS: {
        const update = msg as StatusUpdate;
        setError(null);
        setStatus(update.status === 'complete' ? 'complete' : update.status);
        setProgress(update.progress);
        break;
      }
    }
  }, [lastResponse, lastError]);

  const enhance = useCallback(
    (
      issueKey: string,
      fields: JiraEnhancementFields,
      mode: EnhanceMode,
      app: LlmApp,
      modelProvider?: string,
      model?: string,
      launchPath?: string,
      customPrompt?: string,
      env?: Record<string, string>,
      safetyMode?: HarnessSafetyMode,
    ) => {
      const id = crypto.randomUUID();
      currentRequestId.current = id;

      setStatus('processing');
      setError(null);
      setRefinedDescription('');
      setOriginalDescription(fields.description);
      setOriginalFields(fields);
      setEnhancedFields(null);
      setSessionRef(null);
      setProgress(undefined);
      setHarnessEvents([]);

      const request: EnhanceRequest = {
        type: MessageType.ENHANCE_REQUEST,
        id,
        issueKey,
        description: fields.description,
        fields,
        mode,
        app,
        provider: app,
        ...(modelProvider ? { modelProvider } : {}),
        ...(model ? { model } : {}),
        ...(launchPath ? { launchPath } : {}),
        ...(customPrompt ? { customPrompt } : {}),
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
        ...(safetyMode ? { safetyMode } : {}),
      };

      sendMessage(request);
    },
    [sendMessage],
  );

  const restore = useCallback((issueKey: string) => {
    chrome.runtime.sendMessage(
      { type: MessageType.GET_ENHANCEMENT_STATE, issueKey },
      (response?: EnhancementStateResponse) => {
        if (chrome.runtime.lastError || !response) return;
        if (response.type !== MessageType.ENHANCEMENT_STATE) return;
        if (!isRestorableState(response.status)) return;
        currentRequestId.current = response.requestId ?? null;
        setStatus(response.status);
        setProgress(response.progress);
        setError(response.error ?? null);
        if (response.originalDescription !== undefined)
          setOriginalDescription(response.originalDescription);
        if (response.refinedDescription !== undefined)
          setRefinedDescription(response.refinedDescription);
        if (response.originalFields !== undefined) setOriginalFields(response.originalFields);
        if (response.enhancedFields !== undefined) setEnhancedFields(response.enhancedFields);
        setSessionRef(response.sessionRef ?? null);
        setHarnessEvents(response.events ?? []);
      },
    );
  }, []);

  const loadCompletedResult = useCallback(
    (result: {
      originalDescription: string;
      refinedDescription: string;
      originalFields: JiraEnhancementFields;
      enhancedFields: StructuredEnhancementResult;
    }) => {
      currentRequestId.current = null;
      setError(null);
      setOriginalDescription(result.originalDescription);
      setRefinedDescription(result.refinedDescription);
      setOriginalFields(result.originalFields);
      setEnhancedFields(result.enhancedFields);
      setSessionRef(result.sessionRef ?? null);
      setStatus('complete');
      setProgress(undefined);
      setHarnessEvents([]);
    },
    [],
  );

  const cancel = useCallback(() => {
    if (!currentRequestId.current) return;

    const cancelMsg: CancelRequest = {
      type: MessageType.CANCEL,
      id: currentRequestId.current,
    };

    sendMessage(cancelMsg);
    setStatus('idle');
    setProgress(undefined);
    currentRequestId.current = null;
  }, [sendMessage]);

  const isProcessing = status === 'processing' || status === 'exploring' || status === 'refining';

  return {
    enhance,
    cancel,
    restore,
    loadCompletedResult,
    status,
    originalDescription,
    refinedDescription,
    originalFields,
    enhancedFields,
    sessionRef,
    error,
    isProcessing,
    progress,
    harnessEvents,
  };
}
