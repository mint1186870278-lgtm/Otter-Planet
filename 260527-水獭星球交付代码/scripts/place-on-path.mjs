// scripts/place-on-path.mjs
// 从地形 scene-terrain-opt.glb 的 102 块 NURBS 石板真实世界坐标算出"路中线"，
// 再沿路自动生成 9 颗星 + 3 个 NPC 的坐标（贴石板、间距≥4.5、按段顺序：星星→NPC）。
// 用 three.js GLTFLoader 离线复现 TerrainModel 的 slab 数学（含 Meshopt 反量化），
// 输出与游戏运行时一致的世界坐标。地形若改动，重跑本脚本重算坐标即可。
//
// 用法：node scripts/place-on-path.mjs
// 输出：打印可直接粘贴进 STAR_POSITIONS / NPC_POSITIONS 的代码块。

import * as THREE from 'three';
// GLTFLoader 在 Node 下会碰 image 解码的浏览器 API（我们只要几何/节点，stub 掉即可）。
globalThis.self = globalThis;
globalThis.URL = globalThis.URL || class { static createObjectURL() { return ''; } static revokeObjectURL() {} };
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.Image = class { set src(_v) { this.onload && this.onload(); } addEventListener(e, cb) { if (e === 'load') this._l = cb; } };
globalThis.document = globalThis.document || { createElementNS: () => ({ getContext: () => null, toDataURL: () => '' }), createElement: () => ({ getContext: () => null }) };

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import fs from 'node:fs';

// ── 与 ParkourScene.tsx 一致的常量 ──
const TERRAIN_SIZE = 240;
const TERRAIN_ANCHOR_TO = { x: 0, z: 112 };
const CHAR_FOOT_Y = 0;

// ── 1) 用 three.js 加载并复现 TerrainModel 的 slab 世界坐标 ──
const buf = fs.readFileSync('public/model-site/scene-terrain-opt.glb');
const loader = new GLTFLoader();
await MeshoptDecoder.ready;
loader.setMeshoptDecoder(MeshoptDecoder);
const gltf = await new Promise((res, rej) =>
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const box = new THREE.Box3().setFromObject(scene);
const size = new THREE.Vector3();
box.getSize(size);
const autoScale = Math.max(size.x, size.z) > 0 ? TERRAIN_SIZE / Math.max(size.x, size.z) : 1;

const slabs = [];
scene.traverse(o => {
  if (!o.name || !o.name.startsWith('NURBS')) return;
  const b = new THREE.Box3().setFromObject(o);
  if (!isFinite(b.min.x)) return;
  if (b.max.y - b.min.y > 0.4) return; // 厚的不是地面石板
  slabs.push({ cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2, topY: b.max.y });
});

const zMax = Math.max(...slabs.map(s => s.cz));
const entry = slabs.filter(s => s.cz >= zMax - 0.5);
const seg = entry.length ? entry : slabs;
const anchorX = seg.reduce((a, s) => a + s.cx, 0) / seg.length;
const surfaceTopY = Math.max(...seg.map(s => s.topY));
const wo = [TERRAIN_ANCHOR_TO.x - autoScale * anchorX, CHAR_FOOT_Y - autoScale * surfaceTopY, TERRAIN_ANCHOR_TO.z - autoScale * zMax];

const world = slabs
  .map(s => ({ x: +(wo[0] + autoScale * s.cx).toFixed(2), z: +(wo[2] + autoScale * s.cz).toFixed(2) }))
  .sort((a, b) => b.z - a.z);
console.log(`slabs=${world.length}  autoScale=${autoScale.toFixed(4)}`);

// ── 2) 路中线：每个 z 带取"最密簇"中心 + 平滑 ──
const STEP = 6, BIN = 4;
const bands = {};
for (const s of world) { const k = Math.round(s.z / STEP) * STEP; (bands[k] || (bands[k] = [])).push(s.x); }
const zsorted = Object.keys(bands).map(Number).sort((a, b) => b - a);
const densestX = xs => {
  const h = {}; let best = null, bn = -1;
  for (const x of xs) { const k = Math.round(x / BIN) * BIN; h[k] = (h[k] || 0) + 1; if (h[k] > bn) { bn = h[k]; best = k; } }
  const near = xs.filter(x => Math.abs(x - best) <= BIN);
  return near.reduce((a, b) => a + b, 0) / near.length;
};
const raw = zsorted.map(z => ({ z, x: densestX(bands[z]) }));
const line = raw.map((p, i) => ({ z: p.z, x: +(((raw[Math.max(0, i - 1)].x + p.x + raw[Math.min(raw.length - 1, i + 1)].x) / 3)).toFixed(1) }));
const cx = z => {
  if (z >= line[0].z) return line[0].x;
  if (z <= line.at(-1).z) return line.at(-1).x;
  for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1]; if (z <= a.z && z >= b.z) { const t = (a.z - z) / (a.z - b.z); return a.x + (b.x - a.x) * t; } }
  return 0;
};

// ── 3) 沿路放置：贪心避让（间距≥MINSP），近→远，星星与 NPC 交错 ──
const placed = [], MINSP = 4.5;
const snapAvoid = (x, z) => {
  const cand = world.map(s => ({ x: s.x, z: s.z, d: Math.hypot(s.x - x, s.z - z) })).sort((a, b) => a.d - b.d);
  const c = cand.find(c => placed.every(p => Math.hypot(p.x - c.x, p.z - c.z) >= MINSP)) || cand[0];
  placed.push(c);
  return { x: +c.x.toFixed(1), z: +c.z.toFixed(1) };
};
// 9 颗星沿路【均匀】铺开：z 从 92(出生点附近) 到 -28(最远)，等距约 15 单位一颗。
// 每段 3 星后放一个 NPC；NPC 的 z 卡在两颗星中间、横向(dx)拉开，避免和星星/彼此挤一起。
// 段1: S0~S2 → NPC1 ; 段2: S3~S5 → NPC2 ; 段3: S6~S8 → NPC3。
const seqDef = [
  { k: 'S', id: 0, z: 92, dx: -2 }, { k: 'S', id: 1, z: 77, dx: +4 }, { k: 'S', id: 2, z: 62, dx: -3 },
  { k: 'N', id: 0, z: 54, dx: +6 },
  { k: 'S', id: 3, z: 47, dx: +3 }, { k: 'S', id: 4, z: 32, dx: -4 }, { k: 'S', id: 5, z: 17, dx: +3 },
  { k: 'N', id: 1, z: 6, dx: -7 },
  { k: 'S', id: 6, z: 2, dx: -3 }, { k: 'S', id: 7, z: -13, dx: +3 }, { k: 'S', id: 8, z: -28, dx: -2 },
  { k: 'N', id: 2, z: -22, dx: +7 },
];
const stars = [], npcs = [];
for (const it of seqDef) { const p = snapAvoid(cx(it.z) + it.dx, it.z); if (it.k === 'S') stars[it.id] = { id: it.id, ...p }; else npcs[it.id] = p; }

console.log('\n--- STAR_POSITIONS body ---');
console.log(stars.map(s => `  { id: ${s.id}, type: 'star', x: ${s.x}, z: ${s.z} },`).join('\n'));
console.log('\n--- NPC_POSITIONS body ---');
console.log(npcs.map((n, k) => `  { x: ${n.x}, z: ${n.z} }, // NPC${k + 1}`).join('\n'));
