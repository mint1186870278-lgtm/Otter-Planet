import { useCallback, useEffect, useRef } from 'react';

export type TrackedTimeout = ReturnType<typeof setTimeout>;

export function useTrackedTimeouts() {
  const timeoutHandlesRef = useRef<Set<TrackedTimeout>>(new Set());

  const scheduleTimeout = useCallback((callback: () => void, delay: number) => {
    const timeout = setTimeout(() => {
      timeoutHandlesRef.current.delete(timeout);
      callback();
    }, delay);
    timeoutHandlesRef.current.add(timeout);
    return timeout;
  }, []);

  const clearTrackedTimeout = useCallback((timeout: TrackedTimeout | null | undefined) => {
    if (!timeout) return;
    clearTimeout(timeout);
    timeoutHandlesRef.current.delete(timeout);
  }, []);

  useEffect(() => () => {
    timeoutHandlesRef.current.forEach(timeout => clearTimeout(timeout));
    timeoutHandlesRef.current.clear();
  }, []);

  return { scheduleTimeout, clearTrackedTimeout };
}
