const fs = require('fs'), path = require('path');
const hasCJK = s => /[一-鿿]/.test(s);

// ① public 中文名文件
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (hasCJK(e.name)) files.push(f.split(path.sep).join('/'));
  }
})('public');
console.log('=== public 中文名文件 (' + files.length + ') ===');
files.sort().forEach(f => console.log('  ' + f));

// ② src 里引用中文资源路径的文件
console.log('\n=== src 中引用中文资源的文件 ===');
const srcHits = new Set();
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) {
      const txt = fs.readFileSync(f, 'utf8');
      txt.split('\n').forEach((line, i) => {
        // 含中文且含资源扩展名的行
        if (hasCJK(line) && /\.(webp|png|glb|gltf|jpe?g|svg|mp3|wav)/.test(line))
          srcHits.add(f.split(path.sep).join('/') + ':' + (i + 1) + '  ' + line.trim().slice(0, 90));
      });
    }
  }
})('src');
[...srcHits].sort().forEach(h => console.log('  ' + h));
