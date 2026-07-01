// src/components/parkourConstants.ts
// 跑酷场景的「纯数据 / 类型 / 工具函数」集中处——从 ParkourScene.tsx 抽出。
//
// ⚠️ 为什么单独一个文件：ParkourScene.tsx 是 React 组件模块（默认导出组件）。
//    React Fast Refresh 规定「一个模块混着导出组件和非组件值就无法安全热更」，
//    过去这些常量和组件同处一文件，导致每次改 ParkourScene 都触发
//    Could not Fast Refresh ("STAR_POSITIONS" export is incompatible) → 整块重挂载、
//    进度条/HUD 抖动、要硬刷新。抽到这个纯 TS 文件后，ParkourScene 只剩组件导出，
//    热更就干净了。改星星位置 / 缩放旋钮等仍在这里调，和以前一样。

export const SHOW_COORDS = false;

// ── 演员层总缩放 ────────────────────────────────────────────────────────────
// 「森林显得大」本质是「熊 ÷ 树」比例问题：不动地形（动它会让石板路变形、星星/NPC
// 掉出路面），而是把所有「演员」（主角 + 星星 + NPC + 障碍 + 假月亮）按此系数整体缩小，
// 世界坐标全不变 → 路/星星/NPC 对齐零破坏，视觉上等价于「世界放大 1/ACTOR_SCALE 倍」。
// 0.125 = 场景显得大 8 倍（比原 0.5 再放大两轮）。想更大再调小、想小回 0.25。
// 注：移动速度 PLAYER_SPEED 已在 SectionParkour 里乘了它，缩小后步幅/速度同步变慢，跑步不打滑。
export const ACTOR_SCALE = 0.125;

// ── ⭐ 星星大小旋钮（只调这一个数）────────────────────────────────────────────
// 想让星星更大就把这个数调大，更小就调小。直接改这里即可，不用动别处。
//   3.2 ≈ 比最初大一倍   |   4.0 ≈ 大 2.5 倍（当前默认）   |   6.0 = 很大很显眼
// 注：星星已随父层 ACTOR_SCALE 一起缩放，这里是最终乘数，不要再乘 ACTOR_SCALE。
export const STAR_SCALE = 4.0;

// ── 开放世界坐标系 ──────────────────────────────────────────────────────────
// 玩家拥有真实世界坐标 {x,z}，由方向键八向移动驱动；物体钉死在地图固定点。
export type Vec2 = { x: number; z: number };
export type NpcPos = { x: number; y?: number; z: number }; // y 非空时手动覆盖，为空时射线吸附
export type DebugInfo = { player: Vec2; playerY: number; npcDist: [number, number, number] };
export type WorldPrompt =
  | { kind: 'star'; id: number; text: string; first: boolean; position: Vec2 }
  | { kind: 'box'; id: number; text: string; position: Vec2 }
  | null;
// 天空阶段：白天 → 黄昏（假月亮过场后）→ 夜晚（真月亮升起）。SkyAndLights 按此 lerp 过渡。
export type SkyPhase = 'day' | 'dusk' | 'night';

// ── stars — 钥匙，钉死世界坐标 {x,z}，2D 平面距离收集 ─────────────────────────
export type StaticCollectible = {
  id: number;
  type: 'star';
  x: number;
  z: number;
  isRequired?: boolean;
  y?: number; // 非空时固定高度（水面星用），为空时跟随地形
};

// ── 水面星星 — 可收集，浮在小溪水面固定高度 ─────────────────────────────────────
// y 字段固定高度（不跟地形），调试面板水面星 Tab 可实时拖 slider 精确贴水面。
// 调好后把最终 x/y/z hardcode 回这里。id 从 20 起避开 STAR_POSITIONS 的 0~13。
export type CreekStarPos = { x: number; y: number; z: number };
export const CREEK_STAR_POSITIONS: CreekStarPos[] = [
  { x: -2.5, y: -0.15, z: 111 },
  { x: -1.5, y: -0.15, z: 110 },
  { x: -3.5, y: -0.15, z: 109 },
  { x: -2.0, y: -0.15, z: 108 },
  { x: -1.0, y: -0.15, z: 107 },
  { x: -3.0, y: -0.15, z: 106 },
  { x: -2.5, y: -0.15, z: 105 },
  { x: -1.5, y: -0.15, z: 104 },
  { x: -3.5, y: -0.15, z: 103 },
];
// 转成 StaticCollectible[] 供 StarsGroup 统一处理（收集逻辑完全一致）
export function creekStarsAsCollectibles(positions: CreekStarPos[]): StaticCollectible[] {
  return positions.map((p, i) => ({ id: 20 + i, type: 'star' as const, x: p.x, z: p.z, y: p.y }));
}

// 9 颗「任务星」+ 5 颗「保险星」，全部贴可见石板路、沿 +z→-z 铺开。
// ⭐ 想自己调星星位置：直接改下面每颗的 x（左负右正）/ z（越大越靠近出生点、越小越远）。
// 共 14 颗能收集，但进度条封顶 9（收满 9 即过关）——多放几颗是给 6 岁小孩兜底，沿路跟着星走就不会卡关。
// 想加更多保险星：照着 { id: 14.., type:'star', x, z } 往后加即可（id 别重复）。
export const STAR_POSITIONS: StaticCollectible[] = [
  // 段1（NPC1 之前）—— 第一颗就在出生点正前方，出门就见
  { id: 0, type: 'star', x: 2, z: 89 },
  { id: 1, type: 'star', x: 6, z: 85 },
  { id: 9, type: 'star', x: -2, z: 76 },   // 保险星：填 85→68 空当
  { id: 2, type: 'star', x: 2, z: 68 },
  { id: 10, type: 'star', x: -1, z: 56 },  // 保险星：填 68→44 大空当
  // 段2（NPC2 之前）
  { id: 3, type: 'star', x: -3, z: 44 },
  { id: 11, type: 'star', x: 1, z: 36 },   // 保险星：填 44→28 空当
  { id: 4, type: 'star', x: 0, z: 28 },
  { id: 5, type: 'star', x: -6, z: 16 },
  { id: 12, type: 'star', x: 2, z: 6 },    // 保险星：填 16→-4 大空当（放路右侧，避开 NPC2）
  // 段3（NPC3 之前）
  { id: 6, type: 'star', x: -9, z: -4 },
  { id: 13, type: 'star', x: -11, z: -22 }, // 保险星：填 -14→-31 空当
  { id: 7, type: 'star', x: -12, z: -14 },
  { id: 8, type: 'star', x: -8, z: -31 },
];
