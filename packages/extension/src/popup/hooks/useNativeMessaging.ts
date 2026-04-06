import { useState, useEffect, useCallback, useRef } from 'react';
import type { ExtensionMessage } from '@jira-enhancer/shared';

interface UseNativeMessagingReturn {
  sendMessage: (msg: object) => void;
  lastResponse: ExtensionMessage | null;
  lastError: Error | null;
  isLoading: boolean;
}

export function useNativeMessaging(): UseNativeMessagingReturn {
  const [lastResponse, setLastResponse] = useState<ExtensionMessage | null>(null);
  const [lastError, setLastError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const listenerAttached = useRef(false);

  useEffect(() => {
    if (listenerAttached.current) return;
    listenerAttached.current = true;

    const handleMessage = (
      message: ExtensionMessage,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void,
    ) => {
      setLastResponse(message);
      setIsLoading(false);
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      listenerAttached.current = false;
    };
  }, []);

  const sendMessage = useCallback((msg: object) => {
    setIsLoading(true);
    setLastError(null);
    setLastResponse(null);

    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        setLastError(new Error(chrome.runtime.lastError.message));
        setIsLoading(false);
        return;
      }
      if (response) {
        setLastResponse(response as ExtensionMessage);
        setIsLoading(false);
      }
    });
  }, []);

  return { sendMessage, lastResponse, lastError, isLoading };
}
