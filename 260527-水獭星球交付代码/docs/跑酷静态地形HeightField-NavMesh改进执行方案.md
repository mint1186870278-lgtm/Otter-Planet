# 跑酷静态地形 HeightField / NavMesh 改进执行方案

记录日期：2026-07-04

## 结论

当前先做 HeightField，不直接做完整三角形 NavMesh。

原因是跑酷段最重的运行时问题不是寻路，而是“每帧为了角色贴地去 raycast 完整地形 GLB”。角色移动只需要用世界坐标 `x/z` 快速查到地面 `y`，HeightField 能用更小的数据和更低风险解决这个热点。

推荐顺序：

```text
P0：Bake terrain-heightfield.json/bin，替换 Character 每帧地形 raycast
P1：NPC / 障碍物 / 花草树木落位改查 HeightField
P2：相机遮挡改为低模 occluder，不再 raycast 完整地形
P3：完整地形 GLB 只负责视觉，再推进真拆地形包
```

## 本次执行范围

第一轮已完成 P0：

```text
输入：
public/model-site/scene-terrain-opt.glb

输出：
public/model-site/terrain-heightfield.json
public/model-site/terrain-heightfield.bin

运行时：
src/components/parkour/navmesh/terrainHeightfield.ts
Character.tsx 优先使用 heightfield.sampleHeight(x, z)
```

保留原 raycast fallback。只要 heightfield 没加载、数据越界、采样失败，就继续走原逻辑。

## 数据格式

`terrain-heightfield.json`：

```json
{
  "version": 1,
  "source": "scene-terrain-opt.glb",
  "cellSize": 1,
  "minX": -120,
  "minZ": -120,
  "width": 241,
  "height": 241,
  "bin": "terrain-heightfield.bin"
}
```

`terrain-heightfield.bin`：

```text
Float32Array heights
长度 = width * height
顺序 = z-major：index = iz * width + ix
无效点 = NaN
```

第一版使用 `cellSize = 1`，约 58,081 个点，bin 约 227 KB。后续如果贴地不够细，再切到 `0.5`。

## Bake 规则

脚本复刻 `TerrainModel` 的地形变换：

```text
autoScale = TERRAIN_SIZE / 地形最长水平轴
offset = TERRAIN_ANCHOR_TO - autoScale * 入口 NURBS 锚点
world = offset + autoScale * model
```

采样方式不用运行时 raycast，而是离线把地形三角形投影到 x/z 网格上：

```text
1. 解码 GLB，包括 Draco / Meshopt。
2. 过滤云、明显高处装饰、近似垂直面。
3. 把可作为地面的上表面三角形 rasterize 到 HeightField。
4. 同一格多个命中时保留最高的可走上表面。入口石板路下方还有地表，不能取最低层，否则角色出生时会被拉到石板下面。
5. 输出采样覆盖率、文件大小、坐标范围。
```

## 运行时接入

新增模块：

```text
src/components/parkour/navmesh/terrainHeightfield.ts
```

提供：

```ts
loadTerrainHeightfield()
getTerrainHeightfield()
sampleHeight(x, z)
```

`Character.tsx` 每帧顺序：

```text
1. 先查 HeightField。
2. 如果返回有效高度，更新 terrainTargetY。
3. 如果无效，回退到原来的 Raycaster.intersectObject(terrain, true)。
```

## 验收指标

必须满足：

```text
1. npm run bake:terrain-heightfield 可以生成 json/bin。
2. npm run lint 通过。
3. npm run build 通过。
4. Character.tsx 不再在 heightfield 可用时每帧 raycast 完整地形。
5. 完整地形 GLB 加载前后角色 Y 不明显跳变。
```

观察项：

```text
1. 入口石板路贴地是否正确。
2. 草地、河道、下坡区域是否有明显悬空或陷地。
3. heightfield 文件是否小于 500 KB。
4. Network 中 heightfield json/bin 是否可被 CDN 缓存。
```

## 回滚方式

如果发现贴地偏差：

```text
1. 删除 Character.tsx 中 heightfield 优先分支，恢复 raycast。
2. 保留 bake 脚本和数据文件，不影响原地形渲染。
3. 调整 bake 过滤规则或 cellSize 后重新生成。
```

这个改法不会改动 `scene-terrain-opt.glb`，也不会影响低模首包 / CDN 逻辑。

## P1 落地记录

执行日期：2026-07-04

已把一次性落位逻辑接入 HeightField：

```text
src/components/parkour/Npc.tsx
- NPC 自动落地优先 sampleTerrainHeight(x, z)
- 保留 raycast fallback
- 移除帧循环里的临时 new Raycaster，改为 ref 复用

src/components/parkour/Obstacles.tsx
- 障碍物生成落地优先 sampleTerrainHeight(x, z)
- HeightField 未就绪时会等待加载完成后补写 y
- 保留完整地形 raycast fallback

src/components/parkour/Scenery.tsx
- GroundDetail 程序化花草优先查 HeightField
- GLBFlowers 优先查 HeightField
- TreeScatter 优先查 HeightField
- HeightField 无采样值时保留原 raycast fallback
```

验证：

```text
npm run lint
npm run build
```

结果：均通过。`SectionParkour` 大 chunk 警告仍存在，这是此前已有的体积提醒，不是 HeightField P1 引入的问题。

P1 完成后的状态：

```text
每帧角色贴地：HeightField 优先，raycast fallback
NPC 落位：HeightField 优先，raycast fallback
障碍物落位：HeightField 优先，raycast fallback
花草树木批量落位：HeightField 优先，raycast fallback
相机遮挡：仍 raycast 完整 occluder，留到 P2 处理
```

## P2 落地记录

执行日期：2026-07-04

已把相机遮挡从完整地形 `occluderRef` 拆到专用低模遮挡组：

```text
src/components/parkour/runtime.ts
- 新增 cameraOccluderRef
- 保留 occluderRef 给角色贴地、NPC/障碍物/花草树木 fallback 使用

src/components/parkour/Scenery.tsx
- 新增 CameraOccluders
- 复用 TREE_SCATTER 的树和灌木坐标
- 圆树生成低段数 cylinder 遮挡体
- 灌木生成 box 遮挡体
- 材质 colorWrite=false、depthWrite=false、opacity=0，只参与 raycast，不显示在画面里

src/components/parkour/CameraSkyMoon.tsx
- CameraRig 改为 raycast cameraOccluderRef
- 不再每帧 raycast 完整 TerrainModel

src/components/ParkourScene.tsx
- 挂载 <CameraOccluders />
```

验证：

```text
npm run lint
npm run build
```

结果：均通过。`SectionParkour` 大 chunk 警告仍是既有体积提醒。

P2 完成后的状态：

```text
角色贴地：暂时恢复完整地形 raycast，避免 HeightField 出生点高度偏差影响体验
静态落位：HeightField 优先，raycast fallback
相机遮挡：低模 cameraOccluderRef
完整 TerrainModel：不再参与相机每帧遮挡 raycast
```
