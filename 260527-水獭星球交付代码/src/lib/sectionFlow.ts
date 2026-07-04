export const SECTION_FLOW = [
  'main',
  'storybook',
  'intro',
  'parkour',
  'story',
  'gallery',
  'egg',
] as const;

export type AppSectionName = typeof SECTION_FLOW[number];

export const SECTION_COUNT = SECTION_FLOW.length;
export const PENDING_SECTION_KEY = 'otter_pending_section';

type PendingSectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type TimeoutFn = (handler: () => void, timeout?: number) => unknown;

function defaultStorage(): PendingSectionStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function defaultTimeout(): TimeoutFn | null {
  return typeof window === 'undefined' ? null : window.setTimeout.bind(window);
}

export function clampSectionIndex(index: number) {
  return Math.min(Math.max(index, 0), SECTION_COUNT - 1);
}

export function sectionNameAt(index: number): AppSectionName {
  return SECTION_FLOW[clampSectionIndex(index)];
}

export function readPendingSectionIndex(storage: PendingSectionStorage | null = defaultStorage()) {
  try {
    const raw = storage?.getItem(PENDING_SECTION_KEY) ?? null;
    storage?.removeItem(PENDING_SECTION_KEY);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampSectionIndex(parsed) : 0;
  } catch {
    return 0;
  }
}

export function rememberPendingSectionIndex(
  index: number,
  storage: PendingSectionStorage | null = defaultStorage(),
  schedule: TimeoutFn | null = defaultTimeout(),
) {
  const next = clampSectionIndex(index);
  try {
    storage?.setItem(PENDING_SECTION_KEY, String(next));
    schedule?.(() => {
      if (storage?.getItem(PENDING_SECTION_KEY) === String(next)) {
        storage.removeItem(PENDING_SECTION_KEY);
      }
    }, 5000);
  } catch {
    // Storage can be unavailable in hardened browser modes.
  }
  return next;
}
