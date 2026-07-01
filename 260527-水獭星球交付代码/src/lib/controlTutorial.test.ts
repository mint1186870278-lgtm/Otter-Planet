import assert from 'node:assert/strict';
import {
  CONTROL_TUTORIAL_DIRECTIONS,
  advanceControlTutorial,
  keyToTutorialDirection,
  shouldPulseControlTutorialHint,
} from './controlTutorial';

assert.deepEqual(CONTROL_TUTORIAL_DIRECTIONS, ['left', 'right', 'up', 'down']);

assert.equal(keyToTutorialDirection('ArrowLeft'), 'left');
assert.equal(keyToTutorialDirection('a'), 'left');
assert.equal(keyToTutorialDirection('D'), 'right');
assert.equal(keyToTutorialDirection('ArrowUp'), 'up');
assert.equal(keyToTutorialDirection('s'), 'down');
assert.equal(keyToTutorialDirection('Space'), null);

let result = advanceControlTutorial({
  currentDirectionIndex: 0,
  inputDirection: 'right',
  now: 1000,
});
assert.deepEqual(result, {
  currentDirectionIndex: 0,
  isComplete: false,
  wasCorrect: false,
  lastCorrectInputTime: 0,
});

result = advanceControlTutorial({
  currentDirectionIndex: 0,
  inputDirection: 'left',
  now: 1000,
});
assert.deepEqual(result, {
  currentDirectionIndex: 1,
  isComplete: false,
  wasCorrect: true,
  lastCorrectInputTime: 1000,
});

result = advanceControlTutorial({
  currentDirectionIndex: 3,
  inputDirection: 'down',
  now: 2500,
});
assert.deepEqual(result, {
  currentDirectionIndex: 4,
  isComplete: true,
  wasCorrect: true,
  lastCorrectInputTime: 2500,
});

assert.equal(
  shouldPulseControlTutorialHint({ now: 6000, lastCorrectInputTime: 900, lastPulseAt: 0 }),
  true,
);
assert.equal(
  shouldPulseControlTutorialHint({ now: 6000, lastCorrectInputTime: 2500, lastPulseAt: 0 }),
  false,
);
assert.equal(
  shouldPulseControlTutorialHint({ now: 9000, lastCorrectInputTime: 0, lastPulseAt: 6500 }),
  false,
);

console.log('control tutorial helpers ok');
