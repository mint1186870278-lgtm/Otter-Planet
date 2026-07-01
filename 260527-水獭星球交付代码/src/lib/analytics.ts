// src/lib/analytics.ts
// 埋点数据上报（MVP）：采集行为数据用于投资人展示 + 产品迭代。
// 三类：① 各 section 停留时长 ② 每个环节完成 ③ 留存提交。实时 POST，带匿名 sessionId。
// 原则：埋点失败绝不能影响游戏 —— 所有上报 try/catch 静默，不弹错、不阻塞。
// 隐私：sessionId 是纯随机匿名串，不绑定姓名/手机/设备；微信号/邮箱原文绝不进埋点接口。

// 每次打开游戏生成一个随机会话 ID，本轮所有上报都带它（后端按它聚合「同一次游玩」）。
// 内存即可：刷新会重新生成 = 新的一次游玩（MVP 够用）。
const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ─── 自测标记 ───
// 我们自己测试时，访问带 ?test=1 的网址即可把本浏览器永久标记为「自测」，
// 之后该浏览器所有埋点/留资都带 test:1，看板默认剔除，不污染真实数据。
// 访问 ?test=0 可解除标记。标记存 localStorage，一次设置长期生效。
const TEST_FLAG_KEY = 'otter_track_test';
function resolveTestFlag(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('test');
    if (q === '1') localStorage.setItem(TEST_FLAG_KEY, '1');
    else if (q === '0') localStorage.removeItem(TEST_FLAG_KEY);
    return localStorage.getItem(TEST_FLAG_KEY) === '1';
  } catch { return false; }
}
const IS_TEST = resolveTestFlag();
// 导出供 UI 提示「当前为自测模式」用（可选）
export const isTestSession = () => IS_TEST;

// ─── 全局游戏语言 ───
// 游戏是中英双版（同一份代码内切换），埋点要带「事件发生时的当前语言」，
// 看板才能把中文版 / 英文版的游玩数据分开统计。由 App 在 lang 变化时调用 setTrackLang 同步。
let gameLang: 'zh' | 'en' = 'zh';
export function setTrackLang(lang: 'zh' | 'en') { gameLang = lang; }

// 端点占位：后端给地址后填 .env 的 VITE_TRACK_URL
const TRACK_URL = import.meta.env.VITE_TRACK_URL || '/api/track';

// ─── 本地环境判定 ───
// localhost / 127.x / ::1 / 内网 IP 一律视为「本地测试」，绝不上报。
// 关键：这覆盖了 npm run dev、npm run preview、本地直接跑 dist 三种情况——
// 它们里 import.meta.env.DEV 不一定为 true（preview / 本地跑 dist 是生产构建，DEV=false），
// 单靠 DEV 门挡不住，会把本地自测数据发进线上库，所以再按 hostname 兜底。
function isLocalEnv(): boolean {
  try {
    const h = location.hostname;
    return (
      h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' ||
      h.endsWith('.local') ||
      /^192\.168\./.test(h) || /^10\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)   // 172.16.0.0 – 172.31.255.255
    );
  } catch { return false; }
}
export const isLocal = () => isLocalEnv();

// 演示/调试开关：=true 时只 console.log 不真发，演示不依赖后端。
// ⚠️ 关键：dev 模式 / 本地环境（localhost·内网）一律强制只打印不真发。
// 原因①：React StrictMode 在 dev 下会把每个 effect 跑两遍，dev 直发会灌双倍污染看板。
// 原因②：preview / 本地跑 dist 是生产构建（DEV=false），但仍是自测，不该进线上库。
// 只有真正部署到线上域名的正式构建才上报。
const DEMO = import.meta.env.DEV || isLocalEnv() || import.meta.env.VITE_TRACK_DEMO === 'true';

// 固定枚举，避免各处拼错字符串
export type SectionName =
  | 'main' | 'storybook' | 'intro' | 'parkour' | 'story' | 'gallery' | 'egg';
export type Stage =
  | 'parkour' | 'npc1' | 'npc2' | 'npc3' | 'fakeMoon' | 'story';

export function track(event: string, payload: Record<string, any> = {}) {
  if (DEMO) { console.log('[track]', event, payload, IS_TEST ? '(test)' : ''); return; } // 演示/调试：只打印不真发
  const body = JSON.stringify({
    sessionId,
    event,
    gameLang,                    // 事件发生时的游戏语言（zh/en），看板按此分中英版
    ...(IS_TEST ? { test: 1 } : {}),  // 自测浏览器标记，看板默认剔除
    ...payload,
    ts: Date.now(),
  });
  try {
    // 关页面时用 sendBeacon 兜底（fetch 可能被浏览器中断），平时用 fetch
    if (event === 'page_unload' && navigator.sendBeacon) {
      navigator.sendBeacon(TRACK_URL, body);
    } else {
      fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {}); // 上报失败静默，绝不影响游戏体验
    }
  } catch { /* 静默 */ }
}

// 关页面/切后台时，用 sendBeacon 强制走 beacon（绕过 event 名判断），兜底最后一段停留时长
export function trackBeacon(event: string, payload: Record<string, any> = {}) {
  if (DEMO) { console.log('[track:beacon]', event, payload, IS_TEST ? '(test)' : ''); return; }
  try {
    const body = JSON.stringify({
      sessionId, event, gameLang,
      ...(IS_TEST ? { test: 1 } : {}),
      ...payload, ts: Date.now(),
    });
    if (navigator.sendBeacon) navigator.sendBeacon(TRACK_URL, body);
  } catch { /* 静默 */ }
}

// 整局只该上报一次的漏斗事件（如 game_start）用这个：本会话内同名事件只发一次。
// 双保险：即便组件在同一次页面会话里被重挂（导致空依赖 effect 再跑），也不会重复计数。
const _firedOnce = new Set<string>();
export function trackOnce(event: string, payload: Record<string, any> = {}) {
  if (_firedOnce.has(event)) return;
  _firedOnce.add(event);
  track(event, payload);
}
