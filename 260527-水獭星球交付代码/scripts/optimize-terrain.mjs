// scripts/optimize-terrain.mjs
// 把 234MB 的 scene-terrain.glb 用 Meshopt 压到 ~10MB，保留全部 102 块 NURBS 石板节点。
// 跑酷地形的"石板路"是 102 个名为 "NURBS 路径(.00x)" 的节点，TerrainModel 靠遍历这些
// 节点名 + bbox 算出生点/路面锚点（ParkourScene.tsx:248-271）。
// ⚠️ 绝不加 instance()/join()/flatten()/simplify()——它们会合并/删除/形变 NURBS 节点，
//    破坏石板路对齐。本管线只用 dedup+prune+meshopt，已端到端验证 NURBS 104→104 全保留。
//
// 用法：npm run optimize:terrain
// 输出：public/model-site/scene-terrain-opt.glb（新文件，不覆盖原始，便于回退/复跑）

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

await MeshoptEncoder.ready;

// 母文件已归档到项目根 _archive-large-source/（不进打包），优先读它；兼容旧路径。
const SRC = fs.existsSync('_archive-large-source/scene-terrain.glb')
  ? '_archive-large-source/scene-terrain.glb'
  : 'public/model-site/scene-terrain.glb';
const OUT = 'public/model-site/scene-terrain-opt.glb';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(SRC);
const root = doc.getRoot();
const countNurbs = () =>
  root.listNodes().map(n => n.getName() || '').filter(n => n.startsWith('NURBS')).length;
const nurbsBefore = countNurbs();

await doc.transform(
  dedup(),                                // 折叠 24 个完全相同的树几何（共享底层数据，保留所有节点）
  prune({ keepLeaves: true }),            // 删未引用的孤儿数据（石板节点都在用，不会被删）
  // 贴图压缩（不碰几何/节点，NURBS 安全）：3 张 2048² JPEG ≈5.3MB → WebP，省 ~4MB。
  // baseColor 是地面可见颜色，保原分辨率只转 WebP（保清晰）；法线/金属粗糙度降分辨率。
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86, slots: /baseColor/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [1024, 1024], slots: /normal/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [512, 512], slots: /metallicRoughness/ }),
  meshopt({ encoder: MeshoptEncoder }),   // 压缩 f32 几何（Meshopt，drei 默认自动解码、无 CDN 依赖）
);

const nurbsAfter = countNurbs();
await io.write(OUT, doc);

const o = fs.statSync(SRC).size, s = fs.statSync(OUT).size;
console.log(`NURBS 节点: ${nurbsBefore} -> ${nurbsAfter}  (保留=${nurbsBefore === nurbsAfter})`);
console.log(`体积: ${(o / 1048576).toFixed(1)}MB -> ${(s / 1048576).toFixed(2)}MB  (${(o / s).toFixed(1)}x)`);

// 安全闸：NURBS 节点数一旦变化，石板路对齐就会失效，删掉坏产出并报错退出。
if (nurbsBefore !== nurbsAfter) {
  fs.rmSync(OUT, { force: true });
  console.error('❌ NURBS 节点数变了，石板路会失效，已中止并删除坏产出！');
  process.exit(1);
}
console.log('✅ 完成：' + OUT);
