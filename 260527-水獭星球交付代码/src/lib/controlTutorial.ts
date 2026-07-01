export type TutorialDirection = 'left' | 'right' | 'up' | 'down';

export const CONTROL_TUTORIAL_DIRECTIONS: readonly TutorialDirection[] = ['left', 'right', 'up', 'down'];

const KEY_TO_DIRECTION: Record<string, TutorialDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
};

export function keyToTutorialDirection(key: string): TutorialDirection | null {
  return KEY_TO_DIRECTION[key] ?? null;
}

export function advanceControlTutorial(args: {
  currentDirectionIndex: number;
  inputDirection: TutorialDirection;
  now: number;
}): {
  currentDirectionIndex: number;
  isComplete: boolean;
  wasCorrect: boolean;
  lastCorrectInputTime: number;
} {
  const required = CONTROL_TUTORIAL_DIRECTIONS[args.currentDirectionIndex];
  if (args.inputDirection !== required) {
    return {
      currentDirectionIndex: args.currentDirectionIndex,
      isComplete: false,
      wasCorrect: false,
      lastCorrectInputTime: 0,
    };
  }

  const nextIndex = args.currentDirectionIndex + 1;
  return {
    currentDirectionIndex: nextIndex,
    isComplete: nextIndex >= CONTROL_TUTORIAL_DIRECTIONS.length,
    wasCorrect: true,
    lastCorrectInputTime: args.now,
  };
}

export function shouldPulseControlTutorialHint(args: {
  now: number;
  lastCorrectInputTime: number;
  lastPulseAt: number;
  idleMs?: number;
  cooldownMs?: number;
}): boolean {
  const idleMs = args.idleMs ?? 5000;
  const cooldownMs = args.cooldownMs ?? 5000;
  return args.now - args.lastCorrectInputTime >= idleMs && args.now - args.lastPulseAt >= cooldownMs;
}
