export type HintVec2 = { x: number; z: number };

export type HintStar = HintVec2 & { id: number; isRequired?: boolean };

export function findNearestUncollectedStar(
  player: HintVec2,
  stars: readonly HintStar[],
  collectedIds: ReadonlySet<number>,
): HintStar | null {
  let nearest: HintStar | null = null;
  let nearestDist2 = Infinity;

  for (const star of stars) {
    if (collectedIds.has(star.id)) continue;
    const dist2 = (star.x - player.x) ** 2 + (star.z - player.z) ** 2;
    if (dist2 < nearestDist2) {
      nearest = star;
      nearestDist2 = dist2;
    }
  }

  return nearest;
}

export function hasReachedGuidedStar(
  player: HintVec2,
  target: HintVec2 | null,
  reachRadius = 2.2,
): boolean {
  if (!target) return false;
  const dist2 = (target.x - player.x) ** 2 + (target.z - player.z) ** 2;
  return dist2 <= reachRadius * reachRadius;
}

export function shouldShowIdleStarHint(args: {
  now: number;
  lastMoveAt: number;
  lastHintAt: number;
  hasTargetStar: boolean;
  idleMs?: number;
  cooldownMs?: number;
}): boolean {
  const idleMs = args.idleMs ?? 5000;
  const cooldownMs = args.cooldownMs ?? 5000;
  return (
    args.hasTargetStar &&
    args.now - args.lastMoveAt >= idleMs &&
    args.now - args.lastHintAt >= cooldownMs
  );
}
