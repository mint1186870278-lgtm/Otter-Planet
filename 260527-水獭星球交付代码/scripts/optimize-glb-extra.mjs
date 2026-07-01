// 给还没做 Meshopt 的树/灌木 glb 补几何压缩（贴图已是小 webp，体积全在几何）。
// Meshopt 只做量化+编码，不改拓扑/节点，drei 自动解码。与地形同一套管线。
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';

await MeshoptEncoder.ready;

const FILES = [
  'public/3d-tree/optimized/bush.glb',
  'public/3d-tree/optimized/tree1-round.glb',
];

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

for (const f of FILES) {
  if (!fs.existsSync(f)) { console.log('✗ 缺失 ' + f); continue; }
  const before = fs.statSync(f).size;
  const doc = await io.read(f);
  const nodesBefore = doc.getRoot().listNodes().length;
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder }),
  );
  const nodesAfter = doc.getRoot().listNodes().length;
  await io.write(f, doc);
  const after = fs.statSync(f).size;
  console.log(`${(before/1048576).toFixed(2)}MB → ${(after/1048576).toFixed(2)}MB  节点 ${nodesBefore}→${nodesAfter}  ${f}`);
}
