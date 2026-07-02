// scripts/optimize-character.mjs
// 主角 idle.glb 降包：几何 Meshopt 压缩 + 贴图 2048²→1024² webp。骨骼动画完整保留。
// 背景：当前 idle.glb 23MB，extensionsUsed=none（几何零压缩，21.5万顶点 15.75MB）+ 4×2048² 贴图 8MB。
//   主角在屏上很小，1024² 贴图肉眼无差；Meshopt 只做量化+编码、不改拓扑/骨骼/动画，drei 自动解码。
// 安全：首次运行备份原文件到 _archive-large-source/；产出先写临时文件再原子替换。
//   动画数量/骨骼节点数变化即报错退出（防止误伤待机动作）。
// 用法：npm run optimize:character

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

await MeshoptEncoder.ready;

const FILE = 'public/main-character-other-position/idle.glb';
const BACKUP = '_archive-large-source/idle.23mb-uncompressed.glb';
const TMP = 'public/main-character-other-position/.idle.tmp.glb';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

if (!fs.existsSync(FILE)) { console.error(`❌ 找不到 ${FILE}`); process.exit(1); }

if (!fs.existsSync(BACKUP)) {
  fs.mkdirSync('_archive-large-source', { recursive: true });
  fs.copyFileSync(FILE, BACKUP);
  console.log(`已备份原始文件 → ${BACKUP}`);
}

const before = fs.statSync(FILE).size;
const doc = await io.read(FILE);

// 改前记录动画/骨骼签名——压缩不能动它们
const animBefore = doc.getRoot().listAnimations().length;
const skinBefore = doc.getRoot().listSkins().reduce((n, s) => n + s.listJoints().length, 0);

await doc.transform(
  dedup(),
  prune({ keepLeaves: true }),
  // 贴图：2048²→1024² webp。baseColor 保 sRGB 高质量；法线/金属粗糙(线性数据)也 webp 但不缩色。
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, resize: [1024, 1024] }),
  // 几何：Meshopt 量化+编码（不改拓扑/骨骼/动画）
  meshopt({ encoder: MeshoptEncoder }),
);

const animAfter = doc.getRoot().listAnimations().length;
const skinAfter = doc.getRoot().listSkins().reduce((n, s) => n + s.listJoints().length, 0);

if (animAfter !== animBefore || skinAfter !== skinBefore) {
  console.error(`❌ 动画/骨骼变化（animations ${animBefore}→${animAfter}，joints ${skinBefore}→${skinAfter}），已中止（未改动原文件）。`);
  process.exit(1);
}

await io.write(TMP, doc);
// Windows 下直接 rename 覆盖已存在文件可能 EPERM（目标被占用/锁）；改 copy 覆盖 + 删临时，稳。
fs.copyFileSync(TMP, FILE);
fs.rmSync(TMP, { force: true });

const after = fs.statSync(FILE).size;
console.log(`animations: ${animBefore}→${animAfter}  joints: ${skinBefore}→${skinAfter}  ✅ 动画保留`);
console.log(`体积: ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB`);
console.log(`✅ 完成：${FILE}（回退用 ${BACKUP}）`);
