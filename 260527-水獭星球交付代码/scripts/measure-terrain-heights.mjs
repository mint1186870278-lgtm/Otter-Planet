// scripts/measure-terrain-heights.mjs
// 只读诊断脚本：实测 scene-terrain-opt.glb 里每个网格的「世界 Y 范围」，
// 精确复刻 Scenery.tsx/TerrainModel 的运行时变换（autoScale + offset），
// 好判断草地大网格 vs 松树冠 各自落在什么高度、SPRUCE_GROUND_MAX_Y 该取多少。
// 不写任何文件、不改 glb。用法：node scripts/measure-terrain-heights.mjs

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const FILE = 'public/model-site/scene-terrain-opt.glb';
const TERRAIN_SIZE = 240;   // parkourConstants.ts
const CHAR_FOOT_Y = 0;      // config.ts

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

// 4x4 (列主序 glTF) 变换一个点
function apply(m, x, y, z) {
  return [
    m[0]*x + m[4]*y + m[8]*z  + m[12],
    m[1]*x + m[5]*y + m[9]*z  + m[13],
    m[2]*x + m[6]*y + m[10]*z + m[14],
  ];
}

const doc = await io.read(FILE);
const root = doc.getRoot();

// 收集：每个「挂了 Mesh 的 Node」的世界 Y 范围（模型自身坐标系，未叠加运行时 autoScale/offset）
// + 材质名。gltf-transform 的 Node.getWorldMatrix() 已含父链 TRS。
const meshNodes = [];
root.listNodes().forEach((node) => {
  const mesh = node.getMesh();
  if (!mesh) return;
  const wm = node.getWorldMatrix(); // 16 元素列主序
  mesh.listPrimitives().forEach((prim) => {
    const pos = prim.getAttribute('POSITION');
    if (!pos) return;
    const matName = prim.getMaterial()?.getName() || '(no-mat)';
    let minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const el = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      const [wx, wy, wz] = apply(wm, el[0], el[1], el[2]);
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
    }
    meshNodes.push({
      node: node.getName() || '(unnamed)',
      mat: matName,
      minY, maxY, cy: (minY + maxY) / 2,
      minX, maxX, minZ, maxZ,
    });
  });
});

// ── 复刻运行时 autoScale：整体 bbox 最长水平轴铺满 TERRAIN_SIZE ──
let gMinX = Infinity, gMaxX = -Infinity, gMinZ = Infinity, gMaxZ = -Infinity, gMaxY = -Infinity;
for (const m of meshNodes) {
  gMinX = Math.min(gMinX, m.minX); gMaxX = Math.max(gMaxX, m.maxX);
  gMinZ = Math.min(gMinZ, m.minZ); gMaxZ = Math.max(gMaxZ, m.maxZ);
  gMaxY = Math.max(gMaxY, m.maxY);
}
const sizeX = gMaxX - gMinX, sizeZ = gMaxZ - gMinZ;
const longest = Math.max(sizeX, sizeZ);
const autoScale = longest > 0 ? TERRAIN_SIZE / longest : 1;

// 复刻 surfaceTopY：入口 NURBS 石板（薄片 dy<0.4）最近端(z 最大簇)的顶面
const slabs = meshNodes.filter(m => m.node.startsWith('NURBS') && (m.maxY - m.minY) < 0.4);
let surfaceTopY = gMaxY;
if (slabs.length) {
  const zMax = Math.max(...slabs.map(s => (s.minZ + s.maxZ) / 2));
  const entry = slabs.filter(s => (s.minZ + s.maxZ) / 2 >= zMax - 0.5);
  const seg = entry.length ? entry : slabs;
  surfaceTopY = Math.max(...seg.map(s => s.maxY));
}
const offsetY = CHAR_FOOT_Y - autoScale * surfaceTopY;
const toWorldY = (modelY) => offsetY + autoScale * modelY;

console.log(`\n=== 运行时变换 ===`);
console.log(`autoScale = ${autoScale.toFixed(5)}  (TERRAIN_SIZE ${TERRAIN_SIZE} / longest水平轴 ${longest.toFixed(2)})`);
console.log(`surfaceTopY(模型) = ${surfaceTopY.toFixed(4)}  →  offsetY = ${offsetY.toFixed(4)}`);
console.log(`世界Y = offsetY + autoScale * 模型Y\n`);

// ── 只看 SpruceTreeLeaf（草地/松树冠同名冲突的那一个）──
const spruce = meshNodes.filter(m => m.mat.startsWith('SpruceTreeLeaf') || m.node.startsWith('SpruceTreeLeaf'));
console.log(`=== SpruceTreeLeaf 网格（共 ${spruce.length} 个）：按世界 cy 排序 ===`);
console.log(`当前阈值 SPRUCE_GROUND_MAX_Y=3 是与「模型 cy」比（代码在 useEffect 里其实拿的是世界 cy，见下两列对照）`);
console.log(`${'节点/材质'.padEnd(34)} ${'模型cy'.padStart(9)} ${'世界cy'.padStart(9)} ${'世界minY'.padStart(9)} ${'世界maxY'.padStart(9)}`);
spruce.sort((a, b) => a.cy - b.cy).forEach(m => {
  const label = `${m.node} / ${m.mat}`.slice(0, 33);
  console.log(`${label.padEnd(34)} ${m.cy.toFixed(2).padStart(9)} ${toWorldY(m.cy).toFixed(2).padStart(9)} ${toWorldY(m.minY).toFixed(2).padStart(9)} ${toWorldY(m.maxY).toFixed(2).padStart(9)}`);
});

// ── 给建议阈值：找草地(贴地大网格,面积最大且低)与松树冠(高)之间的世界Y间隙 ──
if (spruce.length >= 2) {
  const cysWorld = spruce.map(m => toWorldY(m.cy)).sort((a, b) => a - b);
  let bestGap = 0, bestMid = null;
  for (let i = 1; i < cysWorld.length; i++) {
    const gap = cysWorld[i] - cysWorld[i - 1];
    if (gap > bestGap) { bestGap = gap; bestMid = (cysWorld[i] + cysWorld[i - 1]) / 2; }
  }
  console.log(`\n=== 建议（世界坐标） ===`);
  console.log(`最大高度间隙 = ${bestGap.toFixed(2)}，中点 ≈ ${bestMid?.toFixed(2)}`);
  console.log(`→ 若代码比较的是【世界 cy】，SPRUCE_GROUND_MAX_Y 应取 ≈ ${bestMid?.toFixed(1)}（草地在下、松树冠在上）`);
}
