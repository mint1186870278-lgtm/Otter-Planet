export type FishVoiceRole = 'woodpecker' | 'kiwi' | 'jiligulu';

export const FISH_VOICE_IDS: Record<FishVoiceRole, string> = {
  woodpecker: '35a9636116db44d6a5310afbf150422a',
  kiwi: '826150b4861b40d982896940f55095be',
  jiligulu: '737db7322d494e85a27bd73fad9d493b',
};

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const FISH_TTS_RELAY_URL = viteEnv?.VITE_FISH_TTS_RELAY_URL || '/api/fish-tts';

const MARKER_RE = /\[(?:COMPLETE|NAME:[^\]]*)\]/g;

export function fishVoiceRoleFromNpcIndex(npcIndex: 1 | 2 | 3): FishVoiceRole {
  return npcIndex === 1 ? 'woodpecker' : npcIndex === 2 ? 'kiwi' : 'jiligulu';
}

export function sanitizeTextForSpeech(text: string): string {
  return text
    .replace(MARKER_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createFishTtsPayload(role: FishVoiceRole, text: string) {
  return {
    role,
    reference_id: FISH_VOICE_IDS[role],
    text: sanitizeTextForSpeech(text),
  };
}

export async function fetchFishSpeech(
  role: FishVoiceRole,
  text: string,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const payload = createFishTtsPayload(role, text);
  if (!payload.text) return null;

  const res = await fetch(FISH_TTS_RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) throw new Error(`Fish TTS relay ${res.status}`);
  return res.blob();
}

export async function createFishSpeechUrl(
  role: FishVoiceRole,
  text: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const blob = await fetchFishSpeech(role, text, signal);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}
