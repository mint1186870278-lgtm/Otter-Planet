# 3D 模型压缩优化方案：Meshopt 优先

## 结论

先做 Meshopt 路线，不先切 Draco。

当前线上慢的最大单点是：

```text
public/model-site/scene-terrain-opt.glb 约 35.6 MB
```

缓存已经能改善二次访问，但首次访问仍然要下载这个大地形包。接下来优化重点不是只换一种压缩算法，而是先搞清楚 35.6 MB 里面到底是几何、贴图、重复节点，还是已有压缩没有真正生效。

推荐优先级：

1. 检查当前 GLB 结构和压缩状态。
2. 继续 Meshopt + 贴图压缩。
3. 做低模首包或拆包。
4. 最后再用 Draco 做 A/B 实验。

## 为什么先 Meshopt

Meshopt 更适合网页实时 3D 场景：

- 解码快，进入游戏时更不容易出现明显卡顿。
- 对 Three.js / glTF / drei 的运行链路更友好。
- 适合首屏或准首屏资源，下载和解码之间比较均衡。
- 项目里已经有 `optimize:terrain` 脚本和 Meshopt 相关依赖，可以沿着现有流程做。

Draco 的优势是几何压缩率可能更高，但代价是解码更重。对跑酷地形这种用户马上要看到和操作的模型来说，Draco 可能出现“文件小了，但进场前解码卡住”的体感问题。

## 当前已知情况

线上缓存规则已生效：

```text
GLB: Cache-Control: public, max-age=2592000
JS:  Cache-Control: public, max-age=31536000, immutable
```

所以当前瓶颈不是“缓存没配上”，而是首次下载和解析的资源体积仍然太大。

发布包里的主要大资源：

```text
35.61 MB  model-site/scene-terrain-opt.glb
 2.90 MB  main-character-other-position/idle.glb
 0.99 MB  assets/SectionParkour-*.js
 0.99 MB  audio/game-opening.m4a
 0.80 MB+ section-visual-novel-material/choose-picture-card/*.webp
```

## 阶段 0：建立基线

目标：先把“现在到底慢在哪”量化，避免盲调。

执行命令：

```bash
npm run build
npm run report:assets
npx gltf-transform inspect public/model-site/scene-terrain-opt.glb
```

需要记录：

```text
1. GLB 总体积
2. Mesh / Primitive 数量
3. Vertex / Triangle 数量
4. Texture 数量、格式、分辨率、总体积
5. 是否存在 EXT_meshopt_compression
6. 是否存在 KHR_draco_mesh_compression
7. 是否有 2048 或 4096 级别大贴图
8. 是否有重复 mesh、未使用材质、未使用 texture
```

验收产物：

```text
docs/3D模型压缩基线记录.md
```

记录优化前的文件大小、inspect 摘要、浏览器首次进入跑酷段耗时。

## 阶段 1：Meshopt + 安全清理

目标：保留当前地形节点结构，不破坏跑酷石板路、出生点、碰撞和相机逻辑。

优先使用现有脚本：

```bash
npm run optimize:terrain
```

这个阶段只允许做低风险 transform：

```text
允许：
- dedup
- prune
- meshopt
- textureCompress

谨慎：
- quantize
- weld

暂不使用：
- simplify
- join
- flatten
- instance
```

暂不使用这些高风险 transform 的原因：当前跑酷地形逻辑依赖 NURBS/节点名/bbox/节点 transform 来对齐石板路和出生点。合并或重排节点可能让视觉正常，但游戏路径错位。

验收标准：

```text
1. scene-terrain-opt.glb 小于当前 35.6 MB。
2. NURBS / 石板路相关节点数量不变。
3. 出生点落在路面上。
4. 跑酷路径、星星、障碍物、NPC 触发点不明显错位。
5. Chrome Performance 里 GLB 解码没有明显长任务恶化。
```

## 阶段 2：贴图专项压缩

目标：如果 inspect 发现体积主要来自贴图，优先压贴图，而不是急着换 Draco。

现有入口：

```bash
npm run optimize:terrain-tex
```

建议策略：

```text
baseColor:
- 2048 以内优先
- WebP quality 88-92
- 保持视觉颜色稳定

normal:
- 1024 或 2048
- 视模型细节决定

metallicRoughness:
- 512 或 1024
- 通常可以更激进
```

如果浏览器端显存压力明显，后续可以评估 KTX2/Basis，但这一步会引入额外转码和兼容验证，不建议作为第一刀。

验收标准：

```text
1. GLB 磁盘体积下降。
2. 浏览器 GPU memory / texture memory 明显下降。
3. 画面不出现明显糊、脏、色偏。
4. 移动端进入跑酷段卡顿降低。
```

## 阶段 3：低模首包 / 拆包

目标：让用户先进入跑酷，不被完整 35 MB 地形阻塞。

这是比 Draco 更可能改善体感的一步。

推荐方案：

```text
A 包：低模首包
- 路面
- 角色
- 基础星星
- 基础障碍
- 必要地形轮廓

B 包：场景细节
- 远景树
- 花草
- 云
- 装饰物

C 包：剧情后段资源
- NPC 细节模型
- 月亮
- 结算相关资源
```

加载策略：

```text
1. 用户进入跑酷前，只保证 A 包加载完成。
2. 开始跑酷后，空闲时间加载 B 包。
3. 接近剧情节点时再加载 C 包。
```

代码侧关注点：

```text
src/components/ParkourScene.tsx
src/components/parkour/Scenery.tsx
src/components/parkour/Npc.tsx
src/components/parkour/CameraSkyMoon.tsx
src/components/parkour/config.ts
```

验收标准：

```text
1. 首次进入跑酷段等待时间明显降低。
2. A 包可独立渲染，不出现黑屏。
3. B/C 包加载失败时，游戏主流程仍可继续。
4. 细节资源出现时不造成明显掉帧。
```

## 阶段 4：Draco A/B 实验

只有当前面三阶段仍不够，再做 Draco 对比。

实验方式：

```bash
npx gltf-transform optimize public/model-site/scene-terrain-source.glb public/model-site/scene-terrain-draco.glb --compress draco
```

需要对比：

```text
1. 文件大小
2. 下载耗时
3. 解码耗时
4. 首次可交互时间
5. 移动端卡顿
6. 是否破坏节点结构和路径对齐
```

Draco 通过条件：

```text
1. 文件体积显著小于 Meshopt 版。
2. 解码耗时没有抵消下载收益。
3. 中低端移动设备没有明显长卡顿。
4. 跑酷路径和节点逻辑完全正常。
```

如果只是体积更小，但进入跑酷时更卡，不采用。

## 验收指标

建议目标：

```text
P0:
- scene-terrain-opt.glb 从 35.6 MB 降到 20 MB 以下
- 跑酷段首次等待时间明显低于当前版本
- 路径、出生点、星星、障碍物不回归

P1:
- 地形首包降到 10-15 MB
- 细节资源延迟加载
- 移动端进入跑酷无明显长时间白屏/黑屏

P2:
- 大资源走 CDN 或对象存储
- 线上首访加载时间稳定
```

## 测试清单

每次产出新 GLB 后都跑：

```bash
npm run lint
npm run build
npm run report:assets
```

浏览器手测：

```text
1. 首页是否正常出现。
2. 故事段是否正常切换。
3. 跑酷段是否能进入。
4. 角色是否站在路面上。
5. 石板路是否对齐。
6. 星星是否可收集。
7. 障碍物是否可触发。
8. NPC 是否正常出现和触发。
9. 月亮剧情是否正常。
10. 刷新后缓存是否命中。
```

性能面板记录：

```text
1. Network: GLB 下载时间和大小
2. Performance: GLB decode / parse 长任务
3. Memory: 进入跑酷后的内存峰值
4. FPS: 进入跑酷后 10 秒内是否明显掉帧
```

## 回滚方案

所有新产物不要直接覆盖唯一源文件。建议保留：

```text
_archive-large-source/scene-terrain.glb
_archive-large-source/scene-terrain-opt.before-meshopt.glb
_archive-large-source/scene-terrain-opt.before-texture.glb
```

线上回滚只需要把 `public/model-site/scene-terrain-opt.glb` 换回上一版，并保持 URL 版本号更新：

```ts
export const TERRAIN_URL = '/model-site/scene-terrain-opt.glb?v=YYYYMMDD-label';
```

## 最终建议

当前不要直接把主线切到 Draco。

先做：

```text
inspect -> Meshopt/贴图压缩 -> 拆首包 -> CDN -> Draco A/B
```

这条路线更符合网页实时 3D 的体感目标：不是只追求文件最小，而是让用户更快看到画面、更快开始操作，并且不在解码时被卡住。

## 2026-07-04 执行记录

已完成第一轮 A/B：

```text
当前线上地形：public/model-site/scene-terrain-opt.glb
当前扩展：KHR_draco_mesh_compression + KHR_mesh_quantization + EXT_texture_webp
当前大小：35.61 MB

Meshopt 候选：_archive-large-source/scene-terrain-meshopt-candidate.glb
候选大小：51.43 MB
NURBS 节点：85 个，签名校验通过
```

结论调整：

```text
当前不要把线上地形切到 Meshopt 候选。
在现有模型结构下，Draco 版传输体积更小。
下一步应优先做低模首包 / 地形拆包 / CDN，而不是继续在 Draco 与 Meshopt 之间硬切。
```

详见：

```text
docs/3D模型压缩基线记录.md
```
