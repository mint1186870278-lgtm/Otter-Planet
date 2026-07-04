import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

type FishVoiceRole = 'woodpecker' | 'kiwi' | 'jiligulu';

const FISH_TTS_URL = 'https://api.fish.audio/v1/tts';
const FISH_TTS_MODEL = process.env.FISH_AUDIO_MODEL || 's2-pro';
const FISH_API_KEY = process.env.FISH_AUDIO_API_KEY;
const PORT = Number(process.env.PORT || 6636);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FISH_VOICE_IDS: Record<FishVoiceRole, string> = {
  woodpecker: '35a9636116db44d6a5310afbf150422a',
  kiwi: '826150b4861b40d982896940f55095be',
  jiligulu: '737db7322d494e85a27bd73fad9d493b',
};

function isFishVoiceRole(value: unknown): value is FishVoiceRole {
  return value === 'woodpecker' || value === 'kiwi' || value === 'jiligulu';
}

function sanitizeTtsText(value: unknown): string {
  return String(value ?? '')
    .replace(/\[(?:COMPLETE|NAME:[^\]]*)\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

const app = express();
app.use(express.json({ limit: '64kb' }));

app.post('/api/fish-tts', async (req, res) => {
  if (!FISH_API_KEY) {
    res.status(500).json({ error: 'FISH_AUDIO_API_KEY is not configured' });
    return;
  }

  const role = req.body?.role;
  if (!isFishVoiceRole(role)) {
    res.status(400).json({ error: 'Invalid Fish Audio voice role' });
    return;
  }

  const text = sanitizeTtsText(req.body?.text);
  if (!text) {
    res.status(400).json({ error: 'Text is required' });
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(FISH_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FISH_API_KEY}`,
        'Content-Type': 'application/json',
        model: FISH_TTS_MODEL,
      },
      body: JSON.stringify({
        text,
        reference_id: FISH_VOICE_IDS[role],
        format: 'mp3',
        normalize: true,
      }),
    });
  } catch (err) {
    res.status(502).json({
      error: 'Fish Audio TTS request failed',
      detail: (err as Error).message,
    });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    res.status(upstream.status || 502).json({
      error: 'Fish Audio TTS request failed',
      detail: detail.slice(0, 500),
    });
    return;
  }

  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');

  const audio = Buffer.from(await upstream.arrayBuffer());
  res.send(audio);
});

app.use(express.static(path.join(__dirname, 'dist'), {
  setHeaders(res, filePath) {
    const normalized = filePath.replaceAll(path.sep, '/');
    if (normalized.endsWith('/index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return;
    }
    if (/\.(?:js|css|glb|gltf|bin|ktx2|webp|png|jpe?g|svg|mp3|m4a|wav|hdr)$/i.test(normalized)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Otter Planet server listening on http://localhost:${PORT}`);
});
