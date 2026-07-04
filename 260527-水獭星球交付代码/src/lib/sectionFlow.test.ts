import assert from 'node:assert/strict';
import {
  PENDING_SECTION_KEY,
  SECTION_COUNT,
  SECTION_FLOW,
  clampSectionIndex,
  readPendingSectionIndex,
  rememberPendingSectionIndex,
  sectionNameAt,
} from './sectionFlow';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const expectedFlow = ['main', 'storybook', 'intro', 'parkour', 'story', 'gallery', 'egg'];
assert.deepEqual(SECTION_FLOW, expectedFlow);
assert.equal(SECTION_COUNT, expectedFlow.length);

assert.equal(clampSectionIndex(-10), 0);
assert.equal(clampSectionIndex(0), 0);
assert.equal(clampSectionIndex(3), 3);
assert.equal(clampSectionIndex(99), SECTION_COUNT - 1);
assert.equal(sectionNameAt(-1), 'main');
assert.equal(sectionNameAt(4), 'story');
assert.equal(sectionNameAt(99), 'egg');

{
  const storage = new MemoryStorage();
  assert.equal(readPendingSectionIndex(storage), 0);
  assert.equal(storage.getItem(PENDING_SECTION_KEY), null);
}

{
  const storage = new MemoryStorage();
  storage.setItem(PENDING_SECTION_KEY, '4');
  assert.equal(readPendingSectionIndex(storage), 4);
  assert.equal(storage.getItem(PENDING_SECTION_KEY), null);
}

{
  const storage = new MemoryStorage();
  storage.setItem(PENDING_SECTION_KEY, '999');
  assert.equal(readPendingSectionIndex(storage), SECTION_COUNT - 1);
  assert.equal(storage.getItem(PENDING_SECTION_KEY), null);
}

{
  const storage = new MemoryStorage();
  storage.setItem(PENDING_SECTION_KEY, 'not-a-number');
  assert.equal(readPendingSectionIndex(storage), 0);
  assert.equal(storage.getItem(PENDING_SECTION_KEY), null);
}

{
  const storage = new MemoryStorage();
  const scheduled: Array<() => void> = [];
  const next = rememberPendingSectionIndex(4, storage, callback => scheduled.push(callback));
  assert.equal(next, 4);
  assert.equal(storage.getItem(PENDING_SECTION_KEY), '4');
  assert.equal(scheduled.length, 1);
  storage.setItem(PENDING_SECTION_KEY, '5');
  scheduled[0]();
  assert.equal(storage.getItem(PENDING_SECTION_KEY), '5');
}

{
  const storage = new MemoryStorage();
  const scheduled: Array<() => void> = [];
  rememberPendingSectionIndex(99, storage, callback => scheduled.push(callback));
  assert.equal(storage.getItem(PENDING_SECTION_KEY), String(SECTION_COUNT - 1));
  scheduled[0]();
  assert.equal(storage.getItem(PENDING_SECTION_KEY), null);
}

console.log('section flow helpers ok');
