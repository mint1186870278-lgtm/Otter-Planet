import { useEffect, type RefObject } from 'react';

type ParkourSmokeState = {
  endingActive: boolean;
  fakeMoonDialog: 0 | 1 | 2;
  gameState: 'tutorial' | 'starGuide' | 'playing';
  isControlTutorialActive: boolean;
  milestonePopup: number | null;
  npcDialog: 1 | 2 | 3 | null;
  routeSceneReady: boolean;
  totalCollected: number;
};

type ParkourSmokeDriver = {
  closeFakeMoon: () => ParkourSmokeState;
  closeMilestone: () => ParkourSmokeState;
  collectTo: (target: number) => ParkourSmokeState;
  completeEnding: () => ParkourSmokeState;
  completeTutorial: () => ParkourSmokeState;
  finishNpc: () => ParkourSmokeState;
  openNpc: (index: number) => ParkourSmokeState;
  reachFakeMoon: () => ParkourSmokeState;
  state: () => ParkourSmokeState;
};

declare global {
  interface Window {
    __otterParkourSmoke?: ParkourSmokeDriver;
  }
}

function isSmokeEnabled() {
  try {
    return new URLSearchParams(window.location.search).has('test');
  } catch {
    return false;
  }
}

export function useParkourSmokeDriver({
  closeFakeMoon,
  closeMilestone,
  collectOne,
  completeEnding,
  completeTutorial,
  endingActive,
  fakeMoonDialog,
  finishNpcDialog,
  gameState,
  isControlTutorialActive,
  milestonePopup,
  npcDialog,
  openNpc,
  reachFakeMoon,
  routeSceneReady,
  totalCollectedRef,
}: {
  closeFakeMoon: () => void;
  closeMilestone: () => void;
  collectOne: (id: number) => void;
  completeEnding: () => void;
  completeTutorial: () => void;
  endingActive: boolean;
  fakeMoonDialog: 0 | 1 | 2;
  finishNpcDialog: () => void;
  gameState: 'tutorial' | 'starGuide' | 'playing';
  isControlTutorialActive: boolean;
  milestonePopup: number | null;
  npcDialog: 1 | 2 | 3 | null;
  openNpc: (index: number) => void;
  reachFakeMoon: () => void;
  routeSceneReady: boolean;
  totalCollectedRef: RefObject<number>;
}) {
  useEffect(() => {
    if (!isSmokeEnabled()) return;

    const state = (): ParkourSmokeState => ({
      endingActive,
      fakeMoonDialog,
      gameState,
      isControlTutorialActive,
      milestonePopup,
      npcDialog,
      routeSceneReady,
      totalCollected: totalCollectedRef.current,
    });

    const driver: ParkourSmokeDriver = {
      closeFakeMoon: () => {
        closeFakeMoon();
        return state();
      },
      closeMilestone: () => {
        closeMilestone();
        return state();
      },
      collectTo: target => {
        const capped = Math.max(0, Math.min(9, target));
        while (totalCollectedRef.current < capped) {
          collectOne(9000 + totalCollectedRef.current);
        }
        return state();
      },
      completeEnding: () => {
        completeEnding();
        return state();
      },
      completeTutorial: () => {
        completeTutorial();
        return state();
      },
      finishNpc: () => {
        finishNpcDialog();
        return state();
      },
      openNpc: index => {
        openNpc(index);
        return state();
      },
      reachFakeMoon: () => {
        reachFakeMoon();
        return state();
      },
      state,
    };

    window.__otterParkourSmoke = driver;
    return () => {
      if (window.__otterParkourSmoke === driver) {
        delete window.__otterParkourSmoke;
      }
    };
  }, [
    closeFakeMoon,
    closeMilestone,
    collectOne,
    completeEnding,
    completeTutorial,
    endingActive,
    fakeMoonDialog,
    finishNpcDialog,
    gameState,
    isControlTutorialActive,
    milestonePopup,
    npcDialog,
    openNpc,
    reachFakeMoon,
    routeSceneReady,
    totalCollectedRef,
  ]);
}
