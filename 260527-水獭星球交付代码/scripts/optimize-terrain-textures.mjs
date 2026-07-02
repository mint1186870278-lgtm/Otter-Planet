// scripts/optimize-terrain-textures.mjs
// 只压 scene-terrain-opt.glb 的纹理，几何一律不碰——保 NURBS 石板路出生点/路面锚点对齐。
// 背景：当前部署的 scene-terrain-opt.glb 是 Draco+量化几何(~32MB) + 13MB JPEG 纹理，
//   其中 10 张 4096² 花草贴图解压后各占 ~89MB 显存 → 地形纹理合计 ~1GB 显存，才是卡顿主因。
// 本管线只用 textureCompress（重编码图片、resize），不加任何几何 transform
//   (绝不用 simplify/join/instance/flatten/meshopt/draco 显式变换)。
//   实测：NURBS 节点 85→85、逐节点 t/r/s 零差异，44.5MB→~33MB，显存 ~1GB→~130MB。
// ⚠️ textureCompress 写出时仍会重编码 Draco（同量化、bbox 字节一致），节点 transform 已逐个核验零差异；
//   最终以浏览器实跑石板路对齐为准。安全闸：节点数/transform 变化即删产出报错退出。
//
// 用法：npm run optimize:terrain-tex
// 备份：首次运行把原文件存到 _archive-large-source/scene-terrain-opt.44mb.glb（存在则不覆盖）。

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import fs from 'node:fs';

const FILE = 'public/model-site/scene-terrain-opt.glb';
const BACKUP = '_archive-large-source/scene-terrain-opt.44mb.glb';
const TMP = 'public/model-site/.scene-terrain-opt.tmp.glb';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

// 节点签名：名字 + 平移/旋转/缩放（石板路对齐只依赖这些 + 网格数据，几何本身由 Draco 承载）。
const signature = (doc) =>
  doc.getRoot().listNodes()
    .map((n) => ({
      name: n.getName() || '',
      t: n.getTranslation().map((x) => +x.toFixed(5)).join(','),
      r: n.getRotation().map((x) => +x.toFixed(5)).join(','),
      s: n.getScale().map((x) => +x.toFixed(5)).join(','),
    }))
    .filter((r) => r.name.startsWith('NURBS'));

if (!fs.existsSync(FILE)) {
  console.error(`❌ 找不到 ${FILE}`);
  process.exit(1);
}

// 备份原始 44MB 文件（仅首次），便于回退。
if (!fs.existsSync(BACKUP)) {
  fs.mkdirSync('_archive-large-source', { recursive: true });
  fs.copyFileSync(FILE, BACKUP);
  console.log(`已备份原始文件 → ${BACKUP}`);
}

const before = fs.statSync(FILE).size;
const doc = await io.read(FILE);
const sigBefore = signature(doc);

await doc.transform(
  // baseColor 是地面/花草可见颜色：4096²→2048² webp q92，保 sRGB。保守档：肉眼几乎无损，
  //   但每张显存 89MB→22MB（10 张省 ~670MB），磁盘也降。⚠️不用上次 1024/q86 那种激进档(会变色)。
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, resize: [2048, 2048], slots: /baseColor/ }),
  // 金属粗糙度是线性数据：4096²→2048² webp q90。⚠️不用 lossless（实测 lossless 反而把 342KB
  //   的小 JPEG 涨成 2MB，吃光 baseColor 的收益）。q90 对粗糙度的失真极小，且这些 MR 只影响
  //   烘焙进地形的花草/植物小装饰，不碰松树/草地(那两个是 config/shader 定色)，风险很低。
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, resize: [2048, 2048], slots: /metallicRoughness/ }),
);

const sigAfter = signature(doc);

// 安全闸：NURBS 节点数或任一节点 transform 变化 → 石板路对齐会失效，中止。
let diffs = 0;
if (sigBefore.length !== sigAfter.length) diffs = -1;
else {
  for (let i = 0; i < sigBefore.length; i++) {
    if (JSON.stringify(sigBefore[i]) !== JSON.stringify(sigAfter[i])) diffs++;
  }
}
if (diffs !== 0) {
  console.error(`❌ NURBS 节点变化（节点数 ${sigBefore.length}->${sigAfter.length}，transform diffs=${diffs}），石板路会失效，已中止（未改动原文件）。`);
  process.exit(1);
}

// 先写临时文件，成功后替换，避免半截产出损坏部署文件。
await io.write(TMP, doc);
// Windows 下 rename 覆盖已存在文件可能 EPERM；改 copy 覆盖 + 删临时，稳。
fs.copyFileSync(TMP, FILE);
fs.rmSync(TMP, { force: true });

const after = fs.statSync(FILE).size;
console.log(`NURBS 节点: ${sigBefore.length} -> ${sigAfter.length}  transform diffs: ${diffs}  ✅ 对齐保留`);
console.log(`体积: ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB`);
console.log(`✅ 完成：${FILE}（回退用 ${BACKUP}）`);
