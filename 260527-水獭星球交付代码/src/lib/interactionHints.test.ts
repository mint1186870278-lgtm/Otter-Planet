import assert from 'node:assert/strict';
import {
  findNearestUncollectedStar,
  hasReachedGuidedStar,
  shouldShowIdleStarHint,
} from './interactionHints';

const stars = [
  { id: 0, x: 10, z: 0, isRequired: true },
  { id: 1, x: 2, z: 0, isRequired: true },
  { id: 2, x: -5, z: 0, isRequired: true },
];

assert.equal(findNearestUncollectedStar({ x: 0, z: 0 }, stars, new Set())?.id, 1);
assert.equal(findNearestUncollectedStar({ x: 0, z: 0 }, stars, new Set([1]))?.id, 2);
assert.equal(findNearestUncollectedStar({ x: 0, z: 0 }, stars, new Set([0, 1, 2])), null);

assert.equal(hasReachedGuidedStar({ x: 0, z: 0 }, { x: 2, z: 0 }, 2.2), true);
assert.equal(hasReachedGuidedStar({ x: 0, z: 0 }, { x: 2.3, z: 0 }, 2.2), false);

assert.equal(
  shouldShowIdleStarHint({ now: 6000, lastMoveAt: 900, lastHintAt: 0, hasTargetStar: true }),
  true,
);
assert.equal(
  shouldShowIdleStarHint({ now: 6000, lastMoveAt: 3000, lastHintAt: 0, hasTargetStar: true }),
  false,
);
assert.equal(
  shouldShowIdleStarHint({ now: 6000, lastMoveAt: 0, lastHintAt: 3000, hasTargetStar: true }),
  false,
);

console.log('interaction hint helpers ok');
