import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
// 非组件的常量/类型/工具已抽到 parkourConstants.ts —— 让本文件只导出组件，保住 Fast Refresh 边界。
import {
  ACTOR_SCALE, SHOW_COORDS, STAR_POSITIONS, CREEK_STAR_POSITIONS,
  creekStarsAsCollectibles, PK, TERRAIN_SIZE,
  NPC_URLS, NPC_SCALES, NPC_ROTATIONS, NPC_POSITIONS,
  type Vec2, type NpcPos, type DebugInfo, type WorldPrompt, type SkyPhase,
  type StaticCollectible, type CreekStarPos,
} from './parkourConstants';
// 共享运行时（模块级可变 ref / 单例射线 / 地面吸附）与 3D 小部件、障碍子系统均已拆分。
import {
  occluderRef, playerYRef, snapGroundY,
  _terrainCaster, _terrainDown, _terrainOrigin,
} from './parkour/runtime';
import { StarMesh, FloatingLabel, TeachingPointer, StarGuideMarker } from './parkour/widgets';
import { ObstacleField, type ActiveObstacle } from './parkour/Obstacles';

// ════════════════════════════════════════════════════════════════
//  VISUAL CONFIG — 所有画质参数集中在这里，方便手动微调
// ════════════════════════════════════════════════════════════════

// ── 灯光 ─────────────────────────────────────────────────────────
const LIGHTING = {
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
const SKY = {
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
const TERRAIN_MATS = {
  // 圆形树丛叶（Green.NNN，排除树干 .506/.507）— 鲜柠檬绿，阳光穿透感
  roundLeaf:  { color: '#9EEA2F', roughness: 0.8,  metalness: 0 },
  // 松树冠（SpruceTreeLeaf.* 中位于高处的）— 青绿/teal，与圆树冷暖对比，奇幻森林感
  spruceLeaf: { color: '#18B982', roughness: 0.85, metalness: 0 },
  // 地面草地（SpruceTreeLeaf.* 中贴地的大网格）— 黄绿，与树色明显区分
  grass:      { color: '#8BDC32', roughness: 0.85, metalness: 0 },
  // 岩石 — 浅蓝灰，干净柔和，避免写实深灰
  rock:       { color: '#BFD2D8', roughness: 0.9,  metalness: 0 },
  // 石头路面 — 奶油暖黄，作为画面暖色锚点
  stone:      { color: '#F5C873', roughness: 0.82, metalness: 0 },
  // 云朵 — 偏冷白，干净
  cloud:      { color: '#EEF6FF', roughness: 1.0,  metalness: 0 },
};
// SpruceTreeLeaf 高度分流阈值（未缩放模型坐标）：贴地草地≈0.03、高处松树冠≈8.26，取中间值。
const SPRUCE_GROUND_MAX_Y = 3;

// 红花（地形内置纯红材质 #e70008 的网格，原本过大抢戏）整体缩放系数 → 降为稀有小点缀。
const RED_FLOWER_SCALE = 0.3;

// ── 松树冠按世界 Z 深度分色 ───────────────────────────────────────────────────
// 松树冠在地形里是一整块合并网格（无法逐棵改 scale/间距），但可在 shader 里按「世界 Z 深度」
// 做色相渐变：近端(出生点侧,z 大)深青绿 → 远端(终点/树墙侧,z 小)浅蓝青、低对比，再叠加按 X 的
// 轻微抖动打散「整片同色」。配合既有雾(远树更淡) → 近/中/远三档松树观感，不靠改模型。
const PINE_DEPTH = {
  near:  '#2FD89A', // 近端：明亮青绿（提亮，去掉原来的暗沉）
  far:   '#A7EBDD', // 远端：浅蓝青（更亮更蓝、低对比，融入雾色）
  zNear: 70,        // 世界 Z ≥ 此值 → 纯近端色
  zFar:  -30,       // 世界 Z ≤ 此值 → 纯远端色
  variation: 0.08,  // 按 X 的随机色相抖动幅度（加大，打散整片同色）
};

// ── 散布植被着色 — 代码散布的圆树/灌木（带贴图），clone 材质后用 color 把整体色相拉到调色板 ──
// 圆树 = 鲜柠檬绿（与地形圆树丛同色系）；灌木 = 偏青绿，比草更冷一档，从地面里分离出来。
const SCATTER_TINT = {
  round: '#9EEA2F', // 圆树：柠檬绿
  bush:  '#35C99A', // 灌木：青绿（比草更 cyan，清晰分层）
};

// 地面花草 GLB（Tripo 扫描原模型 ~56MB/998K顶点，已 gltf-transform optimize 到 ~85KB/1~2K顶点、贴图256、无Draco）。
// 用 InstancedMesh 散布做地面细节：真实花朵几何，比纯色小球更接近参考图的丰富感。
const FLOWER_DAISY_URL = '/3d-flower/optimized/daisy.glb';
const FLOWER_YELLOW_URL = '/3d-flower/optimized/yellow-flower.glb';
const PLANT_GREEN_URL = '/3d-flower/optimized/green-plant.glb';

// ── 地面细节散布 — 大量小物件让地面"活起来"（小花/草丛），程序生成、InstancedMesh ──
// 参考图的丰富感来自「很多小东西」而非「几个大东西」。每类一个 InstancedMesh = 1 draw call。
// 全程不在渲染期 random（模块级 LCG 一次性生成并缓存），避开石板路与出生点，地形就绪后吸附地面。
// 花色层级（贴合参考图）：白/黄/绿最多，蓝/紫次之做点缀，红不在此（红来自地形 GLB）。
const GROUND_DETAIL = {
  grassTuft:    { color: '#7FD23C', emissive: '#000000', count: 320, scale: [0.18, 0.34] as [number, number] },
  whiteFlower:  { color: '#F7FFF2', emissive: '#FFFFFF', count: 280, scale: [0.10, 0.16] as [number, number] },
  yellowFlower: { color: '#FFDD4A', emissive: '#FFE680', count: 190, scale: [0.10, 0.16] as [number, number] },
  blueFlower:   { color: '#5BA3FF', emissive: '#2E6BD6', count: 95,  scale: [0.09, 0.14] as [number, number] },
  purpleFlower: { color: '#B07CFF', emissive: '#6E3FD6', count: 80,  scale: [0.09, 0.14] as [number, number] },
};

// GLB 花草细节：真实花朵几何（雏菊/黄花/绿植），InstancedMesh 散布。比纯色小球更丰富、更接近参考图。
// scale 是世界单位目标高度（模型本体≈1 单位高）：全部压在角色膝盖以下(角色≈1.7×ACTOR_SCALE)。
// 偏向路边/空地集中（详见散布逻辑的 nearPathBias），让"路两侧丰富"，不铺满全图。
const FLOWER_GLB = {
  daisy:  { url: FLOWER_DAISY_URL,  count: 70, scale: [0.55, 0.85] as [number, number] },
  yellow: { url: FLOWER_YELLOW_URL, count: 55, scale: [0.55, 0.85] as [number, number] },
  plant:  { url: PLANT_GREEN_URL,   count: 80, scale: [0.50, 0.80] as [number, number] },
};

const TERRAIN_URL = '/model-site/scene-terrain-opt.glb?v=20260624-terrain';
// 程序化散布的额外树林模型（让场景从「公园」变「森林」）：圆树 + 灌木。
// optimized/ 版：原模型每棵 22~27 万顶点 + 4 张 2K 贴图(89MB显存/个) → 95 棵严重卡。
// 已 weld+simplify 减面到 ~4~5 万顶点，贴图 resize 512+webp(显存 89MB→5.6MB/个)。?v=2 强制刷新缓存。
const TREE_ROUND_URL = '/3d-tree/optimized/tree1-round.glb?v=3';
const BUSH_URL = '/3d-tree/optimized/bush.glb?v=3';
// idle.glb 单文件自包含：同一网格同一骨骼，内含 4 条动画。
// 用它的 #1=站立、#2=跑步，clip 与网格同源，绑定天然成立（避免跨文件绑定导致的 T-pose）。
const CHARACTER_URL = '/main-character-other-position/idle.glb?v=20260627-uncompressed';
const IDLE_CLIP_INDEX = 1; // 站立待机（≈4.27s，几乎不动）
const RUN_CLIP_INDEX = 2;  // 跑步（≈0.67s，腿大幅摆动）
// 注：另有 #0≈走路、#3≈跳跃，备用。run-3/run.glb 已不再需要加载。

// 月亮模型
const FAKE_MOON_URL = '/3d-moon/fake-moon.glb';
const REAL_MOON_URL = '/3d-moon/real-moon.glb';

const HEIGHT_SPLIT_Y = 1.2; // 世界 Y 质心阈值（castShadow 判断用）

const DEBUG_MODE = false;

const PLAYER_START: Vec2 = { x: -2.52, z: 111.68 }; // 出生点（用户调试面板确认过的位置）
// 地形对齐锚点：把"步道最近端"对到这个世界点。⚠️必须独立于 PLAYER_START——
// 否则改出生点时地形会跟着挪、角色永远黏在入口，等于没改。保持 (0,112) 即维持当前地形摆放，
// 让 PLAYER_START 可以自由设到路上任意一点（如本例的入口前方更居中处）。
const TERRAIN_ANCHOR_TO: Vec2 = { x: 0, z: 112 };
// 地形落位微调（世界单位）。默认 0：代码已自动把"步道最近端"对齐到出生点并抬到脚底高度。
const TERRAIN_X_OFFSET = 0;
const TERRAIN_Y_OFFSET = 0;
const TERRAIN_Z_OFFSET = 0;
// 角色脚底所在的世界高度：Character 的 group 钉死在 y=0，模型脚底≈本地原点。
// 步道表面会被抬到这个高度，让角色"踩"在石板上而不是悬空。
const CHAR_FOOT_Y = 0;

// ── 松树冠深度分色 shader 补丁 ────────────────────────────────────────────────
// 给松树冠材质注入 onBeforeCompile：vertex 阶段把世界坐标传给 fragment，fragment 按世界 Z
// 在近端深青绿 ↔ 远端浅蓝青之间 mix，并按世界 X 做轻微抖动 → 远树更亮更蓝、整片不再同色。
const _pineNear = new THREE.Color(PINE_DEPTH.near).convertSRGBToLinear();
const _pineFar  = new THREE.Color(PINE_DEPTH.far).convertSRGBToLinear();
function patchPineDepth(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPineNear = { value: _pineNear };
    shader.uniforms.uPineFar  = { value: _pineFar };
    shader.uniforms.uZNear    = { value: PINE_DEPTH.zNear };
    shader.uniforms.uZFar     = { value: PINE_DEPTH.zFar };
    shader.uniforms.uVar      = { value: PINE_DEPTH.variation };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosPine;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWorldPosPine = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosPine;\nuniform vec3 uPineNear;\nuniform vec3 uPineFar;\nuniform float uZNear;\nuniform float uZFar;\nuniform float uVar;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float td = clamp((vWorldPosPine.z - uZFar) / (uZNear - uZFar), 0.0, 1.0); // 0=远 1=近
        vec3 pineCol = mix(uPineFar, uPineNear, td);
        float jitter = (fract(sin(vWorldPosPine.x * 12.9898) * 43758.5453) - 0.5) * uVar;
        pineCol += jitter;
        diffuseColor.rgb = pineCol;
      }`);
  };
  mat.needsUpdate = true;
}

// ── terrain model — 静态单块大地图（去掉了滚动 / 循环）────────────────────────
function TerrainModel() {
  const { scene } = useGLTF(TERRAIN_URL);
  const groupRef = useRef<THREE.Group>(null!);

  const [clonedScene, scale, offset] = useMemo(() => {
    const cloned = scene.clone();
    cloned.updateMatrixWorld(true);

    // 1) 整体包围盒 → 自动缩放，使最长水平轴铺满 TERRAIN_SIZE
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longestAxis = Math.max(size.x, size.z);
    const autoScale = longestAxis > 0 ? TERRAIN_SIZE / longestAxis : 1;

    // 2) 找"步道"石板(Blender 里名为 "NURBS 路径" 的节点)。模型是立体场景，
    //    步道不在整块地图几何中心；要让玩家出生点正好落在石板路上，按步道而非 bbox 对齐。
    //    只取很薄(dy<0.4)的石板，排除路边立着的大块装饰，避免污染高度/中心。
    //    注：此地形的"路"是 102 块石板铺成的一大片碎石区(非窄道)，单 z 切片取平均会
    //    掉进两簇石板间的草缝 → 改用"近端 1/3 区域石板质心"代表入口走向，稳得多。
    const slabs: { cx: number; cz: number; topY: number }[] = [];
    cloned.traverse(obj => {
      if (!obj.name || !obj.name.startsWith('NURBS')) return;
      const b = new THREE.Box3().setFromObject(obj);
      if (!isFinite(b.min.x)) return;
      if (b.max.y - b.min.y > 0.4) return; // 厚的不是地面石板
      slabs.push({
        cx: (b.min.x + b.max.x) / 2,
        cz: (b.min.z + b.max.z) / 2,
        topY: b.max.y,
      });
    });

    // 入口锚点：把"步道最近端（+z 最大那块石板）"对齐到出生点，保证入口=出生点、
    // 整条路都在玩家前方可达。⚠️玩家后退上限只有 z=116（出生点 112 仅 +4 格），
    // 若锚点用"区域质心"会把入口推到墙后 20+ 格、永远够不着 → 必须锚最近端。
    // X 用最近端那一小簇石板（z 顶端 0.5 内）的质心，让出生点横向落在入口路面上。
    let anchorX: number, anchorZ: number, surfaceTopY: number;
    if (slabs.length) {
      const zMax = Math.max(...slabs.map(s => s.cz));
      const entry = slabs.filter(s => s.cz >= zMax - 0.5);
      const seg = entry.length ? entry : slabs;
      anchorX = seg.reduce((a, s) => a + s.cx, 0) / seg.length;
      anchorZ = zMax; // Z 锚最近端，入口正好落在出生点，不被边界 clamp 挡住
      surfaceTopY = Math.max(...seg.map(s => s.topY));
    } else {
      // 没找到步道 → 退回整块 bbox 中心 + 顶面（保证不悬空，至少站在地图上）
      const c = new THREE.Vector3();
      box.getCenter(c);
      anchorX = c.x; anchorZ = c.z; surfaceTopY = box.max.y;
    }

    // 3) 落位：把"步道入口锚点"平移到 TERRAIN_ANCHOR_TO（地形锚点，独立于出生点），
    //    并把步道表面抬到角色脚底高度 CHAR_FOOT_Y —— 角色就踩在石板上，不再悬空。
    //    世界坐标 = offset + autoScale * 模型坐标，故 offset = 目标 - autoScale*锚点。
    const worldOffset: [number, number, number] = [
      TERRAIN_ANCHOR_TO.x - autoScale * anchorX + TERRAIN_X_OFFSET,
      CHAR_FOOT_Y - autoScale * surfaceTopY + TERRAIN_Y_OFFSET,
      TERRAIN_ANCHOR_TO.z - autoScale * anchorZ + TERRAIN_Z_OFFSET,
    ];

    return [cloned, autoScale, worldOffset] as const;
  }, [scene]);

  useEffect(() => {
    const box = new THREE.Box3();
    const patched = new WeakSet<THREE.Material>();
    clonedScene.updateMatrixWorld(true);
    clonedScene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      box.setFromObject(mesh);
      mesh.castShadow = (box.max.y + box.min.y) / 2 > HEIGHT_SPLIT_Y;

      // 红花：按【红色检测】匹配（名字 Material_0.* 其实是圆树，已确认）。真红花材质纯红 #e70008。
      const fm = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
      const isRed = !!fm?.color && fm.color.r > 0.4 && fm.color.g < 0.18 && fm.color.b < 0.18;
      if (isRed && !mesh.userData._redScaled) {
        mesh.scale.multiplyScalar(RED_FLOWER_SCALE); // 绕自身原点缩小，降为稀有小点缀
        mesh.userData._redScaled = true;
      }

      const applyMat = (m: THREE.Material, slot: number): THREE.Material => {
        const sm = m as THREE.MeshStandardMaterial;
        if (!('color' in sm)) return m;
        const n = sm.name;
        const cy = (box.max.y + box.min.y) / 2;

        // SpruceTreeLeaf 同名材质身兼两职：贴地大网格=草地，高处=松树冠。必须按 mesh 高度分流，
        // 且 clone 材质后再赋色——否则若草地与松树冠共享同一材质实例，会互相覆盖（满地变松树色就是这么来的）。
        if (n.startsWith('SpruceTreeLeaf')) {
          const isCanopy = cy >= SPRUCE_GROUND_MAX_Y;
          const cfg = isCanopy ? TERRAIN_MATS.spruceLeaf : TERRAIN_MATS.grass;
          const c = sm.clone();
          c.color.setStyle(cfg.color).convertSRGBToLinear(); c.roughness = cfg.roughness; c.metalness = cfg.metalness;
          // 松树冠：注入 shader，按世界 Z 深度把 baseColor 从近端深青绿 → 远端浅蓝青渐变 + 按 X 抖动。
          if (isCanopy) patchPineDepth(c);
          c.needsUpdate = true;
          if (Array.isArray(mesh.material)) mesh.material[slot] = c; else mesh.material = c;
          return c;
        }

        // 其余材质同名即同色，处理一次即可（patched 去重，避免重复 set）
        if (patched.has(m)) return m;
        patched.add(m);
        if (sm.metalness > 0) sm.metalness = 0;
        const cfg = n.startsWith('Green.') && n !== 'Green.506' && n !== 'Green.507' ? TERRAIN_MATS.roundLeaf
          : n === 'Rock'           ? TERRAIN_MATS.rock
          : n === 'Stone'          ? TERRAIN_MATS.stone
          : n.startsWith('clouds') ? TERRAIN_MATS.cloud
          : null;
        if (cfg) {
          sm.color.setStyle(cfg.color).convertSRGBToLinear();
          sm.roughness  = cfg.roughness;
          sm.metalness  = cfg.metalness;
          // 地形内置云与程序云风格统一：轻微自发光，配 bloom 出柔光边
          if (n.startsWith('clouds')) {
            sm.emissive.set(CLOUD_MAT.emissive);
            sm.emissiveIntensity = CLOUD_MAT.emissiveIntensity;
          }
        } else if (n.startsWith('Material_0')) {
          sm.metalness = 0;
        }
        sm.needsUpdate = true;
        return m;
      };

      if (Array.isArray(mesh.material)) mesh.material.forEach((m, i) => applyMat(m, i));
      else if (mesh.material) applyMat(mesh.material, 0);
    });
  }, [clonedScene]);

  // 把整块地形登记为相机遮挡体：CameraRig 每帧对它做射线检测，
  // 主角被树/石挡住时把相机拉到遮挡物前方，主角始终可见。
  useEffect(() => {
    occluderRef.current = groupRef.current;
    return () => { occluderRef.current = null; };
  }, [clonedScene]);

  return (
    <group ref={groupRef} position={offset}>
      <primitive object={clonedScene} scale={scale} />
    </group>
  );
}

// ── clouds — 装饰，独立横向飘动 ──────────────────────────────────────────────
// z 放到出生点(116)前方近处 65~92 的高空(y 26~33)，让云出现在画面上方而非远处贴树线。
// 数量精简到 5 朵、分散在玩家前方上空，更白更聚拢、不挤在后面。
const CLOUD_DATA: Array<{ pos: [number, number, number]; spd: number }> = [
  { pos: [-35, 16, 68], spd: 0.38 },
  { pos: [ 22, 15, 73], spd: 0.45 },
  { pos: [ -8, 14, 79], spd: 0.30 },
  { pos: [ 38, 13, 84], spd: 0.52 },
  { pos: [ -2, 13, 86], spd: 0.35 },
];

// ── 云朵 — 圆润 storybook 风：亮白受光 + 底部淡蓝阴影 ──────────────────────────
// 顶部受暖阳偏亮(略带奶黄)，底部被半球光的蓝绿 ground 色染出柔和冷阴影 → 立体而不脏。
// 轻微 emissive 让云在 bloom 下边缘微微发光，柔和梦幻；roughness=1 全漫反射不反光。
const CLOUD_MAT = {
  color:    '#FBFEFF', // 主体近白（略离纯白，留 bloom 余量不死白）
  emissive: '#E8F4FF', // 自发微光：偏冷白，配 bloom 出柔光边
  emissiveIntensity: 0.25,
};

function Cloud({ pos, spd }: { pos: [number, number, number]; spd: number }) {
  const ref = useRef<THREE.Group>(null!);
  // 云朵大小：温和随高度微调，避免过大。z 已是正向近处，不再用旧的 z 公式。
  const s = 0.95 + (pos[1] - 14) * 0.025; // y∈[13,16] → s≈0.95~1.00
  useFrame((_st, d) => {
    if (!ref.current) return;
    ref.current.position.x += d * spd;
    if (ref.current.position.x > 45) ref.current.position.x = -45;
  });
  return (
    <group ref={ref} position={pos}>
      <mesh><icosahedronGeometry args={[1.8 * s, 1]} /><meshStandardMaterial color={CLOUD_MAT.color} emissive={CLOUD_MAT.emissive} emissiveIntensity={CLOUD_MAT.emissiveIntensity} roughness={1} metalness={0} fog={false} /></mesh>
      <mesh position={[ 2.2 * s, 0.4 * s, 0]}><icosahedronGeometry args={[1.3 * s, 1]} /><meshStandardMaterial color={CLOUD_MAT.color} emissive={CLOUD_MAT.emissive} emissiveIntensity={CLOUD_MAT.emissiveIntensity} roughness={1} metalness={0} fog={false} /></mesh>
      <mesh position={[-1.8 * s, 0.2 * s, 0]}><icosahedronGeometry args={[1.1 * s, 1]} /><meshStandardMaterial color={CLOUD_MAT.color} emissive={CLOUD_MAT.emissive} emissiveIntensity={CLOUD_MAT.emissiveIntensity} roughness={1} metalness={0} fog={false} /></mesh>
      <mesh position={[ 0.7 * s, 1.1 * s, 0]}><icosahedronGeometry args={[0.9 * s, 1]} /><meshStandardMaterial color={CLOUD_MAT.color} emissive={CLOUD_MAT.emissive} emissiveIntensity={CLOUD_MAT.emissiveIntensity} roughness={1} metalness={0} fog={false} /></mesh>
    </group>
  );
}

// ── character — 真实世界坐标移动 + 朝向随移动方向翻转 ─────────────────────────
// Character 是唯一写 playerPosRef 的组件（每帧积分 velocityRef）；其它组件只读。
// 地形跟随的共享 raycaster 已移到 parkour/runtime.ts（_terrainCaster / _terrainDown / _terrainOrigin）。

function Character({ velocityRef, playerPosRef, hitEffect, debugYRef }: {
  velocityRef: React.RefObject<Vec2>;
  playerPosRef: React.RefObject<Vec2>;
  hitEffect: string | null;
  debugYRef?: React.RefObject<number | null>;
}) {
  const { scene, animations } = useGLTF(CHARACTER_URL);
  const groupRef = useRef<THREE.Group>(null!);
  const headingRef = useRef(Math.PI);
  const wasMoving = useRef(false);
  const FADE = 0.25;
  const terrainYRef    = useRef(CHAR_FOOT_Y);
  const terrainTargetY = useRef(CHAR_FOOT_Y);
  const terrainSnapped = useRef(false);
  const terrainFrame   = useRef(0);

  const footOffset = useMemo(() => {
    if (!scene) return 0;
    const box = new THREE.Box3().setFromObject(scene);
    return isFinite(box.min.y) ? -box.min.y : 0;
  }, [scene]);

  useEffect(() => {
    scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }, [scene]);

  // ── 手搓 AnimationMixer，直接绑到 scene（619 发布包验证过的方式）─────────────
  // 不用 drei useAnimations：它把 mixer 绑在 groupRef、用 lazy getter + 自己的 useFrame，
  // 首帧绑定时序不可控，导致"出生即 T-pose、移动后才正常"。直接绑 scene 最稳。
  // 策略：idle + run 两个 action 都常驻播放（play 一次），靠每帧 lerp 权重切换，
  // 不用 crossFadeTo（它和自愈/时序互相打架）。权重和恒为 1 → 永远有动画驱动骨骼。
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const runActionRef  = useRef<THREE.AnimationAction | null>(null);
  const runWeightRef = useRef(0); // 0=纯idle 1=纯run，每帧朝目标 lerp

  useEffect(() => {
    if (!scene || !animations.length) return;
    const idleIdx = IDLE_CLIP_INDEX;
    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;
    const idleClip = animations[idleIdx] ?? animations[0];
    const runClip  = animations[RUN_CLIP_INDEX] ?? animations[0];
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    const run  = runClip  ? mixer.clipAction(runClip)  : null;
    idleActionRef.current = idle;
    runActionRef.current  = run;
    // 两个 action 都常驻播放，初始 idle 权重 1、run 权重 0
    if (idle) {
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.reset();
      idle.time = (idleClip.duration ?? 2) * 0.5;
      idle.enabled = true;
      idle.setEffectiveWeight(1);
      idle.play();
    }
    if (run) {
      run.setLoop(THREE.LoopRepeat, Infinity);
      run.reset();
      run.enabled = true;
      run.setEffectiveWeight(0);
      run.play();
    }
    runWeightRef.current = 0;
    wasMoving.current = false;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      mixerRef.current = null;
      idleActionRef.current = null;
      runActionRef.current = null;
    };
  }, [scene, animations]);

  useFrame((_s, d) => {
    if (!groupRef.current) return;
    const vel = velocityRef.current;
    const pos = playerPosRef.current;

    // 积分位移
    pos.x += vel.x * d;
    pos.z += vel.z * d;
    // 限制在地图内（简单 clamp，留 4 单位边距）
    const lim = TERRAIN_SIZE / 2 - 4;
    pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
    pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);
    groupRef.current.position.x = pos.x;
    groupRef.current.position.z = pos.z;

    // 地形跟随：每帧射一次线找脚下真实地面（不再隔 3 帧——隔帧 + lerp 滞后是穿模主因）。
    terrainFrame.current++;
    {
      const terrain = occluderRef.current;
      if (terrain) {
        _terrainOrigin.set(pos.x, terrainYRef.current + 30, pos.z);
        _terrainCaster.set(_terrainOrigin, _terrainDown);
        _terrainCaster.far = 60;
        const hits = _terrainCaster.intersectObject(terrain, true);
        if (hits.length > 0) {
          // ── 高度扫射判定 ──────────────────────────────────────────────────
          // 树永远长在地面之上：向下射线在同一 XZ 会命中 树冠>树干侧面>地面。
          // 取「最低的实心(非水)命中 = 地面」，树/树冠/树干在数学上必在其之上，永不被选中。
          // → 彻底摆脱"靠材质名认树"的脆弱方案，新地形加任何树/山都不会再被爬。
          let lowestSolidY: number | null = null; // 最低实心命中 = 地面
          let waterY: number | null = null;        // 水面命中（单独处理脚踝入水）
          for (const hit of hits) {
            let isWater = false;
            let obj: THREE.Object3D | null = hit.object;
            while (obj) {
              if (obj.name && /water|sea/i.test(obj.name)) { isWater = true; break; }
              obj = obj.parent;
            }
            if (isWater) {
              if (waterY === null || hit.point.y < waterY) waterY = hit.point.y;
            } else {
              if (lowestSolidY === null || hit.point.y < lowestSolidY) lowestSolidY = hit.point.y;
            }
          }
          const groundHitY = lowestSolidY;
          const waterHitY = waterY;
          const wet = waterHitY !== null && groundHitY !== null && groundHitY < waterHitY;
          // wet: 脚踝入水 0.3 单位，但不低于河底；陆地: 贴最低实心地面
          const targetHitY = wet
            ? Math.max(groundHitY!, waterHitY! - 0.3)
            : (groundHitY ?? hits[hits.length - 1].point.y);
          terrainTargetY.current = targetHitY;
          if (!terrainSnapped.current) {
            terrainYRef.current = targetHitY;
            terrainSnapped.current = true;
          }
        }
      }
    }
    // ── 防穿模 ground-snap：上坡立即贴合，下坡平滑下落 ────────────────────────
    // 地面升高（上坡/上台阶）→ 立即把 Y 顶到地面，脚绝不陷进上升的地形（根除上坡穿模）。
    // 地面降低（下坡/下台阶/落水）→ 平滑下落，避免从高处瞬移闪现。
    if (terrainSnapped.current) {
      const target = terrainTargetY.current;
      if (target >= terrainYRef.current) {
        terrainYRef.current = target;                                           // 上升：立即贴合
      } else {
        terrainYRef.current = THREE.MathUtils.lerp(terrainYRef.current, target, Math.min(1, d * 12)); // 下降：平滑
      }
    }
    // 调试 Y 覆盖：debugYRef 非空时直接用它（地形跟随被旁路，方便手动调高度）
    const dbgY = debugYRef?.current;
    groupRef.current.position.y = (dbgY != null) ? dbgY : terrainYRef.current;
    playerYRef.current = groupRef.current.position.y;

    const speed = Math.hypot(vel.x, vel.z);
    const moving = speed > 0.01;

    // 朝向：移动时面朝移动方向（简单翻转，无平滑插值）；静止保持上一朝向
    if (moving) {
      headingRef.current = Math.atan2(vel.x, vel.z);
    }
    groupRef.current.rotation.y = headingRef.current;

    // 受击横抖（眩晕惩罚是第2梯队的事，这里先保留视觉反馈）
    if (hitEffect === 'rock') {
      groupRef.current.position.x += Math.sin(Date.now() * 0.05) * 0.15;
    }

    // ── 动画切换：纯权重状态机（不用 crossFadeTo，避免时序打架）──────────────────
    // run 权重朝目标(移动=1/静止=0)每帧 lerp；idle 权重 = 1 - run 权重。
    // 两个 action 常驻播放，权重和恒为 1 → 永远有动画驱动骨骼，绝不 T-pose。
    const run = runActionRef.current;
    const idle = idleActionRef.current;
    if (run && idle) {
      const target = moving ? 1 : 0;
      runWeightRef.current = THREE.MathUtils.lerp(runWeightRef.current, target, Math.min(1, d / FADE));
      const rw = runWeightRef.current;
      run.enabled = true;
      idle.enabled = true;
      run.setEffectiveWeight(rw);
      idle.setEffectiveWeight(1 - rw);
      if (!run.isRunning()) run.play();
      if (!idle.isRunning()) idle.play();
      wasMoving.current = moving;
    }
    mixerRef.current?.update(d);
  });

  return (
    <group ref={groupRef} position={[PLAYER_START.x, CHAR_FOOT_Y, PLAYER_START.z]} scale={ACTOR_SCALE}>
      {/* 内层 group 把脚底顶到 y=0（落地补偿）。scene 必须挂在 groupRef 子树内，
          useAnimations 的 mixer 才能按骨骼名绑定到它。外层 groupRef 的 Y 由地形跟随每帧更新 */}
      <group position={[0, footOffset, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

// ── stars — 钥匙，钉死世界坐标 {x,z}，2D 平面距离收集 ─────────────────────────
// StaticCollectible 类型 + STAR_POSITIONS 星位数据已移到 parkourConstants.ts（想调星星位置去那里改）。

// 共享 3D 小部件（StarMesh / FloatingLabel / TextSprite / QuestionBoxBadge /
// TeachingPointer / StarGuideMarker / makePointerCanvas）已移到 parkour/widgets.tsx。

function StarObject({ item, playerPosRef, focus, guide, softFocus, onCollect, onPromptChange }: {
  item: StaticCollectible;
  playerPosRef: React.RefObject<Vec2>;
  focus: boolean;
  guide: boolean;
  softFocus: boolean;
  onCollect: (id: number, type: StaticCollectible['type']) => void;
  onPromptChange: (prompt: WorldPrompt) => void;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const collected = useRef(false);
  const COLLECT_RANGE = 1.5 * ACTOR_SCALE;
  const PROMPT_RANGE = (item.id === 0 ? 10 : 6) * ACTOR_SCALE;
  const isRequired = item.isRequired;
  const promptedRef = useRef(false);
  const [promptVisible, setPromptVisible] = useState(!softFocus && item.id === 0);

  useEffect(() => () => {
    if (promptedRef.current) onPromptChange(null);
  }, [onPromptChange]);

  useFrame((st) => {
    if (!groupRef.current || collected.current) return;
    const pulse = Math.sin(st.clock.elapsedTime * (item.id === 0 ? 4 : 2.4) + item.id);
    const focusPulse = focus || guide ? Math.sin(st.clock.elapsedTime * 8) * 0.22 : 0;
    const tutorialScale = (softFocus && !guide ? 0.64 : 1) * ACTOR_SCALE;
    const baseY = item.y != null ? item.y : 0.55 * ACTOR_SCALE;
    groupRef.current.position.y = baseY + Math.sin(st.clock.elapsedTime * 2.6 + item.id) * 0.15 + (focus || guide ? Math.max(0, focusPulse) : 0);
    groupRef.current.scale.setScalar(((isRequired ? 1 : 0.86) + (isRequired ? 0.08 : 0.04) * pulse + Math.max(0, focusPulse)) * tutorialScale);
    const p = playerPosRef.current;
    const dx = p.x - item.x;
    const dz = p.z - item.z;
    const dist2 = dx * dx + dz * dz;
    if (!softFocus && dist2 < PROMPT_RANGE * PROMPT_RANGE) {
      if (!promptedRef.current) {
        promptedRef.current = true;
        setPromptVisible(true);
        onPromptChange({
          kind: 'star',
          id: item.id,
          text: item.id === 0 ? '撞我！' : '碰到星星！',
          first: item.id === 0,
          position: { x: item.x, z: item.z },
        });
      }
    } else if (promptedRef.current) {
      promptedRef.current = false;
      setPromptVisible(!softFocus && item.id === 0);
      onPromptChange(null);
    }
    if (dist2 < COLLECT_RANGE * COLLECT_RANGE) {
      collected.current = true;
      promptedRef.current = false;
      onPromptChange(null);
      onCollect(item.id, item.type);
    }
  });

  return (
    <group ref={groupRef} position={[item.x, item.y != null ? item.y : 0.55 * ACTOR_SCALE, item.z]}>
      {isRequired && (!softFocus || guide) && (
        <>
          {(focus || guide || item.id === 0) && (
            <pointLight color="#FFE45C" intensity={focus || guide ? 4.5 : 2.2} distance={7} decay={1.6} />
          )}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
            <ringGeometry args={[1.15, 1.36, 32]} />
            <meshBasicMaterial color="#FFE45C" transparent opacity={focus || guide ? 0.78 : 0.48} depthWrite={false} />
          </mesh>
        </>
      )}
      <StarMesh />
      {guide && <StarGuideMarker />}
      {promptVisible && !softFocus && <FloatingLabel text={item.id === 0 ? '撞我！' : '碰到星星！'} y={item.id === 0 ? 3.1 : 2.85} color="#FF9100" />}
      {item.id === 0 && !softFocus && <TeachingPointer />}
    </group>
  );
}

function StarsGroup({ collected, playerPosRef, focusStarId, guideStarId, softFocus, onCollect, onPromptChange, extraItems = [], landOverrides }: {
  collected: Set<number>;
  playerPosRef: React.RefObject<Vec2>;
  focusStarId: number | null;
  guideStarId: number | null;
  softFocus: boolean;
  onCollect: (id: number, type: StaticCollectible['type']) => void;
  onPromptChange: (prompt: WorldPrompt) => void;
  extraItems?: StaticCollectible[];
  landOverrides?: { id: number; x: number; z: number }[];
}) {
  const allItems = useMemo(() => {
    const base = landOverrides
      ? STAR_POSITIONS.map(s => {
          const ov = landOverrides.find(o => o.id === s.id);
          return ov ? { ...s, x: ov.x, z: ov.z } : s;
        })
      : STAR_POSITIONS;
    return [...base, ...extraItems];
  }, [extraItems, landOverrides]);
  return (
    <>
      {allItems.filter(item => !collected.has(item.id)).map(item => (
        <StarObject
          key={item.id}
          item={item}
          playerPosRef={playerPosRef}
          focus={focusStarId === item.id}
          guide={guideStarId === item.id}
          softFocus={softFocus}
          onCollect={onCollect}
          onPromptChange={prompt => {
            if (!prompt || prompt.id === item.id) onPromptChange(prompt);
          }}
        />
      ))}
    </>
  );
}

// obstacles 子系统（ActiveObstacle / OB_* / RocksModel / BarrelModel / CrateModel /
//   ObstacleObject / ObstacleField）已移到 parkour/Obstacles.tsx。

// ── NPCs — 钉死世界坐标，走近半径触发（带迟滞，离开后可再触发）────────────────
// NPC_URLS / NPC_SCALES / NPC_ROTATIONS / NPC_POSITIONS（模型/缩放/朝向/坐标）已移到 parkourConstants.ts。

// ── 程序化树林散布 ──────────────────────────────────────────────────────────
// 老板说「像公园不像森林」→ 用代码把 3d-tree 的圆树/灌木散布开，密度约现在 2 倍：
// 外圈大圆树围合（留缝透气，远处仍见天）+ 内部随机散树/灌木（矮层填充）。
// 约束：不压道路（沿星星折线的路径带）、不糊出生点、不严重穿模、不出界。
// ⚠️ 用固定种子 PRNG 一次性生成并模块级缓存——绝不能在渲染期 Math.random，否则每帧位置乱跳。
type ScatterItem = { kind: 'round' | 'bush'; x: number; z: number; scale: number; rotY: number; yOff?: number };

const SCATTER_INNER_TARGET = 70; // 内部散布目标数（调密度主旋钮）
const SCATTER_RING_COUNT = 28;   // 外圈围合棵数
const SCATTER_SEED = 1337;

// 手工补位灌木/树：用坐标面板（SHOW_COORDS）定位、玩家指定要遮挡的边缘缺口。往这里加即可。
const MANUAL_FILL: ScatterItem[] = [
  // 玩家站在 (-30, 92) 报点：以此为中心补一簇矮灌木把缺口填实。
  // ⚠️ 灌木模型本体≈1.9 大小，scale 控制在 1.8~2.4（≈比熊矮的丛），别再放大成参天大树。
  { kind: 'bush', x: -30, z: 92, scale: 2.2, rotY: 0.7 },
  { kind: 'bush', x: -34, z: 90, scale: 2.4, rotY: 2.2 },
  { kind: 'bush', x: -27, z: 93, scale: 1.9, rotY: 1.1 },
];

const TREE_SCATTER: ScatterItem[] = (() => {
  // 简单确定性 LCG（值域 [0,1)）
  let seed = SCATTER_SEED >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const rng = (a: number, b: number) => a + (b - a) * rnd();

  const lim = TERRAIN_SIZE / 2 - 6;
  const items: ScatterItem[] = [];

  // 树冠半径估算（模型半宽≈0.92 * scale）。低多边形可轻微交叠 → 间距系数 0.7。
  const radiusOf = (it: ScatterItem) => 0.92 * it.scale;

  // 路径带：到任一星星/NPC（都在路上）的距离，或离 z 轴中线太近（|x|<带宽）都算「在路上」。
  const PATH_HALF = 11; // 路半宽 + 余量
  const NPC_CLEAR = 16; // NPC 周围额外留空半径（比路宽大，确保 NPC 绝不被树挡）
  const onPath = (x: number, z: number, treeR: number) => {
    if (z > 40 && z < 116 && Math.abs(x) < PATH_HALF + treeR) return true; // 入口直道段大致沿中线
    for (const s of STAR_POSITIONS) if ((s.x - x) ** 2 + (s.z - z) ** 2 < (PATH_HALF + treeR) ** 2) return true;
    for (const n of NPC_POSITIONS) if ((n.x - x) ** 2 + (n.z - z) ** 2 < (NPC_CLEAR + treeR) ** 2) return true;
    return false;
  };

  const farFromSpawn = (x: number, z: number) =>
    (x - PLAYER_START.x) ** 2 + (z - PLAYER_START.z) ** 2 > 14 * 14;

  const noOverlap = (cand: ScatterItem) => {
    const cr = radiusOf(cand);
    return items.every(it => {
      const minD = (cr + radiusOf(it)) * 0.7;
      return (it.x - cand.x) ** 2 + (it.z - cand.z) ** 2 > minD * minD;
    });
  };

  // 1) 外圈围合：环带半径 ~78~96，按角度均分 + 抖动，大圆树。留缝（不强制每格都放）。
  for (let i = 0; i < SCATTER_RING_COUNT; i++) {
    const baseAng = (i / SCATTER_RING_COUNT) * Math.PI * 2;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = baseAng + rng(-0.12, 0.12);
      const r = rng(78, 96);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      const cand: ScatterItem = { kind: 'round', x, z, scale: rng(6.5, 9), rotY: rng(0, Math.PI * 2) };
      if (onPath(x, z, radiusOf(cand)) || !noOverlap(cand)) continue;
      items.push(cand);
      break;
    }
  }

  // 1.5) 外圈树根灌木：每棵外圈大树正前方（朝圆心方向）补 1~2 棵小灌木，遮住树根。
  const ringActual = items.length; // 外圈实际放置数（后续内部散布从这里开始追加）
  for (let i = 0; i < ringActual; i++) {
    const tree = items[i];
    const r = Math.hypot(tree.x, tree.z);
    if (r < 1) continue;
    const dirX = -tree.x / r, dirZ = -tree.z / r; // 朝圆心方向单位向量
    const perpX = -dirZ, perpZ = dirX;             // 垂直方向（横向抖动用）
    const bushNum = rnd() < 0.5 ? 1 : 2;
    for (let b = 0; b < bushNum; b++) {
      const fwd  = tree.scale * rng(0.45, 0.75);          // 沿朝圆心方向的偏移距离
      const side = rng(-tree.scale * 0.35, tree.scale * 0.35); // 横向随机抖动
      const bx = tree.x + dirX * fwd + perpX * side;
      const bz = tree.z + dirZ * fwd + perpZ * side;
      if (Math.abs(bx) > lim || Math.abs(bz) > lim) continue;
      const cand: ScatterItem = { kind: 'bush', x: bx, z: bz, scale: rng(1.8, 2.6), rotY: rng(0, Math.PI * 2) };
      if (onPath(bx, bz, radiusOf(cand))) continue;
      items.push(cand);
    }
  }

  // 2) 内部散布：圆树:灌木 ≈ 6:4，撒在玩法区周边（避开路与出生点）。
  let placed = 0, guard = 0;
  while (placed < SCATTER_INNER_TARGET && guard < SCATTER_INNER_TARGET * 40) {
    guard++;
    const x = rng(-95, 95);
    const z = rng(-16, 100); // 南边截到 -16，围墙第一排树干在 z=-18
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    const isBush = rnd() < 0.4;
    const cand: ScatterItem = isBush
      ? { kind: 'bush', x, z, scale: rng(1.6, 2.6), rotY: rng(0, Math.PI * 2) }
      : { kind: 'round', x, z, scale: rng(4, 7), rotY: rng(0, Math.PI * 2) };
    if (!farFromSpawn(x, z) || onPath(x, z, radiusOf(cand)) || !noOverlap(cand)) continue;
    items.push(cand);
    placed++;
  }

  // 3) 手工补位：用坐标面板（SHOW_COORDS）定位、玩家指定要遮挡的边缘缺口。
  //    每条按玩家报的位置就近放，仍校验不压路。以后要补更多就往这个数组加。
  for (const f of MANUAL_FILL) {
    if (Math.abs(f.x) > lim || Math.abs(f.z) > lim) continue;
    if (onPath(f.x, f.z, radiusOf(f))) continue;
    items.push(f);
  }

  // 4) 终点围墙：参考低多边森林——树有间隔、灌木成簇点缀，靠「层次错位」挡视线而非堆实心墙。
  //    堵天的关键不是堵到地面，而是让【树冠在地平线那条横带上连续】：
  //    后排一圈大圆树(scale 大、压低 yOff)把树冠铺在视线高度连成横带 → 挡住远天；
  //    前排中树 + 树脚灌木簇有间隔地点缀（参考图的疏密节奏），不再密不透风。
  const NPC3 = NPC_POSITIONS[2]; // {x:-17.3, z:-27.9}
  const END_CLEAR = 5;
  const clearNpc3 = (x: number, z: number, r: number) =>
    (x - NPC3.x) ** 2 + (z - NPC3.z) ** 2 < (END_CLEAR + r) ** 2;

  // 后排「树冠横带」：大圆树放大(7~9)让树冠横向连片堵天。yOff=0：底部精确贴射线命中的地面。
  for (let xi = -112; xi <= 112; xi += 9) {
    const x = xi + rng(-1.5, 1.5);
    const z = -42 + rng(-2, 2);
    if (Math.abs(x) > lim) continue;
    const cand: ScatterItem = { kind: 'round', x, z, scale: rng(7, 9), rotY: rng(0, Math.PI * 2) };
    if (clearNpc3(x, z, radiusOf(cand))) continue;
    items.push(cand);
  }
  // 前排中树：间距大(14)、错开半步，有间隔地立在横带前，增加纵深层次（参考图的前景树）。
  for (let xi = -105; xi <= 105; xi += 14) {
    const x = xi + 7 + rng(-2, 2);
    const z = -30 + rng(-2, 2);
    if (Math.abs(x) > lim) continue;
    const cand: ScatterItem = { kind: 'round', x, z, scale: rng(5, 7), rotY: rng(0, Math.PI * 2) };
    if (clearNpc3(x, z, radiusOf(cand))) continue;
    items.push(cand);
  }

  // 5) 灌木簇：在前排树之间成簇点缀（每簇 2~3 棵聚拢），不连续密铺，留出草地呼吸感。
  //    簇内大小拉开层次（一棵主灌木大、其余明显更小），并往侧后方错开，避免两棵等大并排像复制粘贴。
  for (let xi = -100; xi <= 100; xi += 16) {
    const cx = xi + rng(-3, 3);
    const cz = -26 + rng(-2, 2);
    if (Math.abs(cx) > lim) continue;
    const clusterN = 2 + Math.floor(rnd() * 2); // 2~3 棵
    for (let b = 0; b < clusterN; b++) {
      // 第一棵=主灌木(较大 2.0~2.6)，后续=小灌木(1.2~1.7)往侧后方偏，形成有主次的自然丛。
      const isMain = b === 0;
      const ang = rng(0, Math.PI * 2);
      const dist = isMain ? 0 : rng(1.5, 3.5);
      const x = cx + Math.cos(ang) * dist;
      const z = cz + Math.sin(ang) * dist;
      if (Math.abs(x) > lim) continue;
      const scale = isMain ? rng(2.0, 2.6) : rng(1.2, 1.7);
      const bush: ScatterItem = { kind: 'bush', x, z, scale, rotY: rng(0, Math.PI * 2), yOff: -0.2 };
      if (clearNpc3(x, z, radiusOf(bush))) continue;
      items.push(bush);
    }
  }

  // 手工排除：散布算法漏过的压路树（用坐标面板定位后在此登记）。
  const EXCLUDE_NEAR: Array<{ x: number; z: number; r: number }> = [
    { x: -17, z: 72, r: 7 }, // 玩家报点 (-16.8, 72)：圆树压路
  ];
  const filtered = items.filter(it =>
    !EXCLUDE_NEAR.some(e => (it.x - e.x) ** 2 + (it.z - e.z) ** 2 < e.r ** 2)
  );

  // eslint-disable-next-line no-console
  // （TREE_SCATTER 统计日志已移除）
  // 出生点旁两棵灌木——绕过路径/边界过滤直接追加
  filtered.push({ kind: 'bush', x:  2, z: 114, scale: 2.3, rotY: 0.8 });
  filtered.push({ kind: 'bush', x:  5, z: 112, scale: 1.6, rotY: 2.1 });
  return filtered;
})();

// 模型半高（Y∈[-0.95,0.95]）：放置时整体抬 0.95*scale 让底部贴 y=0 地面。
const SCATTER_HALF_H = 0.95;

// ── 地面细节散布数据 — 确定性 LCG 一次性生成（模块级缓存，绝不在渲染期 random）──────
// 小花/草丛，撒满探索区，避开石板路带与出生点。地形是斜坡，y 由渲染期射线吸附。
type GroundKind = 'white' | 'yellow' | 'grass' | 'blue' | 'purple';
type GroundItem = { kind: GroundKind; x: number; z: number; scale: number; rotY: number };

const GROUND_DETAIL_SCATTER: GroundItem[] = (() => {
  let seed = 0x9e37 >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const rng = (a: number, b: number) => a + (b - a) * rnd();

  const lim = TERRAIN_SIZE / 2 - 6;
  const PATH_HALF = 11; // 与 TREE_SCATTER 同步：石板路半宽，花草不铺到路面上（但允许贴路边）
  const onPath = (x: number, z: number) => z > 40 && z < 116 && Math.abs(x) < PATH_HALF;
  const farFromSpawn = (x: number, z: number) =>
    (x - PLAYER_START.x) ** 2 + (z - PLAYER_START.z) ** 2 > 5 * 5; // 出生点脚下留小空地

  const items: GroundItem[] = [];
  const gen = (kind: GroundKind, count: number, sMin: number, sMax: number) => {
    let placed = 0, guard = 0;
    while (placed < count && guard < count * 25) {
      guard++;
      let x: number, z: number;
      // 55% 贴路边一窄条（沿入口直道两侧 + 中后段路沿），让路两侧密集丰富；45% 全区铺底。
      if (rnd() < 0.55) {
        z = rng(-26, 114);
        const side = rnd() < 0.5 ? -1 : 1;
        x = side * rng(PATH_HALF + 0.3, PATH_HALF + 8);
      } else {
        x = rng(-72, 72);
        z = rng(-28, 118);
      }
      if (Math.abs(x) > lim || onPath(x, z) || !farFromSpawn(x, z)) continue;
      items.push({ kind, x, z, scale: rng(sMin, sMax), rotY: rng(0, Math.PI * 2) });
      placed++;
    }
  };
  const G = GROUND_DETAIL;
  gen('grass',  G.grassTuft.count,    G.grassTuft.scale[0],    G.grassTuft.scale[1]);
  gen('white',  G.whiteFlower.count,  G.whiteFlower.scale[0],  G.whiteFlower.scale[1]);
  gen('yellow', G.yellowFlower.count, G.yellowFlower.scale[0], G.yellowFlower.scale[1]);
  gen('blue',   G.blueFlower.count,   G.blueFlower.scale[0],   G.blueFlower.scale[1]);
  gen('purple', G.purpleFlower.count, G.purpleFlower.scale[0], G.purpleFlower.scale[1]);

  // 出生点正前方左右两侧加密：玩家初始面朝 -z，要的是「前方左右两侧空地」都有花草。
  // 带状区 z∈[88,119]、x∈[路沿外~42]，挖掉中间石板路 → 只填路两侧空地。
  // ⚠️ 不能用上面的 lim(=TERRAIN_SIZE/2-6=114) 裁 z！出生点在 z=116、近景到 z≈119，
  //    用 114 会把整片出生点近景砍光（这正是之前出生点左右空的根因）。地形延伸到 120，放到 119 安全。
  const spawnZMax = TERRAIN_SIZE / 2 - 1; // 119
  // z 收窄到 [98,119] 的真近景（玩家一进来就看到的左右草地），密度才不会被稀释到中景。
  const spawnBand = (kind: GroundKind, n: number, s: [number, number]) => {
    let placed = 0, guard = 0;
    while (placed < n && guard < n * 30) {
      guard++;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * rng(PATH_HALF + 0.5, 42); // 路沿外 ~0.5 起到 42，左右两侧
      const z = rng(98, spawnZMax);
      if (Math.abs(x) > lim) continue;
      items.push({ kind, x, z, scale: rng(s[0], s[1]), rotY: rng(0, Math.PI * 2) });
      placed++;
    }
  };
  spawnBand('grass',  130, G.grassTuft.scale);
  spawnBand('white',  110, G.whiteFlower.scale);
  spawnBand('yellow', 80,  G.yellowFlower.scale);
  spawnBand('blue',   45,  G.blueFlower.scale);
  spawnBand('purple', 35,  G.purpleFlower.scale);
  return items;
})();

// 地面吸附工具 snapGroundY（+ GROUND_SNAP_MAX_Y）已移到 parkour/runtime.ts。

// 一类地面细节 = 一个 InstancedMesh（共享 geometry+material）。地形就绪后射线吸附到真实地面高度。
function InstancedGroundDetail({ geometry, material, items }: {
  geometry: THREE.BufferGeometry; material: THREE.Material; items: GroundItem[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const snapped = useRef(false);
  const raycaster = useRef(new THREE.Raycaster());

  // 初始按 y=0 兜底摆好（地形射线未就绪时，避免第一帧堆在原点）
  useEffect(() => {
    if (!ref.current) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      pos.set(it.x, it.scale, it.z);
      q.setFromAxisAngle(yAxis, it.rotY);
      scl.setScalar(it.scale);
      m.compose(pos, q, scl);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
    snapped.current = false;
  }, [items, geometry]);

  // 地形就绪 → 一次性吸附到真实地面高度
  useFrame(() => {
    if (snapped.current || !ref.current) return;
    const occ = occluderRef.current;
    if (!occ) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const from = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    const yAxis = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      from.set(it.x, 150, it.z);
      raycaster.current.set(from, down);
      raycaster.current.far = 400;
      const hits = raycaster.current.intersectObject(occ, true);
      const groundY = snapGroundY(hits);
      pos.set(it.x, groundY + it.scale, it.z);
      q.setFromAxisAngle(yAxis, it.rotY);
      scl.setScalar(it.scale);
      m.compose(pos, q, scl);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
    snapped.current = true;
  });

  return (
    <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={false} receiveShadow />
  );
}

// 地面细节总成：五类小物件，各一个 InstancedMesh（5 个 draw call）。花用小球+自发光点缀，草用小锥。
function GroundDetail() {
  const white  = useMemo(() => GROUND_DETAIL_SCATTER.filter(i => i.kind === 'white'),  []);
  const yellow = useMemo(() => GROUND_DETAIL_SCATTER.filter(i => i.kind === 'yellow'), []);
  const grass  = useMemo(() => GROUND_DETAIL_SCATTER.filter(i => i.kind === 'grass'),  []);
  const blue   = useMemo(() => GROUND_DETAIL_SCATTER.filter(i => i.kind === 'blue'),   []);
  const purple = useMemo(() => GROUND_DETAIL_SCATTER.filter(i => i.kind === 'purple'), []);

  const flowerGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const grassGeo  = useMemo(() => new THREE.ConeGeometry(0.6, 2, 5), []);
  const mkFlowerMat = (c: string, e: string) => new THREE.MeshStandardMaterial({ color: c, emissive: e, emissiveIntensity: 0.35, roughness: 0.9, metalness: 0 });
  const whiteMat  = useMemo(() => mkFlowerMat(GROUND_DETAIL.whiteFlower.color,  GROUND_DETAIL.whiteFlower.emissive), []);
  const yellowMat = useMemo(() => mkFlowerMat(GROUND_DETAIL.yellowFlower.color, GROUND_DETAIL.yellowFlower.emissive), []);
  const blueMat   = useMemo(() => mkFlowerMat(GROUND_DETAIL.blueFlower.color,   GROUND_DETAIL.blueFlower.emissive), []);
  const purpleMat = useMemo(() => mkFlowerMat(GROUND_DETAIL.purpleFlower.color, GROUND_DETAIL.purpleFlower.emissive), []);
  const grassMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: GROUND_DETAIL.grassTuft.color, roughness: 0.9, metalness: 0 }), []);

  useEffect(() => () => { flowerGeo.dispose(); grassGeo.dispose(); whiteMat.dispose(); yellowMat.dispose(); blueMat.dispose(); purpleMat.dispose(); grassMat.dispose(); }, [flowerGeo, grassGeo, whiteMat, yellowMat, blueMat, purpleMat, grassMat]);

  return (
    <>
      {grass.length  > 0 && <InstancedGroundDetail geometry={grassGeo}  material={grassMat}  items={grass} />}
      {white.length  > 0 && <InstancedGroundDetail geometry={flowerGeo} material={whiteMat}  items={white} />}
      {yellow.length > 0 && <InstancedGroundDetail geometry={flowerGeo} material={yellowMat} items={yellow} />}
      {blue.length   > 0 && <InstancedGroundDetail geometry={flowerGeo} material={blueMat}   items={blue} />}
      {purple.length > 0 && <InstancedGroundDetail geometry={flowerGeo} material={purpleMat} items={purple} />}
    </>
  );
}

// ── GLB 花草散布 — 真实花朵几何，偏向路边/空地集中，让"路两侧丰富"（参考图的密集小细节感）──
type FlowerKind = 'daisy' | 'yellow' | 'plant';
type FlowerItem = { kind: FlowerKind; x: number; z: number; scale: number; rotY: number };

const FLOWER_GLB_SCATTER: FlowerItem[] = (() => {
  let seed = 0xb33f >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const rng = (a: number, b: number) => a + (b - a) * rnd();

  const lim = TERRAIN_SIZE / 2 - 6;
  const PATH_HALF = 11;
  const onPath = (x: number, z: number) => z > 40 && z < 116 && Math.abs(x) < PATH_HALF;
  const farFromSpawn = (x: number, z: number) =>
    (x - PLAYER_START.x) ** 2 + (z - PLAYER_START.z) ** 2 > 6 * 6;

  const items: FlowerItem[] = [];
  const gen = (kind: FlowerKind, count: number, sMin: number, sMax: number) => {
    let placed = 0, guard = 0;
    while (placed < count && guard < count * 25) {
      guard++;
      let x: number, z: number;
      // 60% 贴路边（路带外侧一窄条，沿入口直道两侧），40% 全区空地 → 路两侧明显更密
      if (rnd() < 0.6) {
        z = rng(-24, 114);
        const side = rnd() < 0.5 ? -1 : 1;
        x = side * rng(PATH_HALF + 0.5, PATH_HALF + 9); // 路沿外 0.5~9 单位
      } else {
        x = rng(-66, 66);
        z = rng(-26, 116);
      }
      if (Math.abs(x) > lim || Math.abs(z) > lim || onPath(x, z) || !farFromSpawn(x, z)) continue;
      items.push({ kind, x, z, scale: rng(sMin, sMax), rotY: rng(0, Math.PI * 2) });
      placed++;
    }
  };
  const F = FLOWER_GLB;
  gen('plant',  F.plant.count,  F.plant.scale[0],  F.plant.scale[1]);
  gen('daisy',  F.daisy.count,  F.daisy.scale[0],  F.daisy.scale[1]);
  gen('yellow', F.yellow.count, F.yellow.scale[0], F.yellow.scale[1]);

  // 出生点正前方左右两侧：真实花朵几何也填到路两侧空地（带状，避开路面）。
  // 同样不能用 lim(=114) 裁 z（出生点 z=116、近景到 119），否则出生点近景全被砍。
  const spawnZMax = TERRAIN_SIZE / 2 - 1; // 119
  const spawnBand = (kind: FlowerKind, n: number, s: [number, number]) => {
    let placed = 0, guard = 0;
    while (placed < n && guard < n * 30) {
      guard++;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * rng(PATH_HALF + 0.5, 40);
      const z = rng(98, spawnZMax);
      if (Math.abs(x) > lim) continue;
      items.push({ kind, x, z, scale: rng(s[0], s[1]), rotY: rng(0, Math.PI * 2) });
      placed++;
    }
  };
  spawnBand('plant',  40, F.plant.scale);
  spawnBand('daisy',  34, F.daisy.scale);
  spawnBand('yellow', 28, F.yellow.scale);
  return items;
})();

// 单类 GLB 花草 = 一个 InstancedMesh。从 GLB 取第一个网格的 geo+mat，按 bbox 把底部贴地，地形就绪后射线吸附。
// scale 字段是「世界目标高度」：实例缩放 = 目标高度 / 模型本体高度，统一压在膝盖以下。
function InstancedGLBFlower({ url, items }: { url: string; items: FlowerItem[] }) {
  const { scene } = useGLTF(url);
  const ref = useRef<THREE.InstancedMesh>(null!);
  const snapped = useRef(false);
  const raycaster = useRef(new THREE.Raycaster());

  const { geometry, material, modelH, baseOffset } = useMemo(() => {
    let geo: THREE.BufferGeometry | null = null;
    let mat: THREE.Material | null = null;
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !geo) {
        geo = mesh.geometry;
        const mm = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
        if (mm && 'metalness' in mm && mm.metalness > 0) { mm.metalness = 0; mm.needsUpdate = true; }
        mat = mm;
      }
    });
    if (geo) (geo as THREE.BufferGeometry).computeBoundingBox();
    const bb = geo ? (geo as THREE.BufferGeometry).boundingBox : null;
    const h = bb ? bb.max.y - bb.min.y : 1;
    const off = bb ? -bb.min.y : 0; // 模型本地底部到原点的距离（×缩放后即抬升量）
    return { geometry: geo, material: mat, modelH: h || 1, baseOffset: off };
  }, [scene]);

  const place = (toGround: boolean) => {
    if (!ref.current) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const from = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const occ = occluderRef.current;
    items.forEach((it, i) => {
      const s = it.scale / modelH;       // 世界目标高度 → 实例缩放系数
      let groundY = 0;
      if (toGround && occ) {
        from.set(it.x, 150, it.z);
        raycaster.current.set(from, down);
        raycaster.current.far = 400;
        const hits = raycaster.current.intersectObject(occ, true);
        groundY = snapGroundY(hits);
      }
      pos.set(it.x, groundY + baseOffset * s, it.z);
      q.setFromAxisAngle(yAxis, it.rotY);
      scl.setScalar(s);
      m.compose(pos, q, scl);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  };

  // 初始兜底摆位（地形射线未就绪）
  useEffect(() => { place(false); snapped.current = false; }, [items, geometry]);
  // 地形就绪 → 一次性吸附
  useFrame(() => {
    if (snapped.current || !ref.current || !occluderRef.current) return;
    place(true);
    snapped.current = true;
  });

  if (!geometry || !material) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={false} receiveShadow />;
}

function GLBFlowers() {
  const daisy  = useMemo(() => FLOWER_GLB_SCATTER.filter(i => i.kind === 'daisy'),  []);
  const yellow = useMemo(() => FLOWER_GLB_SCATTER.filter(i => i.kind === 'yellow'), []);
  const plant  = useMemo(() => FLOWER_GLB_SCATTER.filter(i => i.kind === 'plant'),  []);
  return (
    <React.Suspense fallback={null}>
      {plant.length  > 0 && <InstancedGLBFlower url={FLOWER_GLB.plant.url}  items={plant} />}
      {daisy.length  > 0 && <InstancedGLBFlower url={FLOWER_GLB.daisy.url}  items={daisy} />}
      {yellow.length > 0 && <InstancedGLBFlower url={FLOWER_GLB.yellow.url} items={yellow} />}
    </React.Suspense>
  );
}


// 从 GLB 里取出第一个网格的 geometry + material（这两个模型都是单网格单材质）。
// tint：非空则 clone 材质并把 color 设为该色——贴图细节保留、整体色相被拉到调色板。
function useScatterGeoMat(url: string, tint?: string) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.Material | null = null;
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !geometry) {
        geometry = mesh.geometry;
        let mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
        if (tint) {
          mat = mat.clone();
          mat.color.set(tint);
        }
        if ('metalness' in mat && mat.metalness > 0) mat.metalness = 0;
        mat.needsUpdate = true;
        material = mat;
      }
    });
    return { geometry, material };
  }, [scene, tint]);
}

// 一种树 = 一个 InstancedMesh：所有同类树共享一份几何体+材质，95 棵从 95 个 draw call 降到 ~2 个，
// 几何体内存从 95 份降到 1 份。每个实例用一个 matrix 摆放（位置+绕Y旋转+缩放+贴地抬升）。
// ⚠️ 地形是 3D 斜坡（只有步道对齐到 y=0，远处草地是下坡、地面 Y 为负），固定 y 会让树浮空/陷地。
//    所以地形就绪后用射线从高空向下打、命中真实地面高度，再把每棵树底吸附到那个高度。
function InstancedScatter({ url, items, tint }: { url: string; items: ScatterItem[]; tint?: string }) {
  const { geometry, material } = useScatterGeoMat(url, tint);
  const ref = useRef<THREE.InstancedMesh>(null!);
  const snapped = useRef(false);
  const raycaster = useRef(new THREE.Raycaster());

  // 初始：先按固定 y=0 基准摆好（地形射线未就绪时的兜底位置，避免第一帧全在原点）
  useEffect(() => {
    if (!ref.current) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    items.forEach((t, i) => {
      pos.set(t.x, SCATTER_HALF_H * t.scale + (t.yOff ?? 0), t.z);
      q.setFromAxisAngle(yAxis, t.rotY);
      scl.setScalar(t.scale);
      m.compose(pos, q, scl);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
    snapped.current = false; // items 变了 → 重新吸附
  }, [items, geometry]);

  // 地形就绪后，一次性把每棵树射线吸附到真实地面高度（占位树底落在 groundY+yOff）。
  useFrame(() => {
    if (snapped.current || !ref.current) return;
    const occ = occluderRef.current;
    if (!occ) return; // 地形还没加载，下一帧再试
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const from = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);
    const yAxis = new THREE.Vector3(0, 1, 0);
    items.forEach((t, i) => {
      from.set(t.x, 150, t.z);
      raycaster.current.set(from, down);
      raycaster.current.far = 400;
      const hits = raycaster.current.intersectObject(occ, true);
      const groundY = snapGroundY(hits);
      pos.set(t.x, groundY + SCATTER_HALF_H * t.scale + (t.yOff ?? 0), t.z);
      q.setFromAxisAngle(yAxis, t.rotY);
      scl.setScalar(t.scale);
      m.compose(pos, q, scl);
      ref.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
    snapped.current = true;
  });

  if (!geometry || !material) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow
      receiveShadow
    />
  );
}

function TreeScatter() {
  const round = useMemo(() => TREE_SCATTER.filter(t => t.kind === 'round'), []);
  const bush = useMemo(() => TREE_SCATTER.filter(t => t.kind === 'bush'), []);
  return (
    <React.Suspense fallback={null}>
      {round.length > 0 && <InstancedScatter key={`round-${round.length}`} url={TREE_ROUND_URL} items={round} tint={SCATTER_TINT.round} />}
      {bush.length > 0 && <InstancedScatter key={`bush-${bush.length}`} url={BUSH_URL} items={bush} tint={SCATTER_TINT.bush} />}
    </React.Suspense>
  );
}

function NpcModel({ url, scale, rotationY, npcIndex }: { url: string; scale: number; rotationY: number; npcIndex: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const c = cloneSkinned(scene) as THREE.Object3D;
    const s = scale * ACTOR_SCALE;
    c.scale.set(s, s, s);
    c.rotation.set(0, rotationY, 0);
    c.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(c);
    const footY = isFinite(box.min.y) ? -box.min.y : 0;
    c.position.set(0, footY, 0);
    c.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return c;
  }, [scene, scale, rotationY, npcIndex]);
  return <primitive object={cloned} />;
}

function NpcSlot({ pos, url, scale, rotationY, npcIndex, playerPosRef, onApproach }: {
  pos: NpcPos; url: string; scale: number; rotationY: number;
  npcIndex: number; playerPosRef: React.RefObject<Vec2>; onApproach: (index: number) => void;
}) {
  const triggered = useRef(false);
  const groupRef = useRef<THREE.Group>(null!);
  const snapped = useRef(false);
  const posRef = useRef(pos);
  posRef.current = pos; // 每次渲染都更新，useFrame 始终读到最新值
  const APPROACH_RANGE = 4 * ACTOR_SCALE;
  const RELEASE_RANGE = 6 * ACTOR_SCALE;

  useEffect(() => {
    return () => {};
  }, [npcIndex, pos.x, pos.z]);

  // pos.y 手动指定时每帧直接写入（实时响应 slider）；否则走一次性射线吸附
  useFrame(() => {
    if (!groupRef.current) return;
    const p = posRef.current;
    if (p.y != null) {
      groupRef.current.position.y = p.y;
      return;
    }
    if (snapped.current) return;
    const terrain = occluderRef.current;
    if (!terrain) return;
    const origin = new THREE.Vector3(p.x, 50, p.z);
    const caster = new THREE.Raycaster();
    caster.set(origin, new THREE.Vector3(0, -1, 0));
    caster.far = 100;
    const hits = caster.intersectObject(terrain, true);
    const groundY = snapGroundY(hits);
    groupRef.current.position.y = groundY;
    snapped.current = true;
  });

  // x/z 变化时重新触发射线吸附
  useEffect(() => {
    snapped.current = false;
    if (groupRef.current) groupRef.current.position.set(pos.x, pos.y ?? 0, pos.z);
  }, [pos.x, pos.z]);

  useFrame(() => {
    const p = posRef.current;
    const pl = playerPosRef.current;
    const dx = pl.x - p.x;
    const dz = pl.z - p.z;
    const dist2 = dx * dx + dz * dz;
    if (!triggered.current && dist2 < APPROACH_RANGE * APPROACH_RANGE) {
      triggered.current = true;
      onApproach(npcIndex);
    } else if (triggered.current && dist2 > RELEASE_RANGE * RELEASE_RANGE) {
      triggered.current = false;
    }
  });

  return (
    <group ref={groupRef} position={[pos.x, pos.y ?? 0, pos.z]}>
      <React.Suspense fallback={
        <mesh position={[0, 1, 0]}>
          <sphereGeometry args={[0.5, 8, 8]} />
          <meshLambertMaterial color="#FF9100" />
        </mesh>
      }>
        <NpcModel url={url} scale={scale} rotationY={rotationY} npcIndex={npcIndex} />
      </React.Suspense>
    </group>
  );
}

function NpcGroup({ playerPosRef, softFocus, onNpcApproach, positions }: {
  playerPosRef: React.RefObject<Vec2>;
  softFocus: boolean;
  onNpcApproach: (index: number) => void;
  positions?: NpcPos[];
}) {
  const pts = positions ?? NPC_POSITIONS;
  return (
    <group scale={softFocus ? 0.78 : 1}>
      {pts.map((pos, i) => (
        <NpcSlot key={`${i}-${pos.x}-${pos.z}`} pos={pos} url={NPC_URLS[i]} scale={NPC_SCALES[i]} rotationY={NPC_ROTATIONS[i]} npcIndex={i} playerPosRef={playerPosRef} onApproach={onNpcApproach} />
      ))}
    </group>
  );
}

// ── debug tracker — 报玩家坐标 + 到各 NPC 距离 ───────────────────────────────
function DebugTracker({ playerPosRef, onDebugUpdate, npcPositions }: {
  playerPosRef: React.RefObject<Vec2>;
  onDebugUpdate: (info: DebugInfo) => void;
  npcPositions?: NpcPos[];
}) {
  useFrame(() => {
    const p = playerPosRef.current;
    const pts = npcPositions ?? NPC_POSITIONS;
    const dist = pts.map(n => Math.hypot(p.x - n.x, p.z - n.z)) as [number, number, number];
    onDebugUpdate({ player: { x: p.x, z: p.z }, playerY: playerYRef.current, npcDist: dist });
  });
  return null;
}

// ── camera — 后方固定机位跟随 + 前瞻（看向移动方向）+ 树木遮挡自动拉近 ──────────
// 「前瞻跟随」：机位始终在主角正后方（不旋转坐标系 → 方向键含义恒定，孩子不会按晕），
// 但「看向哪里」会朝移动方向前移：拐弯时镜头提前偏向前进方向、把前方的路露出来，消盲区。
// 俯角≈7°（近乎平视，不俯视）：高度 2.6 仍高于熊头(≈1.7)，能越过近处草木防糊脸；
// 视线抬到 1.6 让俯角变小回到平视——「平视」靠抬高视线实现，不是靠把相机压到贴地。
const CAM_OFFSET = new THREE.Vector3(0, 2.6, 8.5).multiplyScalar(ACTOR_SCALE);
const LOOK_Y = 1.6 * ACTOR_SCALE;             // 视线落点高度（抬到主角头部 → 俯角小、近平视）
const CAM_MIN_DIST = 1.6 * ACTOR_SCALE;       // 遮挡拉近时相机离主角的最近距离（再近会怼进身体）
const CAM_OCCLUDE_MARGIN = 0.4 * ACTOR_SCALE; // 停在遮挡物前一点点，避免相机贴面穿模
// 终点演出运镜：拉远 + 抬高，并把视线抬向升起的月亮，否则月亮升上去会飞出画面顶。
const CAM_OFFSET_CINEMATIC = new THREE.Vector3(0, 13, 30);
const LOOK_Y_CINEMATIC = 16;      // 视线抬高的目标 y（朝月亮）
const LOOK_AHEAD_CINEMATIC = 28;  // 视线前移（-z）量，对准前方升起的月亮

function CameraRig({ playerPosRef, camYawRef, cinematic = false }: {
  playerPosRef: React.RefObject<Vec2>;
  camYawRef: React.RefObject<number>;
  cinematic?: boolean;
}) {
  const { camera } = useThree();
  const cur = useRef(new THREE.Vector3(PLAYER_START.x + CAM_OFFSET.x, CAM_OFFSET.y, PLAYER_START.z + CAM_OFFSET.z));
  const curLook = useRef(new THREE.Vector3(PLAYER_START.x, LOOK_Y, PLAYER_START.z));
  // 复用对象，避免每帧 new（射线检测每帧都跑）
  const ray = useRef(new THREE.Raycaster());
  const vOrigin = useRef(new THREE.Vector3());
  const vDesired = useRef(new THREE.Vector3());
  const vDir = useRef(new THREE.Vector3());
  const vGoal = useRef(new THREE.Vector3());
  const vLook = useRef(new THREE.Vector3());

  useFrame((_s, d) => {
    const p = playerPosRef.current;
    const off = cinematic ? CAM_OFFSET_CINEMATIC : CAM_OFFSET;

    // 1) 理想机位：固定偏移绕 Y 轴按 camYaw 旋转（Y 跟随地形高度，不硬编码到世界 Y=0）
    const py = playerYRef.current;
    if (cinematic) {
      // 演出模式：忽略玩家视角，相机固定在玩家正后方
      vDesired.current.set(p.x + off.x, py + off.y, p.z + off.z);
    } else {
      const yaw = camYawRef.current;
      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      vDesired.current.set(
        p.x + cosY * off.x - sinY * off.z,
        py + off.y,
        p.z + sinY * off.x + cosY * off.z,
      );
    }
    vOrigin.current.set(p.x, py + LOOK_Y, p.z);

    // 2) 遮挡处理（仅日常跟随）
    vGoal.current.copy(vDesired.current);
    const occ = occluderRef.current;
    if (!cinematic && occ) {
      vDir.current.copy(vDesired.current).sub(vOrigin.current);
      const fullDist = vDir.current.length();
      if (fullDist > 1e-3) {
        vDir.current.multiplyScalar(1 / fullDist);
        ray.current.set(vOrigin.current, vDir.current);
        ray.current.far = fullDist;
        const hits = ray.current.intersectObject(occ, true);
        if (hits.length) {
          const dist = Math.max(CAM_MIN_DIST, hits[0].distance - CAM_OCCLUDE_MARGIN);
          vGoal.current.copy(vOrigin.current).addScaledVector(vDir.current, dist);
        }
      }
    }

    // 3) 平滑
    const curDist = cur.current.distanceTo(vOrigin.current);
    const goalDist = vGoal.current.distanceTo(vOrigin.current);
    const k = cinematic ? d * 2 : (goalDist < curDist ? d * 16 : d * 4);
    cur.current.lerp(vGoal.current, Math.min(1, k));
    camera.position.copy(cur.current);

    // 4) 视线目标：看主角（跟随 yaw），演出抬高看月亮
    if (cinematic) {
      vLook.current.set(p.x, LOOK_Y_CINEMATIC, p.z - LOOK_AHEAD_CINEMATIC);
    } else {
      vLook.current.set(p.x, py + LOOK_Y, p.z);
    }
    curLook.current.lerp(vLook.current, Math.min(1, d * (cinematic ? 2 : 6)));
    camera.lookAt(curLook.current);
  });
  return null;
}

// ── sky & lights — 按 SkyPhase lerp 过渡天穹渐变/雾/光照 + 月光 ────────────────
// 白天 → 黄昏 → 夜晚三档预设，切档时记录起止值，按各自时长 smoothstep 插值，不突变。
// 天穹是三色渐变（顶/中/地平线），由 GradientSky 的 shader uniform 承载，lerp 时逐色过渡。
type SkyPreset = {
  top: THREE.Color; mid: THREE.Color; horizon: THREE.Color; // 天穹三色渐变
  fog: THREE.Color;
  ambient: number; dir: number; moon: number; // 各光源强度
};
const SKY_PRESETS: Record<SkyPhase, SkyPreset> = {
  day:   { top: new THREE.Color(SKY.day.skyTop),   mid: new THREE.Color(SKY.day.skyMid),   horizon: new THREE.Color(SKY.day.skyHorizon),   fog: new THREE.Color(SKY.day.fogColor),   ambient: 1.5,  dir: LIGHTING.sun.intensityDay, moon: 0.0 },
  dusk:  { top: new THREE.Color(SKY.dusk.skyTop),  mid: new THREE.Color(SKY.dusk.skyMid),  horizon: new THREE.Color(SKY.dusk.skyHorizon),  fog: new THREE.Color(SKY.dusk.fogColor),  ambient: 0.8,  dir: 1.2,                       moon: 0.0 },
  night: { top: new THREE.Color(SKY.night.skyTop), mid: new THREE.Color(SKY.night.skyMid), horizon: new THREE.Color(SKY.night.skyHorizon), fog: new THREE.Color(SKY.night.fogColor), ambient: 0.35, dir: 0.2,                       moon: 1.6 },
};
// 切档过渡时长（秒）：到黄昏 2s、到夜晚 3s、其余默认 2s
function phaseDuration(to: SkyPhase): number {
  if (to === 'dusk') return 2;
  if (to === 'night') return 3;
  return 2;
}

// ── 远山背景层 — 低多边形山体环（InstancedMesh，1 draw call），蓝青色被雾化融进天空 ──
// 跟随相机 xz（玩家永远在环心，走不到边）；锥体山峰，底部沉到地平线下只露尖，per-instance 三档蓝青色。


// ── 渐变天穹 — 大球 BackSide，shader 三色平滑渐变（顶/中/地平线），无 banding ──────
// 跟随相机位置（永远包裹住玩家），不写深度、不参与雾、不投影；颜色由外部 lerp 更新 uniform。
// 渐变用两段 smoothstep（horizon→mid→top），柔和过渡；轻微抖动（dither）消除大面积色带。
const SKY_VERT = /* glsl */`
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAG = /* glsl */`
  varying vec3 vWorldDir;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  void main() {
    // y: -1(底) → 0(地平线) → 1(顶)。只用上半球，下半球收敛到 horizon 色。
    float h = clamp(vWorldDir.y, 0.0, 1.0);
    // 地平线→中段（0~0.35），中段→顶（0.35~1），两段 smoothstep 拼接，过渡极平滑。
    vec3 lower = mix(uHorizon, uMid, smoothstep(0.0, 0.35, h));
    vec3 col   = mix(lower,    uTop, smoothstep(0.35, 1.0, h));
    // 轻微有序抖动，打散 8-bit 色带（premium 无 banding 的关键）
    float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    col += dither / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function GradientSky({ topRef, midRef, horizonRef }: {
  topRef: React.RefObject<THREE.Color>;
  midRef: React.RefObject<THREE.Color>;
  horizonRef: React.RefObject<THREE.Color>;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTop:     { value: topRef.current.clone() },
      uMid:     { value: midRef.current.clone() },
      uHorizon: { value: horizonRef.current.clone() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }), [topRef, midRef, horizonRef]);

  useFrame(({ camera }) => {
    // 天穹跟随相机，玩家永远在球心 → 天空无限远不会"走到边"
    if (meshRef.current) meshRef.current.position.copy(camera.position);
    (mat.uniforms.uTop.value as THREE.Color).copy(topRef.current);
    (mat.uniforms.uMid.value as THREE.Color).copy(midRef.current);
    (mat.uniforms.uHorizon.value as THREE.Color).copy(horizonRef.current);
  });

  // 半径 400：比雾远界(500)和相机视距都大，包住整个可视世界
  return (
    <mesh ref={meshRef} material={mat} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
}

function SkyAndLights({ phase }: { phase: SkyPhase }) {
  const dirRef = useRef<THREE.DirectionalLight>(null!);
  const moonRef = useRef<THREE.DirectionalLight>(null!);
  const ambRef = useRef<THREE.HemisphereLight>(null!);
  const fogRef = useRef<THREE.Fog>(null!);

  // 过渡状态：从 from 预设插到 to 预设，t 在 [0, dur] 累加
  const fromP = useRef<SkyPreset>(SKY_PRESETS.day);
  const toP = useRef<SkyPreset>(SKY_PRESETS.day);
  const dur = useRef(0);
  const elapsed = useRef(0);
  // 当前显示值（避免每帧 new Color）。天穹三色 + 雾色，供 GradientSky uniform 读取。
  const curTop = useRef(SKY_PRESETS.day.top.clone());
  const curMid = useRef(SKY_PRESETS.day.mid.clone());
  const curHorizon = useRef(SKY_PRESETS.day.horizon.clone());
  const curFog = useRef(SKY_PRESETS.day.fog.clone());

  // phase 变化 → 以"当前显示值"为起点开新过渡
  useEffect(() => {
    fromP.current = {
      top: curTop.current.clone(), mid: curMid.current.clone(), horizon: curHorizon.current.clone(),
      fog: curFog.current.clone(),
      ambient: ambRef.current?.intensity ?? toP.current.ambient,
      dir: dirRef.current?.intensity ?? toP.current.dir,
      moon: moonRef.current?.intensity ?? toP.current.moon,
    };
    toP.current = SKY_PRESETS[phase];
    dur.current = phaseDuration(phase);
    elapsed.current = 0;
  }, [phase]);

  useFrame((_s, d) => {
    if (dur.current <= 0) return;
    elapsed.current = Math.min(dur.current, elapsed.current + d);
    const raw = dur.current > 0 ? elapsed.current / dur.current : 1;
    const t = raw * raw * (3 - 2 * raw); // smoothstep
    const f = fromP.current, to = toP.current;
    curTop.current.copy(f.top).lerp(to.top, t);
    curMid.current.copy(f.mid).lerp(to.mid, t);
    curHorizon.current.copy(f.horizon).lerp(to.horizon, t);
    curFog.current.copy(f.fog).lerp(to.fog, t);
    if (fogRef.current) fogRef.current.color.copy(curFog.current);
    if (ambRef.current) ambRef.current.intensity = THREE.MathUtils.lerp(f.ambient, to.ambient, t);
    if (dirRef.current) dirRef.current.intensity = THREE.MathUtils.lerp(f.dir, to.dir, t);
    if (moonRef.current) moonRef.current.intensity = THREE.MathUtils.lerp(f.moon, to.moon, t);
  });

  return (
    <>
      <GradientSky topRef={curTop} midRef={curMid} horizonRef={curHorizon} />
      {/* 指数雾：远处渐蓝渐淡，比线性雾衰减更自然，增加大气纵深感；雾色与地平线天色接近 → 远景融入天空 */}
      <fog ref={fogRef} attach="fog" args={[SKY.day.fogColor, SKY.day.fogNear, SKY.day.fogFar]} />
      {/* 半球光：天空冷蓝 + 地面暖绿，去掉灰色阴影，暗部带颜色 */}
      <hemisphereLight
        ref={ambRef}
        args={[LIGHTING.hemi.sky, LIGHTING.hemi.ground, LIGHTING.hemi.intensity]}
      />
      {/* 环境补光：软化整体暗部，保证儿童可读性 */}
      {/* 对侧冷补光：从阳光对侧斜打淡蓝光，软化暗部、补冷调天光，立体不脏。无投影省开销 */}
      <directionalLight position={LIGHTING.fill.position} intensity={LIGHTING.fill.intensity} color={LIGHTING.fill.color} />
      {/* 主阳光：暖金色，高角度斜射，长阴影增加立体感 */}
      <directionalLight
        ref={dirRef}
        position={LIGHTING.sun.position}
        intensity={SKY_PRESETS.day.dir}
        color={LIGHTING.sun.color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={8}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-far={160}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      {/* 月光：冷色淡蓝白，仅夜晚有强度 */}
      <directionalLight ref={moonRef} position={LIGHTING.moon.position} intensity={0} color={LIGHTING.moon.color} />
    </>
  );
}

// ── moons — 假月亮（过场）/ 真月亮（升起）────────────────────────────────────
// 假月亮：钉在世界点，轻浮动 + 自转；玩家走近 < REACH 触发 onReach（一次）。
function FakeMoon({ pos, playerPosRef, onReach }: {
  pos: Vec2; playerPosRef: React.RefObject<Vec2>; onReach: () => void;
}) {
  const { scene } = useGLTF(FAKE_MOON_URL);
  const cloned = useMemo(() => scene.clone(), [scene]);
  const ref = useRef<THREE.Group>(null!);
  const reached = useRef(false);
  const REACH = 2.5 * ACTOR_SCALE;
  const baseY = 2.2 * ACTOR_SCALE; // 离地高度（截图后可调）

  useFrame((st, d) => {
    if (!ref.current) return;
    ref.current.rotation.y += d * 0.6;
    ref.current.position.y = baseY + Math.sin(st.clock.elapsedTime * 1.2) * 0.25 * ACTOR_SCALE;
    if (reached.current) return;
    const p = playerPosRef.current;
    const dx = p.x - pos.x, dz = p.z - pos.z;
    if (dx * dx + dz * dz < REACH * REACH) {
      reached.current = true;
      onReach();
    }
  });

  return (
    <group ref={ref} position={[pos.x, baseY, pos.z]} scale={2.5 * ACTOR_SCALE}>
      <primitive object={cloned} />
    </group>
  );
}

// 真月亮：从地平线（y=START_Y）升到 END_Y，约 RISE_DUR 秒，发光；升起完成回调一次。
function RealMoon({ pos, onRisen }: { pos: Vec2; onRisen: () => void }) {
  const { scene } = useGLTF(REAL_MOON_URL);
  const cloned = useMemo(() => {
    const c = scene.clone();
    // 给所有材质加自发光，让月亮"亮"起来
    c.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        if ('emissive' in mat) {
          mat.emissive = new THREE.Color('#FFF7D6');
          mat.emissiveIntensity = 1.4;
        }
        mesh.material = mat;
      }
    });
    return c;
  }, [scene]);
  const ref = useRef<THREE.Group>(null!);
  const t = useRef(0);
  const risen = useRef(false);
  const START_Y = -8;
  const END_Y = 34;
  const RISE_DUR = 4;

  useFrame((_s, d) => {
    if (!ref.current) return;
    ref.current.rotation.y += d * 0.15;
    if (t.current < RISE_DUR) {
      t.current = Math.min(RISE_DUR, t.current + d);
      const raw = t.current / RISE_DUR;
      const e = raw * raw * (3 - 2 * raw); // smoothstep 缓起缓停
      ref.current.position.y = THREE.MathUtils.lerp(START_Y, END_Y, e);
      if (t.current >= RISE_DUR && !risen.current) {
        risen.current = true;
        onRisen();
      }
    }
  });

  return (
    <group ref={ref} position={[pos.x, START_Y, pos.z]} scale={5}>
      <primitive object={cloned} />
      {/* 光晕：月亮自带一个暖白点光源 */}
      <pointLight color="#FFF7D6" intensity={3} distance={120} decay={1.2} />
    </group>
  );
}

// ── main ───────────────────────────────────────────────────────────────────
interface ParkourSceneProps {
  velocityRef: React.RefObject<Vec2>;
  playerPosRef: React.RefObject<Vec2>;
  camYawRef: React.RefObject<number>;
  collectedIds: Set<number>;
  hitEffect: string | null;
  paused?: boolean; // NPC 对话弹出时暂停障碍生成（玩家也冻结）
  skyPhase?: SkyPhase;        // 天空阶段（白天/黄昏/夜晚）
  fakeMoonPos?: Vec2 | null;  // 非空则刷出假月亮于此世界坐标
  realMoonPos?: Vec2 | null;  // 非空则真月亮升起于此世界坐标
  onCollect: (id: number, type: StaticCollectible['type']) => void;
  focusStarId?: number | null;
  guideStarId?: number | null;
  obstacleBurstId?: number | null;
  softFocusInteractives?: boolean;
  onObstacleHit: (id: number, variant: ActiveObstacle['variant'], position: Vec2) => void;
  onWorldPromptChange?: (prompt: WorldPrompt) => void;
  onNpcApproach: (index: number) => void;
  onFakeMoonReach?: () => void; // 玩家走近假月亮
  onRealMoonRisen?: () => void; // 真月亮升起完成
  onDebugUpdate?: (info: DebugInfo) => void;
  debugYRef?: React.RefObject<number | null>;
  creekStarPositions?: CreekStarPos[];
  npcPositions?: NpcPos[];
  landStarPositions?: { id: number; x: number; z: number }[];
}

export default function ParkourScene({ velocityRef, playerPosRef, camYawRef, collectedIds, hitEffect, paused = false, skyPhase = 'day', fakeMoonPos = null, realMoonPos = null, focusStarId = null, guideStarId = null, obstacleBurstId = null, softFocusInteractives = false, onCollect, onObstacleHit, onNpcApproach, onWorldPromptChange, onFakeMoonReach, onRealMoonRisen, onDebugUpdate, debugYRef, creekStarPositions, npcPositions, landStarPositions }: ParkourSceneProps) {
  const creekItems = useMemo(
    () => creekStarsAsCollectibles(creekStarPositions ?? CREEK_STAR_POSITIONS),
    [creekStarPositions]
  );
  const onPromptChange = useMemo(() => (prompt: WorldPrompt) => onWorldPromptChange?.(prompt), [onWorldPromptChange]);
  return (
    <>
      <SkyAndLights phase={skyPhase} />

      <CameraRig playerPosRef={playerPosRef} camYawRef={camYawRef} cinematic={!!realMoonPos} />

      <React.Suspense fallback={null}>
        <TerrainModel />
      </React.Suspense>

      <React.Suspense fallback={null}>
        <Character velocityRef={velocityRef} playerPosRef={playerPosRef} hitEffect={hitEffect} debugYRef={debugYRef} />
      </React.Suspense>

      <React.Suspense fallback={null}>
        <StarsGroup
          collected={collectedIds}
          playerPosRef={playerPosRef}
          focusStarId={focusStarId}
          guideStarId={guideStarId}
          softFocus={softFocusInteractives}
          onCollect={onCollect}
          extraItems={creekItems}
          landOverrides={landStarPositions}
          onPromptChange={onPromptChange}
        />
      </React.Suspense>

      <NpcGroup playerPosRef={playerPosRef} softFocus={softFocusInteractives} onNpcApproach={onNpcApproach} positions={npcPositions} />

      <ObstacleField
        velocityRef={velocityRef}
        playerPosRef={playerPosRef}
        hitBurstId={obstacleBurstId}
        softFocus={softFocusInteractives}
        onHit={onObstacleHit}
        onPromptChange={onPromptChange}
        paused={paused}
      />

      {fakeMoonPos && (
        <React.Suspense fallback={null}>
          <FakeMoon pos={fakeMoonPos} playerPosRef={playerPosRef} onReach={() => onFakeMoonReach?.()} />
        </React.Suspense>
      )}

      {realMoonPos && (
        <React.Suspense fallback={null}>
          <RealMoon pos={realMoonPos} onRisen={() => onRealMoonRisen?.()} />
        </React.Suspense>
      )}


      {(DEBUG_MODE || SHOW_COORDS) && onDebugUpdate && (
        <DebugTracker playerPosRef={playerPosRef} onDebugUpdate={onDebugUpdate} npcPositions={npcPositions} />
      )}

      {CLOUD_DATA.map((c, i) => <Cloud key={i} pos={c.pos} spd={c.spd} />)}
    </>
  );
}

useGLTF.preload(`${PK}/star.glb`);
useGLTF.preload(`${PK}/rocks.glb`);
useGLTF.preload(`${PK}/barrel.glb`);
useGLTF.preload(`${PK}/crate.glb`);
useGLTF.preload(CHARACTER_URL);
useGLTF.preload(TERRAIN_URL); // scene-terrain-opt.glb（Meshopt 压缩版，234MB→10MB）
useGLTF.preload(TREE_ROUND_URL);
useGLTF.preload(BUSH_URL);
useGLTF.preload(FLOWER_DAISY_URL);
useGLTF.preload(FLOWER_YELLOW_URL);
useGLTF.preload(PLANT_GREEN_URL);
useGLTF.preload(FAKE_MOON_URL);
useGLTF.preload(REAL_MOON_URL);
NPC_URLS.forEach(url => useGLTF.preload(url));
