import { useEffect, type RefObject } from 'react';
import { keyToTutorialDirection, type TutorialDirection } from '../../lib/controlTutorial';
import { KEY_TO_MOVEMENT_KEY } from './sectionParkourCore';

export type MovementKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
type ParkourGameState = 'tutorial' | 'starGuide' | 'playing';

export function useParkourKeyboardControls({
  cutsceneFreezeRef,
  gameState,
  isControlTutorialActive,
  isInView,
  npcDialogOpen,
  onTutorialDirection,
  pressMovementKey,
  releaseMovementKey,
}: {
  cutsceneFreezeRef: RefObject<boolean>;
  gameState: ParkourGameState;
  isControlTutorialActive: boolean;
  isInView: boolean;
  npcDialogOpen: boolean;
  onTutorialDirection: (direction: TutorialDirection) => void;
  pressMovementKey: (key: MovementKey) => void;
  releaseMovementKey: (key: MovementKey) => void;
}) {
  useEffect(() => {
    if (!isInView) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'tutorial' && gameState !== 'starGuide' && gameState !== 'playing') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (npcDialogOpen || cutsceneFreezeRef.current) {
        if (e.key.startsWith('Arrow')) e.preventDefault();
        return;
      }
      const movementKey = KEY_TO_MOVEMENT_KEY[e.key];
      if (!movementKey) return;
      e.preventDefault();

      const tutorialDirection = keyToTutorialDirection(e.key);
      if (isControlTutorialActive) {
        if (tutorialDirection) onTutorialDirection(tutorialDirection);
        return;
      }

      pressMovementKey(movementKey);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const movementKey = KEY_TO_MOVEMENT_KEY[e.key];
      if (!movementKey || isControlTutorialActive) return;
      releaseMovementKey(movementKey);
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    cutsceneFreezeRef,
    gameState,
    isControlTutorialActive,
    isInView,
    npcDialogOpen,
    onTutorialDirection,
    pressMovementKey,
    releaseMovementKey,
  ]);
}
