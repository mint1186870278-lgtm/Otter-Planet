import assert from 'node:assert/strict';
import {
  FISH_VOICE_IDS,
  createFishSpeechUrl,
  createFishTtsPayload,
  fishVoiceRoleFromNpcIndex,
  sanitizeTextForSpeech,
} from './fishAudio';

assert.equal(fishVoiceRoleFromNpcIndex(1), 'woodpecker');
assert.equal(fishVoiceRoleFromNpcIndex(2), 'kiwi');
assert.equal(fishVoiceRoleFromNpcIndex(3), 'jiligulu');

assert.equal(FISH_VOICE_IDS.woodpecker, '35a9636116db44d6a5310afbf150422a');
assert.equal(FISH_VOICE_IDS.kiwi, '826150b4861b40d982896940f55095be');
assert.equal(FISH_VOICE_IDS.jiligulu, '737db7322d494e85a27bd73fad9d493b');

assert.equal(
  sanitizeTextForSpeech('没错，我就是星星！kiwi！[NAME:星星] [COMPLETE]'),
  '没错，我就是星星！kiwi！',
);

assert.deepEqual(createFishTtsPayload('jiligulu', '真月亮就在前面！ [COMPLETE]'), {
  role: 'jiligulu',
  reference_id: '737db7322d494e85a27bd73fad9d493b',
  text: '真月亮就在前面！',
});

const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
let requestedBody = '';
globalThis.fetch = (async (_url, init) => {
  requestedBody = String(init?.body ?? '');
  return new Response(new Blob(['audio-bytes'], { type: 'audio/mpeg' }), { status: 200 });
}) as typeof fetch;
URL.createObjectURL = () => 'blob:fish-audio-test';

const url = await createFishSpeechUrl('woodpecker', '有人知道月亮在哪！ [COMPLETE]');
assert.equal(url, 'blob:fish-audio-test');
assert.deepEqual(JSON.parse(requestedBody), {
  role: 'woodpecker',
  reference_id: '35a9636116db44d6a5310afbf150422a',
  text: '有人知道月亮在哪！',
});

globalThis.fetch = originalFetch;
URL.createObjectURL = originalCreateObjectURL;

console.log('fish audio helpers ok');
