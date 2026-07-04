// src/components/parkour/config.ts
// 跑酷场景「视觉/画质 + 布局」配置常量集中处——从 ParkourScene.tsx 顶部 VISUAL CONFIG 块抽出。
// 纯数据/配置，无 JSX：供 Scenery / Character / CameraSkyMoon 及 ParkourScene 主组件共用。
// 想手动微调画质（灯光/天空/材质色/花草密度）或布局（出生点/地形对齐）都改这里。

import type { Vec2 } from '../parkourConstants';
import { publicAssetUrl } from '../../lib/publicAssetUrl';

// ── 灯光 ─────────────────────────────────────────────────────────
export const LIGHTING = {
  // 半球光：天空色(顶部冷蓝天光) + 地面色(底部反弹光)。
  // ground 偏黄绿(#8FDC5A)且强：暗部接收地面反弹的暖绿光 → 阴影带蓝绿而非死灰，
  // 与暖阳形成冷暖对比，森林像被阳光灌满。这是 Sky/Nintendo 系治愈感的关键。
  hemi: { sky: '#BFEEFF', ground: '#8FDC5A', intensity: 1.6 },
  // 主阳光（带投影）— 暖奶黄(#FFF2B8)，左上前方斜射（upper-left front），温暖日光感
  sun:  { color: '#FFF2B8', position: [-50, 80, 40] as [number, number, number], intensityDay: 2.8 },
  // 对侧冷补光（无投影）：从阳光对侧打淡蓝光，软化暗部、暗部带冷调，立体而不脏
  fill: { color: '#BFE0FF', position: [55, 45, -35] as [number, number, number], intensity: 0.7 },
  // 月光
  moon: { color: '#9FB6FF', position: [-20, 30, -60] as [number, number, number] },
};

// ── 天空 / 雾 预设 ───────────────────────────────────────────────
// 天穹为三色渐变球（顶/中/地平线），shader 平滑过渡无 banding；饱和度已较卡通天空降约 10-15%，
// 靠提亮 + bloom 增加大气辉光感，而非提饱和——天空只做发光背景，不与森林抢视觉焦点。
// 大气透视用「线性雾」而非 exp2：linear fog 在 near 之前【完全无雾】，能保证前景绝对干净、
// 饱和、清晰，只在远处渐隐——正是参考图「有纵深、无可见雾」的效果。
//   near=65：65 单位内 0 雾（前景的草/路/角色/红花/近树全清晰）。
//   far=180：到 180 单位完全融入雾色；中景(65~90)只有很淡的霾，远景(90~150)清晰渐隐。
// 注：near/far 是世界长度量，世界已按 1/ACTOR_SCALE 放大，故这里用放大后的世界单位直接给。
export const SKY = {
  day: {
    skyTop:    '#53B9FF', // 顶部
    skyMid:    '#7AD7FF', // 中段
    skyHorizon:'#D9FAFF', // 近地平线（明亮、阳光感）
    fogColor:  '#CFF9FF', // 阳光感空气，非灰雾；接近地平线天色 → 远景融入天空
    fogNear:   130,       // 此距离内完全无雾（前景干净）
    fogFar:    360,       // 此距离起完全融入雾色（远景渐隐）
  },
  dusk:  { skyTop: '#3E78B0', skyMid: '#E89A5C', skyHorizon: '#F6C98E', fogColor: '#C97B86' },
  night: { skyTop: '#060B22', skyMid: '#0B1538', skyHorizon: '#243a6b', fogColor: '#16224F' },
};

// ── 地形材质 CONFIG — 按材质名匹配；SpruceTreeLeaf 需再按高度分流 ───────────────
// 详见 terrain-material-map.md。关键坑：SpruceTreeLeaf 这一个材质名被用在两种网格上——
// 贴地的大地面（草地）和高处的松树冠，必须靠世界 Y 高度区分，光按名字会把地面也染成松树色。
// 不在此列的（树干 Green.506/.507、SpruceTreeTrunk、NURBS路径、贴图驱动 Material_0xx）保持原样。
export const TERRAIN_MATS = {
  // 圆形树丛叶（Green.NNN，排除树干 .506/.507）— 鲜柠檬绿，阳光穿透感
  roundLeaf:  { color: '#9EEA2F', roughness: 0.8,  metalness: 0 },
  // 松树冠（SpruceTreeLeaf.* 中位于高处的）— 青绿/teal，与圆树冷暖对比，奇幻森林感
  spruceLeaf: { color: '#18B982', roughness: 0.85, metalness: 0 },
  // 地面草地（SpruceTreeLeaf.* 中贴地的大网格）— 指定色（浅黄绿）
  grass:      { color: '#C2E282', roughness: 0.85, metalness: 0 },
  // 岩石 — 浅蓝灰，干净柔和，避免写实深灰
  rock:       { color: '#BFD2D8', roughness: 0.9,  metalness: 0 },
  // 石头路面 — 奶油暖黄，作为画面暖色锚点
  stone:      { color: '#F5C873', roughness: 0.82, metalness: 0 },
  // 云朵 — 偏冷白，干净
  cloud:      { color: '#EEF6FF', roughness: 1.0,  metalness: 0 },
};
// SpruceTreeLeaf 高度分流阈值（世界 Y 质心；box.setFromObject 已含 autoScale+offset）：
// 2026-07 实测 scene-terrain-opt.glb —— 贴地草地("地形2"网格)世界 cy ≈ -4.2~-2.8，
// 松树冠(SpruceTreeLeaf.00x)世界 cy ≈ 0.05~1.19，两者间隙约 2.86。取 -1 落在间隙正中偏下。
// ⚠️旧值 3 高于所有网格 → 全部判成草地 → 松树与草地同色。改阈值前务必先跑 scripts/measure-terrain-heights.mjs。
export const SPRUCE_GROUND_MAX_Y = -1;

// 红花（地形内置纯红材质 #e70008 的网格，原本过大抢戏）整体缩放系数 → 降为稀有小点缀。
export const RED_FLOWER_SCALE = 0.3;

// ── 松树冠按世界 Z 深度分色 ───────────────────────────────────────────────────
// 松树冠在地形里是一整块合并网格（无法逐棵改 scale/间距），但可在 shader 里按「世界 Z 深度」
// 做色相渐变：近端(出生点侧,z 大)深青绿 → 远端(终点/树墙侧,z 小)浅蓝青、低对比，再叠加按 X 的
// 轻微抖动打散「整片同色」。配合既有雾(远树更淡) → 近/中/远三档松树观感，不靠改模型。
export const PINE_DEPTH = {
  near:  '#63CB68', // 近端：松树冠指定色（草绿）
  far:   '#63CB68', // 远端：同色（不再做近远色差，整片统一为指定色）
  zNear: 70,        // 世界 Z ≥ 此值 → 纯近端色
  zFar:  -30,       // 世界 Z ≤ 此值 → 纯远端色
  variation: 0.08,  // 按 X 的随机色相抖动幅度（加大，打散整片同色）
};

// ── 散布植被着色 — 代码散布的圆树/灌木（带贴图），clone 材质后用 color 把整体色相拉到调色板 ──
// 圆树 = 鲜柠檬绿（与地形圆树丛同色系）；灌木 = 偏青绿，比草更冷一档，从地面里分离出来。
export const SCATTER_TINT = {
  round: '#9EEA2F', // 圆树：柠檬绿
  bush:  '#35C99A', // 灌木：青绿（比草更 cyan，清晰分层）
};

// 地面花草 GLB（Tripo 扫描原模型 ~56MB/998K顶点，已 gltf-transform optimize 到 ~85KB/1~2K顶点、贴图256、无Draco）。
// 用 InstancedMesh 散布做地面细节：真实花朵几何，比纯色小球更接近参考图的丰富感。
export const FLOWER_DAISY_URL = publicAssetUrl('/3d-flower/optimized/daisy.glb');
export const FLOWER_YELLOW_URL = publicAssetUrl('/3d-flower/optimized/yellow-flower.glb');
export const PLANT_GREEN_URL = publicAssetUrl('/3d-flower/optimized/green-plant.glb');

// ── 地面细节散布 — 大量小物件让地面"活起来"（小花/草丛），程序生成、InstancedMesh ──
// 参考图的丰富感来自「很多小东西」而非「几个大东西」。每类一个 InstancedMesh = 1 draw call。
// 全程不在渲染期 random（模块级 LCG 一次性生成并缓存），避开石板路与出生点，地形就绪后吸附地面。
// 花色层级（贴合参考图）：白/黄/绿最多，蓝/紫次之做点缀，红不在此（红来自地形 GLB）。
export const GROUND_DETAIL = {
  grassTuft:    { color: '#7FD23C', emissive: '#000000', count: 320, scale: [0.18, 0.34] as [number, number] },
  whiteFlower:  { color: '#F7FFF2', emissive: '#FFFFFF', count: 280, scale: [0.10, 0.16] as [number, number] },
  yellowFlower: { color: '#FFDD4A', emissive: '#FFE680', count: 190, scale: [0.10, 0.16] as [number, number] },
  blueFlower:   { color: '#5BA3FF', emissive: '#2E6BD6', count: 95,  scale: [0.09, 0.14] as [number, number] },
  purpleFlower: { color: '#B07CFF', emissive: '#6E3FD6', count: 80,  scale: [0.09, 0.14] as [number, number] },
};

// GLB 花草细节：真实花朵几何（雏菊/黄花/绿植），InstancedMesh 散布。比纯色小球更丰富、更接近参考图。
// scale 是世界单位目标高度（模型本体≈1 单位高）：全部压在角色膝盖以下(角色≈1.7×ACTOR_SCALE)。
// 偏向路边/空地集中（详见散布逻辑的 nearPathBias），让"路两侧丰富"，不铺满全图。
export const FLOWER_GLB = {
  daisy:  { url: FLOWER_DAISY_URL,  count: 70, scale: [0.55, 0.85] as [number, number] },
  yellow: { url: FLOWER_YELLOW_URL, count: 55, scale: [0.55, 0.85] as [number, number] },
  plant:  { url: PLANT_GREEN_URL,   count: 80, scale: [0.50, 0.80] as [number, number] },
};

export const TERRAIN_URL = publicAssetUrl('/model-site/scene-terrain-opt.glb');
// 程序化散布的额外树林模型（让场景从「公园」变「森林」）：圆树 + 灌木。
// optimized/ 版：原模型每棵 22~27 万顶点 + 4 张 2K 贴图(89MB显存/个) → 95 棵严重卡。
// 已 weld+simplify 减面到 ~4~5 万顶点，贴图 resize 512+webp(显存 89MB→5.6MB/个)。?v=2 强制刷新缓存。
export const TREE_ROUND_URL = publicAssetUrl('/3d-tree/optimized/tree1-round.glb');
export const BUSH_URL = publicAssetUrl('/3d-tree/optimized/bush.glb');
// idle.glb 单文件自包含：同一网格同一骨骼，内含 4 条动画。
// 用它的 #1=站立、#2=跑步，clip 与网格同源，绑定天然成立（避免跨文件绑定导致的 T-pose）。
export const CHARACTER_URL = publicAssetUrl('/main-character-other-position/idle.glb');
export const IDLE_CLIP_INDEX = 1; // 站立待机（≈4.27s，几乎不动）
export const RUN_CLIP_INDEX = 2;  // 跑步（≈0.67s，腿大幅摆动）
// 注：另有 #0≈走路、#3≈跳跃，备用。run-3/run.glb 已不再需要加载。

// 月亮模型
export const FAKE_MOON_URL = publicAssetUrl('/3d-moon/fake-moon.glb');
export const REAL_MOON_URL = publicAssetUrl('/3d-moon/real-moon.glb');

export const HEIGHT_SPLIT_Y = 1.2; // 世界 Y 质心阈值（castShadow 判断用）

export const DEBUG_MODE = false;

export const PLAYER_START: Vec2 = { x: -2.52, z: 111.68 }; // 出生点（用户调试面板确认过的位置）
// 地形对齐锚点：把"步道最近端"对到这个世界点。⚠️必须独立于 PLAYER_START——
// 否则改出生点时地形会跟着挪、角色永远黏在入口，等于没改。保持 (0,112) 即维持当前地形摆放，
// 让 PLAYER_START 可以自由设到路上任意一点（如本例的入口前方更居中处）。
export const TERRAIN_ANCHOR_TO: Vec2 = { x: 0, z: 112 };
// 地形落位微调（世界单位）。默认 0：代码已自动把"步道最近端"对齐到出生点并抬到脚底高度。
export const TERRAIN_X_OFFSET = 0;
export const TERRAIN_Y_OFFSET = 0;
export const TERRAIN_Z_OFFSET = 0;
// 角色脚底所在的世界高度：Character 的 group 钉死在 y=0，模型脚底≈本地原点。
// 步道表面会被抬到这个高度，让角色"踩"在石板上而不是悬空。
export const CHAR_FOOT_Y = 0;
