import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const distDir = path.resolve('dist');
const EXCLUDE = ['model-site', 'main-character-other-position'];

function copyDirExclude(src, dest, exclude) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    const rel = s.substring(distDir.length + 1).replaceAll('\\', '/');
    if (exclude.some(e => rel.startsWith(e))) continue;
    if (entry.isDirectory()) copyDirExclude(s, d, exclude);
    else fs.copyFileSync(s, d);
  }
}

// zip1: 除大 glb 文件夹外的所有内容
const tmp = path.resolve('dist-main-tmp');
if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
copyDirExclude(distDir, tmp, EXCLUDE);
console.log('copied to temp dir');

execSync(
  `powershell -Command "Compress-Archive -Path 'dist-main-tmp\\*' -DestinationPath '水獭星球-20260630-main.zip' -Force"`,
  { stdio: 'inherit' }
);
fs.rmSync(tmp, { recursive: true, force: true });

// zip2: 大 glb 文件夹（保留目录结构）
const tmp2 = path.resolve('dist-glb-tmp');
if (fs.existsSync(tmp2)) fs.rmSync(tmp2, { recursive: true });
for (const folder of EXCLUDE) {
  const src = path.join(distDir, folder);
  const dest = path.join(tmp2, folder);
  if (fs.existsSync(src)) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, f), path.join(dest, f));
    }
  }
}
execSync(
  `powershell -Command "Compress-Archive -Path 'dist-glb-tmp\\*' -DestinationPath '水獭星球-20260630-glb.zip' -Force"`,
  { stdio: 'inherit' }
);
fs.rmSync(tmp2, { recursive: true });

import { statSync } from 'node:fs';
console.log('main zip:', (statSync('水獭星球-20260630-main.zip').size / 1048576).toFixed(1) + ' MB');
console.log('glb  zip:', (statSync('水獭星球-20260630-glb.zip').size / 1048576).toFixed(1) + ' MB');
