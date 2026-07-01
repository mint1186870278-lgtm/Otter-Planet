// src/lib/stepfunChat.ts
// NPC 对话请求 —— 与跑酷三个 NPC 共用同一套解析 / 标记逻辑。
//
// 🔒 安全：前端不持有任何 AI key。请求后端中转接口（/api/chat），后端补 key 调豆包模型。
// 后端 /api/chat 是【非流式】：一次性返回 { reply, message:{content}, ... }。
// 前端拿到完整 reply 后用打字机逐字回调 onToken，保留"边说边出"的体验，上层组件无需改动。
// 后端未就绪 / 出错时，请求会失败 → 调用方走友好兜底文案（不会崩）。

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// 后端对话中转地址（.env 的 VITE_CHAT_RELAY_URL）；未填用相对路径 /api/chat（与后端同域部署时直接可用）
const CHAT_RELAY_URL = import.meta.env.VITE_CHAT_RELAY_URL || '/api/chat';

// 打字机回放速度：拿到完整回复后，每字间隔（ms）。45ms/字 ≈ 22 次/秒 setState，
// 比 28ms(36次/秒)更省重渲染，对儿童阅读仍是自然的「边说边出」节奏。
const TYPEWRITER_MS = 45;


// 去掉所有标记，用于最终展示与历史
export function stripMarkers(text: string): string {
  return text.replace(/\[COMPLETE\]/g, '').replace(/\[NAME:[^\]]*\]/g, '').trim();
}

// 流式显示用：去已闭合标记 + 截断末尾半截标记（如 "[COMPL"），防一闪而过
export function sanitizeForDisplay(text: string): string {
  let s = text.replace(/\[COMPLETE\]/g, '').replace(/\[NAME:[^\]]*\]/g, '');
  const lastOpen = s.lastIndexOf('[');
  if (lastOpen !== -1 && s.indexOf(']', lastOpen) === -1) s = s.slice(0, lastOpen);
  return s;
}

// ── 月亮向导讲故事专用：去掉所有方括号段 ──────────────────────────────────────
// 模型偶尔会把内部「情节检查清单」用方括号吐出来（如 "[遇到第一个朋友啄木鸟]"），
// 这类内容绝不该展示给小朋友。月亮向导合法只会输出 [COMPLETE]，所以可放心去掉所有 []/【】 段。
// 最终展示 / 历史用：整段去掉所有 [..] 与 【..】，再 trim
export function stripAllBrackets(text: string): string {
  return text.replace(/\[[^\]]*\]/g, '').replace(/【[^】]*】/g, '').trim();
}
// 流式展示用：先去已闭合括号段，再从末尾未闭合的半截括号处截断（防 "[遇到" 一闪而过）
export function sanitizeAllBracketsForDisplay(text: string): string {
  let s = text.replace(/\[[^\]]*\]/g, '').replace(/【[^】]*】/g, '');
  // 已闭合的都删了，剩下的 [ 或 【 必是流式还没吐完的半截，从最早的未闭合括号处截断
  const openSquare = s.indexOf('[');
  const openFull = s.indexOf('【');
  const cut = [openSquare, openFull].filter(i => i !== -1).sort((a, b) => a - b)[0];
  if (cut !== undefined) s = s.slice(0, cut);
  return s;
}

// 抽取 [NAME:xxx] 里的名字（取第一个匹配）
export function extractName(text: string): string | null {
  const m = text.match(/\[NAME:([^\]]*)\]/);
  return m ? m[1].trim() : null;
}

// 对话请求；onToken 每次回调"累计全文"（不是单个 delta）。返回含标记的完整原文。
// 后端 /api/chat 非流式：一次性拿到 reply，再用打字机逐字回放，保留"边说边出"观感。
export async function streamChat(
  messages: ChatMessage[],
  onToken: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  // 走后端中转：只带 messages，不带 key。后端补 key 调豆包模型，返回 { reply, message:{content} }。
  const res = await fetch(CHAT_RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (!res.ok) throw new Error(`Chat relay ${res.status}`);

  const data = await res.json();
  // 兼容多种字段：优先 reply，其次 message.content（后端两个都给）
  const full: string = data?.reply ?? data?.message?.content ?? '';
  if (!full) throw new Error('Chat relay: empty reply');

  // 打字机回放：逐字调 onToken（累计全文），模拟原流式逐字显示。中途 abort 则立即停。
  let shown = '';
  for (const ch of full) {
    if (signal?.aborted) break;
    shown += ch;
    onToken(shown);
    await new Promise(r => setTimeout(r, TYPEWRITER_MS));
  }
  return full;
}

