import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {readdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

// ── 构建缓存戳 ──────────────────────────────────────────────────────────────
// 痛点：public/ 下的图片、glb 用固定文件名 + 绝对路径引用，Vite 不加 hash、原样拷贝。
// 重新打包换了内容但文件名没变 → 浏览器按 URL 命中旧缓存 → 用户必须手动清缓存才看到新版。
// 解法：每次 build 生成一个时间戳，自动给源码里所有 public 资源 URL 追加 ?v=<时间戳>。
// 一次构建 = 一个戳 = 全部资源同步失效，零手工维护（替代原先手写的 ?v=4 / ?v=3）。
//
// 在源码 transform 阶段做（不是打包后正则改 JS），因为像 `${MAT}/背景new.webp` 这种
// 运行时拼接的中文路径，打包后并不是一条完整字面量，只有在源码文本上才能稳妥地加戳。
function assetVersionStamp(): Plugin {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  const BUILD_ID =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}`;

  // 匹配：以单个 / 开头(非 :// 外链、非 ./相对import) + 已知资源扩展名 + 可选已有 ?v=旧戳。
  // 负向后顾 (?<![:\w/.]) 排除 https://cdn.../x.png 和 import '../../星星闪闪.png'。
  const RE =
    /(?<![:\w/.])(\/[^"'`\s)]+?\.(?:webp|glb|gltf|png|jpe?g|svg|mp3|wav|hdr|ktx2|bin|json))(\?v=[\w.\-]+)?/g;

  const PUBLIC_ENTRY_RE =
    /(?<![:\w/.])(\/[^"'`\s)]+?\.(?:css|js|webp|glb|gltf|png|jpe?g|svg|mp3|wav|hdr|ktx2|bin|json))(\?v=[\w.\-]+)?/g;

  const stampPublicUrls = (code: string, includeEntryAssets = false) => {
    const re = includeEntryAssets ? PUBLIC_ENTRY_RE : RE;
    return code.replace(re, (m, url, _ver, offset, str) => {
      // Vite-built files under /assets/ already carry content hashes. Adding
      // ?v= here makes the entry module URL differ from lazy chunk imports,
      // which can instantiate React twice and trigger invalid hook calls.
      if (url.startsWith('/assets/')) return m;
      const before = str.slice(Math.max(0, offset - 6), offset);
      if (!includeEntryAssets && /url\(\s*['"]?$/.test(before)) return m;
      return `${url}?v=${BUILD_ID}`;
    });
  };

  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'assets') continue;
        yield* walk(full);
      } else {
        yield full;
      }
    }
  }

  return {
    name: 'asset-version-stamp',
    enforce: 'pre',
    apply: 'build', // 只在打包时加戳；dev 不加，避免干扰本地调试
    config() {
      return {define: {__BUILD_ID__: JSON.stringify(BUILD_ID)}};
    },
    transformIndexHtml(html) {
      return stampPublicUrls(html, true);
    },
    transform(code, id) {
      if (id.includes('node_modules')) return null;
      if (!/\.(t|j)sx?$/.test(id.split('?')[0])) return null;
      if (!/\.(webp|glb|gltf|png|jpe?g|svg|mp3|wav|hdr|ktx2|bin|json)/.test(code)) return null;
      const out = stampPublicUrls(code);
      return out === code ? null : {code: out, map: null};
    },
    async closeBundle() {
      const outDir = path.resolve(process.cwd(), 'dist');
      try {
        if (!(await stat(outDir)).isDirectory()) return;
      } catch {
        return;
      }

      for await (const file of walk(outDir)) {
        if (!/\.(html|css|js)$/.test(file)) continue;
        const code = await readFile(file, 'utf8');
        const out = stampPublicUrls(code, true);
        if (out !== code) await writeFile(file, out, 'utf8');
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [assetVersionStamp(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': 'http://localhost:6636',
      },
    },
  };
});
