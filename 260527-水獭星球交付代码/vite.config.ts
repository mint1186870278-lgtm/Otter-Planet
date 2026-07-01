import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
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
    /(?<![:\w/.])(\/[^"'`\s)]+?\.(?:webp|glb|gltf|png|jpe?g|svg|mp3|wav|hdr|ktx2|bin))(\?v=[\w.\-]+)?/g;

  return {
    name: 'asset-version-stamp',
    enforce: 'pre',
    apply: 'build', // 只在打包时加戳；dev 不加，避免干扰本地调试
    config() {
      return {define: {__BUILD_ID__: JSON.stringify(BUILD_ID)}};
    },
    transform(code, id) {
      if (id.includes('node_modules')) return null;
      if (!/\.(t|j)sx?$/.test(id.split('?')[0])) return null;
      if (!/\.(webp|glb|gltf|png|jpe?g|svg|mp3|wav|hdr|ktx2|bin)/.test(code)) return null;
      const out = code.replace(RE, (m, url, _ver, offset, str) => {
        // 跳过 CSS url(...) 里的路径:Tailwind 的 bg-[url(...)] 任意值类是按源码原文生成 CSS 的,
        // 若给运行时类名加 ?v= 会和生成的 CSS 类名对不上 → 背景失效。内联 style 的 url() 加不加
        // 戳都能正常加载,这里统一不加最稳。普通字符串(img src 等)照常加戳。
        const before = str.slice(Math.max(0, offset - 6), offset);
        if (/url\(\s*['"]?$/.test(before)) return m;
        return `${url}?v=${BUILD_ID}`;
      });
      return out === code ? null : {code: out, map: null};
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
