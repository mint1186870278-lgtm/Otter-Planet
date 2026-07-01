// src/lib/GalleryContext.tsx
// 探险相册共享状态 —— 跑酷途中并行调用生图，结果存这里，SectionResult 读取展示。
// 每个槽位生成两张图：横图（wide，右侧大图用）+ 方图（square，左侧缩略图用，两个角色完整居中）。
// Seedream 未固定 seed，方图不是横图的裁剪版，而是同一场景的另一张画面，两者构图/姿势会略有差异，这是预期的。
//
// 🔒 安全：前端不再直连火山方舟、不再持 key（已迁到后端中转 VITE_IMAGE_RELAY_URL）。
// 后端补 key + 固定参数调 ARK 并返回 { url }；key 只在服务端，不进前端包。

import React, { createContext, useContext, useCallback, useState } from 'react';

// ── 槽位定义 ────────────────────────────────────────────────────────────────
export type GallerySlotKey = 'npc1' | 'npc2' | 'fakeMoon' | 'npc3';
export const SLOT_ORDER: GallerySlotKey[] = ['npc1', 'npc2', 'fakeMoon', 'npc3'];

// 单张图的状态。横图、方图各自独立——分别生成，可能一张成一张败，不能用一个 status 绑两张。
export interface ImageState {
  status: 'idle' | 'loading' | 'done' | 'error';
  url: string | null;
}
export interface GallerySlot {
  wide: ImageState;   // 横图，右侧大图用
  square: ImageState; // 方图，左侧缩略图用（两个角色完整居中）
}
export type GalleryState = Record<GallerySlotKey, GallerySlot>;

const emptyImg = (): ImageState => ({ status: 'idle', url: null });
const initialGallery: GalleryState = {
  npc1:     { wide: emptyImg(), square: emptyImg() },
  npc2:     { wide: emptyImg(), square: emptyImg() },
  fakeMoon: { wide: emptyImg(), square: emptyImg() },
  npc3:     { wide: emptyImg(), square: emptyImg() },
};

// ── 静态替换图（实时生图暂时弃用时使用；恢复时删掉 STATIC_IMAGES 并把 useState 改回 initialGallery）──
const STATIC_IMAGES: GalleryState = {
  npc1:     { wide: { status: 'done', url: '/final-picture/01-1.webp' },  square: { status: 'done', url: '/final-picture/01.webp' } },
  npc2:     { wide: { status: 'done', url: '/final-picture/02-2.webp' },  square: { status: 'done', url: '/final-picture/02.webp' } },
  fakeMoon: { wide: { status: 'done', url: '/final-picture/03-3.webp' },  square: { status: 'done', url: '/final-picture/03.webp' } },
  npc3:     { wide: { status: 'done', url: '/final-picture/04-4.webp' },  square: { status: 'done', url: '/final-picture/04.webp' } },
};

// ── 参考图 URL（5 张定妆图存 GitHub assets 仓库，经 jsDelivr CDN 分发）──────────
// 接口的 image 字段只收公网 https URL。⚠️ 不能直接用 raw.githubusercontent.com：
// 火山方舟服务器在国内（cn-beijing），拉 raw.githubusercontent 会 Timeout（实测 400）。
// 改用 jsDelivr CDN 镜像同一仓库（实测火山可稳定下载），改 base 即可，无需重新上传。
// 源仓库：https://github.com/mint1186870278-lgtm/shuita-assets
const REF = {
  otter:      'https://cdn.jsdelivr.net/gh/mint1186870278-lgtm/shuita-assets@main/otter.png',      // 水獭主角，每张都要带
  woodpecker: 'https://cdn.jsdelivr.net/gh/mint1186870278-lgtm/shuita-assets@main/woodpecker.png', // 啄木鸟
  kiwi:       'https://cdn.jsdelivr.net/gh/mint1186870278-lgtm/shuita-assets@main/kiwi.png',        // kiwi
  capybara:   'https://cdn.jsdelivr.net/gh/mint1186870278-lgtm/shuita-assets@main/capybara.png',    // 叽里咕噜 水豚
  fakemoon:   'https://cdn.jsdelivr.net/gh/mint1186870278-lgtm/shuita-assets@main/fakemoon.png',    // 假月亮（像月亮的大石头）
};

// ── prompt 拼装：通用前缀 + 场景描述 + 构图收尾句 ─────────────────────────────
// 通用彩铅风前缀（拼在每条 prompt 最前，末尾带 ", " 衔接场景）
const STYLE_PREFIX =
  "children's colored pencil illustration, hand-drawn crayon texture, visible pencil strokes and paper grain, soft layered shading, warm dreamy storybook mood, rich saturated palette, cozy and heartwarming, ";
// 两种构图收尾句（横图沿用原来的横版构图；方图要求两个角色完整居中）
const WIDE_COMPOSITION =
  ', horizontal landscape composition framed like a keepsake travel snapshot, clean simple background.';
const SQUARE_COMPOSITION =
  ', square composition, both characters fully visible and centered in frame, clean simple background.';
// fakeMoon 只有 1 个角色（水獭 + 大石头），方图构图句单独写
const SQUARE_COMPOSITION_FAKEMOON =
  ', square composition, the otter and the big rock both fully visible and centered, clean simple background.';

// ── 四槽场景描述（不含构图收尾句；横图/方图共用同一段场景，只是收尾句不同）──────
const SLOT_SCENES: Record<GallerySlotKey, { images: string[]; scene: string; squareComposition: string }> = {
  npc1: {
    images: [REF.otter, REF.woodpecker],
    scene:
      'the baby otter astronaut (brown fur, cream belly, white spacesuit with a clear round bubble helmet) meeting a woodpecker with a bright red swept-back pompadour crest wearing a white lab coat embroidered with leaves and flowers, on a sunlit grassy forest path with rolling green meadow and trees, the woodpecker with a friendly confident expression, beak closed, cheerful sparkling eyes, the moment of their first encounter, bright sunny daytime, clear blue sky with soft white clouds, warm daylight',
    squareComposition: SQUARE_COMPOSITION,
  },
  npc2: {
    images: [REF.otter, REF.kiwi],
    scene:
      'the baby otter astronaut (brown fur, white spacesuit with a clear round bubble helmet) beside a fluffy brown kiwi bird with a long beak dressed as a child-friendly star backpacker, wearing a bright scarf, a tiny explorer cap, and a small rounded backpack with star patches, the kiwi pointing happily toward the wrong direction at a forking grassy path in a sunny forest meadow, playful adventurous mood, bright sunny daytime, clear blue sky, cheerful warm daylight',
    squareComposition: SQUARE_COMPOSITION,
  },
  fakeMoon: {
    images: [REF.otter, REF.fakemoon],
    scene:
      'the baby otter astronaut (brown fur, white spacesuit with a clear round bubble helmet) standing in a grassy clearing next to a large round boulder sitting on the ground, a big grey cratered rock that looks like the moon from afar but is clearly just a dull stone, not glowing, the otter turned toward the rock and looking up at it with a puzzled amused expression, gazing at the big stone, golden dusk, warm orange sunset sky fading to deep blue',
    squareComposition: SQUARE_COMPOSITION_FAKEMOON,
  },
  npc3: {
    images: [REF.otter, REF.capybara],
    scene:
      'the baby otter astronaut (brown fur, white spacesuit with a clear round bubble helmet) meeting a chubby capybara child scientist who loves plants and the moon, wearing a soft teal vest with leaf badges, holding a small green leafy sprig and a simple picture notebook, smiling and pointing gently toward the real moon ahead, in a lush green forest meadow, warm friendship and curiosity, golden dusk, warm sunset glow, deep blue evening sky with first stars',
    squareComposition: SQUARE_COMPOSITION,
  },
};

// ── 四槽配置：参考图 + 横图/方图各自的完整 prompt（前缀 + 场景 + 构图句）─────────
export const SLOT_CONFIG = SLOT_ORDER.reduce((acc, key) => {
  const { images, scene, squareComposition } = SLOT_SCENES[key];
  acc[key] = {
    images,
    widePrompt: STYLE_PREFIX + scene + WIDE_COMPOSITION,
    squarePrompt: STYLE_PREFIX + scene + squareComposition,
  };
  return acc;
}, {} as Record<GallerySlotKey, { images: string[]; widePrompt: string; squarePrompt: string }>);

// ── 后端生图中转接口 ─────────────────────────────────────────────────────────
// 🔒 安全：前端不再直连火山方舟、不再持 key。改为请求后端中转（VITE_IMAGE_RELAY_URL），
// 后端补 key + 固定参数（model/watermark 等）调 ARK，返回 { url }。中转未就绪时请求失败 → 槽位置 error。
const IMAGE_RELAY_URL = import.meta.env.VITE_IMAGE_RELAY_URL || '/api/image-gen';
const WIDE_SIZE = '2K';            // 横图：沿用原值
const SQUARE_SIZE = '2048x2048';   // 方图：正方形 1:1（豆包 Seedream 支持的写法）
// 重试参数：ARK 拉参考图是随机间歇性 timeout（实测任何一张、含最小的 otter 都会偶发挂，
// 失败率约 25%，与文件大小/槽位无关），且 ARK ~10s 即快速判 timeout 返回。故多重试几次最有效：
// 5 次独立重试后全挂概率 ≈ 0.1%。每次仍带 90s 超时兜底极端慢响应。横图、方图各自独立跑这套重试。
// 注：后端中转也可自己做重试；前端这层重试保留，双保险无害。
const ARK_MAX_ATTEMPTS = 5;
const ARK_ATTEMPT_TIMEOUT_MS = 90_000;
const ARK_RETRY_BACKOFF_MS = 1_200;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 单次生图尝试：成功返回 url，失败抛错（带 90s 超时）。发给后端中转，不带 key。
async function genOne(prompt: string, images: string[], size: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ARK_ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(IMAGE_RELAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        images,                                // 多参考图：数组（后端字段名为 images）
        size,                                  // 横图传 WIDE_SIZE，方图传 SQUARE_SIZE
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`image relay ${res.status}`);
    const data = await res.json();
    const url: string | undefined = data?.url ?? data?.data?.[0]?.url; // 兼容后端直接返回 {url} 或透传 ARK 结构
    if (!url) throw new Error('no image url');
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// 带重试的生图：瞬时失败（ARK 500 / 拉图 timeout / 网络抖动）退避后重试，最多 ARK_MAX_ATTEMPTS 次
async function genWithRetry(prompt: string, images: string[], size: string): Promise<string> {
  for (let attempt = 1; attempt <= ARK_MAX_ATTEMPTS; attempt++) {
    try {
      return await genOne(prompt, images, size);
    } catch (e) {
      if (attempt >= ARK_MAX_ATTEMPTS) throw e;
      await sleep(ARK_RETRY_BACKOFF_MS * attempt); // 退避后再试（首次失败也预热了 CDN 缓存）
    }
  }
  throw new Error('unreachable');
}

interface GalleryContextValue {
  gallery: GalleryState;
  generateSlot: (key: GallerySlotKey) => void; // fire-and-forget，内部并行发横图 + 方图两个请求
}

const GalleryContext = createContext<GalleryContextValue>({
  gallery: initialGallery,
  generateSlot: () => {},
});

export const useGallery = () => useContext(GalleryContext);

export function GalleryProvider({ children }: { children: React.ReactNode }) {
  const [gallery] = useState<GalleryState>(STATIC_IMAGES);

  // 实时生图暂时弃用；恢复时：useState 改回 initialGallery，取消注释下方 generateSlot 实现。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const generateSlot = useCallback((_key: GallerySlotKey) => {}, []);

  return (
    <GalleryContext.Provider value={{ gallery, generateSlot }}>
      {children}
    </GalleryContext.Provider>
  );
}
