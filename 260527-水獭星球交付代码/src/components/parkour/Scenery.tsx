// src/components/parkour/Scenery.tsx
// 跑酷静态环境子系统——从 ParkourScene.tsx 抽出。
//   TerrainModel：单块大地图 GLB（自动缩放/步道对齐/材质分色/登记为相机遮挡体 occluderRef）。
//   Cloud + CLOUD_DATA：装饰云，横向飘动。
//   TreeScatter / GroundDetail / GLBFlowers：程序化散布的树林/地面花草（固定种子 PRNG 一次性生成 + 射线吸附地面）。
// 依赖共享层：config（视觉/布局常量）、parkourConstants（尺寸/星位/NPC位）、runtime（occluderRef/snapGroundY）。

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { TERRAIN_SIZE, STAR_POSITIONS, NPC_POSITIONS } from '../parkourConstants';
import {
  PINE_DEPTH, TERRAIN_URL, TERRAIN_MATS, SPRUCE_GROUND_MAX_Y, RED_FLOWER_SCALE,
  TERRAIN_ANCHOR_TO, TERRAIN_X_OFFSET, TERRAIN_Y_OFFSET, TERRAIN_Z_OFFSET,
  CHAR_FOOT_Y, HEIGHT_SPLIT_Y, PLAYER_START,
  GROUND_DETAIL, FLOWER_GLB, SCATTER_TINT, TREE_ROUND_URL, BUSH_URL,
} from './config';
import { occluderRef, snapGroundY } from './runtime';

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
export function TerrainModel() {
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
export const CLOUD_DATA: Array<{ pos: [number, number, number]; spd: number }> = [
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

export function Cloud({ pos, spd }: { pos: [number, number, number]; spd: number }) {
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
export function GroundDetail() {
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

export function GLBFlowers() {
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

export function TreeScatter() {
  const round = useMemo(() => TREE_SCATTER.filter(t => t.kind === 'round'), []);
  const bush = useMemo(() => TREE_SCATTER.filter(t => t.kind === 'bush'), []);
  return (
    <React.Suspense fallback={null}>
      {round.length > 0 && <InstancedScatter key={`round-${round.length}`} url={TREE_ROUND_URL} items={round} tint={SCATTER_TINT.round} />}
      {bush.length > 0 && <InstancedScatter key={`bush-${bush.length}`} url={BUSH_URL} items={bush} tint={SCATTER_TINT.bush} />}
    </React.Suspense>
  );
}
