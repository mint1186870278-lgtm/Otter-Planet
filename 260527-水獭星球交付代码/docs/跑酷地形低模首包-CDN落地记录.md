# 跑酷地形低模首包 / CDN 落地记录

记录日期：2026-07-04

## 本次目标

把跑酷段从“必须等待完整 35.61 MB 地形 GLB”改成：

```text
先显示低模可运行地形 -> 后台加载完整地形 -> 完整地形加载完成后自动替换
```

同时给 3D 静态资源加 CDN / 对象存储基址配置，后续可把大 GLB 从源站迁走。

## 已落地改动

### 1. 低模首包 fallback

新增组件：

```text
src/components/parkour/Scenery.tsx
export function LowTerrainShell()
```

行为：

```text
1. 不依赖任何 GLB。
2. 直接用 Three.js primitive 画轻量草地、入口路面、石板路径和少量植被。
3. 挂载时临时写入 occluderRef，供角色贴地、相机遮挡、NPC/障碍物/花草吸附使用。
4. 完整 TerrainModel 加载完成后，Suspense 自动卸载 LowTerrainShell，由完整地形接管 occluderRef。
```

接入点：

```tsx
<React.Suspense fallback={<LowTerrainShell />}>
  <TerrainModel />
</React.Suspense>
```

位置：

```text
src/components/ParkourScene.tsx
```

### 2. 移除完整地形强制预加载

已移除：

```ts
useGLTF.preload(TERRAIN_URL)
```

保留：

```ts
useGLTF.preload(CHARACTER_URL)
useGLTF.preload(`${PK}/star.glb`)
useGLTF.preload(`${PK}/rocks.glb`)
useGLTF.preload(`${PK}/barrel.glb`)
useGLTF.preload(`${PK}/crate.glb`)
```

原因：

```text
角色和基础交互模型属于跑酷首包必要资源。
35.61 MB 完整地形不再强制提前抢带宽。
```

### 3. 静态资源 CDN 基址

新增 helper：

```text
src/lib/publicAssetUrl.ts
```

新增环境变量：

```text
VITE_OTTERLANTIS_ASSET_ORIGIN=""
```

用法：

```text
留空：从当前站点加载 public 资源
填写：https://cdn.example.com
结果：https://cdn.example.com/model-site/scene-terrain-opt.glb?v=<BUILD_ID>
```

已接入的 3D 资源：

```text
model-site/scene-terrain-opt.glb
main-character-other-position/idle.glb
parkour-3d/kenney_platformer-kit/Models/GLB-format/*.glb
3d-flower/optimized/*.glb
3d-tree/optimized/*.glb
3d-moon/*.glb
```

## CDN 部署方式

### 方案 A：整包 public 镜像到 CDN

把构建后的 `dist` 中这些目录同步到对象存储 / CDN：

```text
model-site/
main-character-other-position/
parkour-3d/
3d-flower/
3d-tree/
3d-moon/
npc-model/
audio/
section-visual-novel-material/
final-picture/
```

构建时设置：

```bash
VITE_OTTERLANTIS_ASSET_ORIGIN=https://cdn.example.com npm run build
```

Windows PowerShell 示例：

```powershell
$env:VITE_OTTERLANTIS_ASSET_ORIGIN="https://cdn.example.com"
npm run build
```

### 方案 B：只迁移大 GLB

也可以只把大 GLB 和 3D 模型目录放 CDN：

```text
model-site/
main-character-other-position/
parkour-3d/
3d-flower/
3d-tree/
3d-moon/
npc-model/
```

注意：当前 `VITE_OTTERLANTIS_ASSET_ORIGIN` 会影响已接入 helper 的 3D 资源，不影响普通图片和音频。这样可以先小步迁移，降低风险。

## 缓存策略

CDN / Nginx 建议：

```text
*.glb, *.gltf, *.bin, *.ktx2:
Cache-Control: public, max-age=2592000
Access-Control-Allow-Origin: *
Accept-Ranges: bytes

/assets/*.js, /assets/*.css:
Cache-Control: public, max-age=31536000, immutable

*.html:
Cache-Control: no-cache, must-revalidate
```

构建插件会给 public 资源 URL 自动追加：

```text
?v=<BUILD_ID>
```

所以 CDN 可以长缓存，新版本通过 URL 版本号刷新。

## 验收点

浏览器 Network：

```text
1. 进入跑酷段时，scene-terrain-opt.glb 不应再由顶层 preload 立即触发。
2. Canvas 应先显示低模地面和路径。
3. 完整 GLB 下载完成后，真实地形自动出现。
4. 如果配置 CDN，GLB 请求 Host 应为 CDN 域名。
```

浏览器画面：

```text
1. 角色进入跑酷段不黑屏。
2. 完整地形回来前，角色可站在低模地面上。
3. 键盘教学方向按钮可正常出现。
4. 完整地形回来后，角色继续贴地，不明显跳飞。
5. NPC / 星星 / 障碍物流程不阻塞。
```

命令验证：

```bash
npm run lint
npm run build
npm run report:assets -- --root=dist --top=20
```

## 当前边界

这次不是完整的“地形几何拆包”。当前完整 GLB 仍会作为一个文件加载，只是不再阻塞跑酷段第一帧。

真正的下一阶段拆包是：

```text
A 包：低模可玩路径 + 必要碰撞
B 包：完整地貌 / 树 / 花草 / 远景
C 包：剧情后段装饰资源
```

当前低模首包先用代码生成，目的是快速降低首访等待感，并为后续真拆包打好结构基础。
