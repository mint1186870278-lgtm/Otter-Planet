// 批量 PNG/JPEG → WebP 压缩。保留透明通道、保留原文件名(仅换扩展名)。
// 默认只生成 .webp 不删原图，便于对比。加 --delete 删除已成功转换的原图。
// 用法: node scripts/optimize-images.mjs [--delete] [--quality=82]
import sharp from 'sharp';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const DIRS = ['final-picture', 'section-visual-novel-material', 'npc-2d', 'star-progress-bar'];
const EXTS = new Set(['.png', '.jpg', '.jpeg']);

const args = process.argv.slice(2);
const DELETE = args.includes('--delete');
const Q = Number((args.find(a => a.startsWith('--quality=')) || '').split('=')[1]) || 82;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const fmt = b => (b / 1048576).toFixed(2) + ' MB';
let totalIn = 0, totalOut = 0, count = 0;

for (const d of DIRS) {
  const base = path.join(ROOT, d);
  for await (const file of walk(base)) {
    const ext = path.extname(file).toLowerCase();
    if (!EXTS.has(ext)) continue;
    const out = file.slice(0, -ext.length) + '.webp';
    const inSize = (await stat(file)).size;
    // 保留 alpha；不放大；q=Q 有损，effort 6 = 压缩更狠
    await sharp(file).webp({ quality: Q, effort: 6 }).toFile(out);
    const outSize = (await stat(out)).size;
    totalIn += inSize; totalOut += outSize; count++;
    const pct = ((1 - outSize / inSize) * 100).toFixed(0);
    console.log(`${pct.padStart(3)}%↓  ${fmt(inSize).padStart(9)} → ${fmt(outSize).padStart(9)}  ${path.relative(ROOT, file)}`);
    if (DELETE) await unlink(file);
  }
}

console.log('\n———');
console.log(`转换 ${count} 张, quality=${Q}`);
console.log(`总计 ${fmt(totalIn)} → ${fmt(totalOut)}  (省 ${((1 - totalOut / totalIn) * 100).toFixed(0)}%)`);
if (!DELETE) console.log('原图保留。确认画质后加 --delete 重跑可清理原图。');
