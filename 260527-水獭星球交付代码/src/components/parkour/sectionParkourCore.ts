// src/components/parkour/sectionParkourCore.ts
// SectionParkour 的「纯常量 / 类型 / 工具函数」集中处——从 SectionParkour.tsx 组件体外抽出。
// 无 React hook、无 JSX：配置旋钮、移动计算、NPC AI 对话中转 + 标记处理。
// 抽出目的：把 1745 行的巨型组件文件瘦身、易读；这些纯代码改起来也不用在组件里翻。

import * as THREE from 'three';
import { ACTOR_SCALE, type Vec2 } from '../parkourConstants';
import type { TutorialDirection } from '../../lib/controlTutorial';

export const RENDER_CONFIG = {
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.15,
  outputColorSpace: THREE.SRGBColorSpace,
  antialias: true,
};

// 单位/秒，八向移动。乘 ACTOR_SCALE 后，角色缩小时步速同步变慢，跑步动画不会打滑。
export const PLAYER_SPEED = 13 * ACTOR_SCALE;
export const DIRECTION_TO_KEY: Record<TutorialDirection, 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'> = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
};
export const KEY_TO_MOVEMENT_KEY: Record<string, 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'> = {
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  a: 'ArrowLeft',
  A: 'ArrowLeft',
  d: 'ArrowRight',
  D: 'ArrowRight',
  w: 'ArrowUp',
  W: 'ArrowUp',
  s: 'ArrowDown',
  S: 'ArrowDown',
};
export const TUTORIAL_STEP_MOVE_MS = 120;
export const STAR_GUIDE_REACH_RADIUS = 2.4;

// ── 🐦 NPC 对话立绘 位置/大小旋钮（你自己调这三个数）──────────────────────────
//   height = 立绘高度（用 vh，越大立绘越大；当前 92vh ≈ 比原来 50vh 大近一倍）。
//   top    = 立绘顶端距画面顶部（%，越小越靠上）。
//   right  = 立绘右缘距画面右侧（%，越大越往左/往画面中间靠）。
// 想让立绘更居中就把 right 调大、想更靠上就把 top 调小、想更大就把 height 调大。
export const NPC_PORTRAIT = { height: '78vh', top: '2%', right: 'calc(18% + 5px)' };

export function computeVelocity(held: Set<string>, yaw: number, frozen: boolean): Vec2 {
  if (frozen) return { x: 0, z: 0 };
  let lx = 0, lz = 0;
  if (held.has('ArrowUp')) lz -= 1;
  if (held.has('ArrowDown')) lz += 1;
  if (held.has('ArrowLeft')) lx -= 1;
  if (held.has('ArrowRight')) lx += 1;
  const len = Math.hypot(lx, lz);
  if (len === 0) return { x: 0, z: 0 };
  const nx = lx / len, nz = lz / len;
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  return {
    x: (cosY * nx - sinY * nz) * PLAYER_SPEED,
    z: (sinY * nx + cosY * nz) * PLAYER_SPEED,
  };
}

// ── NPC AI 对话 ─────────────────────────────────────────────────────────────
// 🔒 安全：前端不持有任何 AI key。请求后端中转 /api/chat（后端补 key 调豆包模型，非流式返回）。
// 后端未就绪 / 出错时请求失败 → 走友好兜底文案。
const CHAT_RELAY_URL = import.meta.env.VITE_CHAT_RELAY_URL || '/api/chat';

// 打字机回放速度：拿到完整回复后，每字间隔（ms），模拟原流式逐字显示
const TYPEWRITER_MS = 28;

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type FeedbackItem = { id: number; kind: 'star' | 'box'; text: string };

// 三个 NPC 的 System Prompt（索引 0/1/2 对应 NPC1/2/3）
export const NPC_SYSTEM_PROMPTS: readonly string[] = [
  // NPC1 啄木鸟（意图判断）
  '你是啄木鸟，花衬衫、红色大背头，是森林里的线索角色。你说话短、酷、有点爱卖关子，但对小朋友友善。你的任务是：判断小朋友说的话是否和"去找月亮"有关，帮助小朋友练习把目标说清楚。规则：如果小朋友说的内容和"找月亮/寻找月亮/月亮不见了/去找月亮"有关，先肯定，然后说"有人知道月亮在哪！多去问问，完成小挑战就能知道答案～"，在回复末尾加上[COMPLETE]。如果无关，用一个简单但有个性的问题引导小朋友说出要找月亮，不要直接说答案。回复不超过30字，不使用成人俚语或难懂梗，用5到7岁小朋友能听懂的词，不能有不适合儿童的内容，中文回复。',
  // NPC2 kiwi（猜名字 + 指错路）
  '你是kiwi，星际旅行背包客，口头禅是"kiwi"。你有点调皮，爱让小朋友猜，但不嘲笑人。你的互动有想象命名和方向判断的学习意义。流程：第一步问"你猜猜我是谁？"第二步无论小朋友说什么名字都开心接受，回复"没错，我就是[名字]！kiwi！"并加上[NAME:名字]标记。第三步告诉小朋友你知道月亮线索，引导他继续跑但故意说错方向（指向假月亮），说"kiwi！我知道月亮在哪！往那边跑！"末尾加[COMPLETE]。每次回复不超过25字，必须含"kiwi"，语气轻快、有点调皮、信息清楚，少讲人设，用5到7岁小朋友能听懂的词，不能有不适合儿童的内容，中文回复。',
  // NPC3 叽里咕噜（描述月亮）
  '你是叽里咕噜，爱植物、爱观察天空，常说"观察记录"。你认真到有点可爱，像发现线索就会眼睛发亮。你的任务是让小朋友描述月亮长什么样子，练习观察和表达。先说"完成我的小观察，我就告诉你月亮在哪！月亮长什么样呀？"无论小朋友怎么描述月亮（任何描述都算对），都先肯定，再说"根据我的观察记录，真月亮就在前面！跟我来！"末尾加[COMPLETE]。每次回复不超过35字，信息清楚，有一点认真小怪癖，温柔鼓励，科学词要说简单，用5到7岁小朋友能听懂的词，不能有不适合儿童的内容，中文回复。',
];

// 从完整文本剥离所有标记（[COMPLETE] 和 [NAME:xxx]），用于最终展示与历史记录
export function stripMarkers(text: string): string {
  return text
    .replace(/\[COMPLETE\]/g, '')
    .replace(/\[NAME:[^\]]*\]/g, '')
    .trim();
}

// 流式显示用：剥离已闭合标记，并截断末尾正在流入的半截标记（如 "[COMPL"），避免标记一闪而过
export function sanitizeForDisplay(text: string): string {
  let s = text.replace(/\[COMPLETE\]/g, '').replace(/\[NAME:[^\]]*\]/g, '');
  const lastOpen = s.lastIndexOf('[');
  if (lastOpen !== -1 && s.indexOf(']', lastOpen) === -1) {
    s = s.slice(0, lastOpen); // 末尾有未闭合的 '['，可能是半截标记，先不显示
  }
  return s;
}

// 提取 [NAME:xxx] 中的名字（取第一个匹配）
export function extractName(text: string): string | null {
  const m = text.match(/\[NAME:([^\]]*)\]/);
  return m ? m[1].trim() : null;
}

/**
 * 调用后端对话中转 /api/chat（非流式），拿到完整 reply 后用打字机逐字回调 onToken，
 * 返回累计的完整原始文本（含标记）。失败时抛错，由调用方做友好兜底。
 */
export async function streamChat(
  messages: ChatMessage[],
  onToken?: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  // 走后端中转：只带 messages，不带 key。后端补 key 调豆包模型，返回 { reply, message:{content} }。
  const res = await fetch(CHAT_RELAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Chat relay ${res.status}`);
  }

  const data = await res.json();
  // 兼容字段：优先 reply，其次 message.content
  const full: string = data?.reply ?? data?.message?.content ?? '';
  if (!full) throw new Error('Chat relay: empty reply');
  if (!onToken) return full;

  // 打字机回放：逐字调 onToken（累计全文），模拟原流式逐字显示。中途 abort 立即停。
  let shown = '';
  for (const ch of full) {
    if (signal?.aborted) break;
    shown += ch;
    onToken(shown);
    await new Promise(r => setTimeout(r, TYPEWRITER_MS));
  }
  return full;
}
