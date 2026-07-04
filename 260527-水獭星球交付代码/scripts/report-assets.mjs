// Report public/dist asset sizes before release.
// Usage:
//   node scripts/report-assets.mjs
//   node scripts/report-assets.mjs --root=dist --top=80

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const rootArg = args.find(arg => arg.startsWith('--root='));
const topArg = args.find(arg => arg.startsWith('--top='));
const ROOT = path.resolve(process.cwd(), rootArg ? rootArg.split('=')[1] : 'dist');
const TOP_N = Number(topArg ? topArg.split('=')[1] : 50);

const fmt = bytes => `${(bytes / 1048576).toFixed(2)} MB`;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const byExt = new Map();
const files = [];

for await (const file of walk(ROOT)) {
  const info = await stat(file);
  const ext = path.extname(file).toLowerCase() || '<none>';
  const row = byExt.get(ext) || { count: 0, bytes: 0 };
  row.count += 1;
  row.bytes += info.size;
  byExt.set(ext, row);
  files.push({ file, bytes: info.size });
}

const total = files.reduce((sum, file) => sum + file.bytes, 0);

console.log(`Asset report for ${path.relative(process.cwd(), ROOT) || ROOT}`);
console.log(`Total: ${fmt(total)} (${files.length} files)`);
console.log('\nBy extension:');
for (const [ext, row] of [...byExt.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`${ext.padEnd(8)} ${String(row.count).padStart(4)}  ${fmt(row.bytes).padStart(10)}`);
}

console.log(`\nTop ${TOP_N} largest files:`);
for (const item of files.sort((a, b) => b.bytes - a.bytes).slice(0, TOP_N)) {
  console.log(`${fmt(item.bytes).padStart(10)}  ${path.relative(ROOT, item.file).replaceAll(path.sep, '/')}`);
}
