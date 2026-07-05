import { useEffect, useState } from 'react';
import type { TrackedTimeout } from './useTrackedTimeouts';

export function useParkourRouteReady({
  clearTrackedTimeout,
  scheduleTimeout,
}: {
  clearTrackedTimeout: (timeout: TrackedTimeout | null | undefined) => void;
  scheduleTimeout: (callback: () => void, delay: number) => TrackedTimeout;
}) {
  const [routeSceneReady, setRouteSceneReady] = useState(false);

  useEffect(() => {
    const startAt = Date.now();
    let timer: TrackedTimeout | null = null;
    const poll = () => {
      const hasCanvas = !!document.querySelector('canvas');
      const hasTutorial = !!document.querySelector('[data-tutorial-direction]');
      if ((hasCanvas && hasTutorial) || Date.now() - startAt > 20000) {
        timer = scheduleTimeout(() => {
          setRouteSceneReady(true);
          (window as { otterParkourLoading?: { markSceneReady?: () => void } }).otterParkourLoading?.markSceneReady?.();
        }, 300);
      } else {
        timer = scheduleTimeout(poll, 120);
      }
    };
    poll();
    return () => clearTrackedTimeout(timer);
  }, [clearTrackedTimeout, scheduleTimeout]);

  return routeSceneReady;
}
