import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageType,
  type EnhanceMode,
  type LlmProvider,
  type EnhanceRequest,
  type EnhanceResponse,
  type ErrorResponse,
  type StatusUpdate,
  type CancelRequest,
} from '@jira-enhancer/shared';
import { useNativeMessaging } from './useNativeMessaging';

type RefinementStatus = 'idle' | 'processing' | 'exploring' | 'refining' | 'complete' | 'error';

interface UseRefinementReturn {
  enhance: (
    issueKey: string,
    description: string,
    mode: EnhanceMode,
    provider: LlmProvider,
    customPrompt?: string,
  ) => void;
  cancel: () => void;
  status: RefinementStatus;
  originalDescription: string;
  refinedDescription: string;
  error: string | null;
  isProcessing: boolean;
  progress: number | undefined;
}

export function useRefinement(): UseRefinementReturn {
  const { sendMessage, lastResponse, lastError } = useNativeMessaging();
  const [status, setStatus] = useState<RefinementStatus>('idle');
  const [originalDescription, setOriginalDescription] = useState('');
  const [refinedDescription, setRefinedDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | undefined>(undefined);
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

    switch (msg.type) {
      case MessageType.ENHANCE_RESPONSE: {
        const res = msg as EnhanceResponse;
        setRefinedDescription(res.refinedDescription);
        setOriginalDescription(res.originalDescription);
        setStatus('complete');
        setProgress(undefined);
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
        break;
      }
    }
  }, [lastResponse, lastError]);

  const enhance = useCallback(
    (
      issueKey: string,
      description: string,
      mode: EnhanceMode,
      provider: LlmProvider,
      customPrompt?: string,
    ) => {
      const id = crypto.randomUUID();
      currentRequestId.current = id;

      setStatus('processing');
      setError(null);
      setRefinedDescription('');
      setOriginalDescription(description);
      setProgress(undefined);

      const request: EnhanceRequest = {
        type: MessageType.ENHANCE_REQUEST,
        id,
        issueKey,
        description,
        mode,
        provider,
        ...(customPrompt ? { customPrompt } : {}),
      };

      sendMessage(request);
    },
    [sendMessage],
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
    status,
    originalDescription,
    refinedDescription,
    error,
    isProcessing,
    progress,
  };
}
