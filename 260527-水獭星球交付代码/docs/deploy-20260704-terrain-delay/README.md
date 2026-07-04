# 2026-07-04 跑酷地形延迟加载发布包

## 目标

发布“首屏不请求完整地形 GLB”的前端修复：

```text
跑酷教学阶段：只加载 LowTerrainShell，不请求 /model-site/scene-terrain-opt.glb
教学完成后：延迟 2.5s 后后台请求完整地形
```

## 本包文件

```text
package/index.html
package/assets/index-DzNmtrFH.js
package/assets/SectionParkour--w0vNVV1.js
```

这是最小安全发布包。不要删除线上旧 JS chunk，避免用户浏览器里缓存的旧 `index.html` 继续访问旧 chunk 时 404。

## 线上目录

宝塔截图显示站点根目录应为：

```text
/www/wwwroot/play.otterlantis.com
```

## 部署步骤

在服务器执行：

```bash
set -euo pipefail

SITE=/www/wwwroot/play.otterlantis.com
TS=$(date +%Y%m%d%H%M%S)
BACKUP=/www/backup/play.otterlantis.com-$TS

mkdir -p "$BACKUP/assets"
cp -a "$SITE/index.html" "$BACKUP/index.html"
cp -a "$SITE/assets/index-"*.js "$BACKUP/assets/" 2>/dev/null || true
cp -a "$SITE/assets/SectionParkour-"*.js "$BACKUP/assets/" 2>/dev/null || true

cp -a package/index.html "$SITE/index.html"
mkdir -p "$SITE/assets"
cp -a package/assets/index-DzNmtrFH.js "$SITE/assets/index-DzNmtrFH.js"
cp -a package/assets/SectionParkour--w0vNVV1.js "$SITE/assets/SectionParkour--w0vNVV1.js"

nginx -t
nginx -s reload
```

如果用宝塔文件管理器上传：

1. 上传 `package/index.html` 到 `/www/wwwroot/play.otterlantis.com/index.html`。
2. 上传 `package/assets/index-DzNmtrFH.js` 到 `/www/wwwroot/play.otterlantis.com/assets/index-DzNmtrFH.js`。
3. 上传 `package/assets/SectionParkour--w0vNVV1.js` 到 `/www/wwwroot/play.otterlantis.com/assets/SectionParkour--w0vNVV1.js`。
4. 不要删除旧的 `index-*.js` 和 `SectionParkour-*.js`。

## 发布后校验

本地执行：

```bash
bash verify-online-terrain-delay.sh
```

预期：

```text
index.html 指向 /assets/index-DzNmtrFH.js?v=202607041255
新版 JS 200
新版 SectionParkour chunk 200
dashboard.html SHA256 不变
```

浏览器 Network 预期：

```text
进入跑酷教学画面后：
  不应出现 /model-site/scene-terrain-opt.glb

完成方向键教学后等待数秒：
  才应出现 /model-site/scene-terrain-opt.glb
```

## 回滚

如果需要回滚：

```bash
SITE=/www/wwwroot/play.otterlantis.com
BACKUP=/www/backup/play.otterlantis.com-YYYYMMDDHHMMSS

cp -a "$BACKUP/index.html" "$SITE/index.html"
nginx -s reload
```

