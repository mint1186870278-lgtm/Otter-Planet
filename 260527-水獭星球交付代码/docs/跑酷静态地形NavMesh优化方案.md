# 跑酷静态地形 NavMesh 优化方案

## 结论

建议做。

当前跑酷地形是静态 GLB，但运行时大量逻辑仍在用 `Raycaster.intersectObject(terrain, true)` 去查地面高度、吸附物体、处理相机遮挡。Raycast 更适合动态、可破坏、实时变化的环境；对当前这种静态地形，应该提前 bake 一份轻量 NavMesh / HeightField，运行时只查这份数据。

目标不是立刻删掉所有 raycast，而是分阶段替换：

```text
P0：角色贴地从每帧 raycast 改为 navmesh/heightfield 查询
P1：NPC、障碍物、花草、树的一次性落位改为预采样高度
P2：相机遮挡从完整地形 raycast 改为低模遮挡体 / 简化 occluder
P3：完整地形 GLB 只负责视觉，不再参与核心移动计算
```

## 当前 Raycast 热点

### 每帧运行

```text
src/components/parkour/Character.tsx
- 每帧对 occluderRef.current 做向下 raycast
- 用于角色贴地 / 上坡下坡 / 水面判断
- 这是最应该优先替换的热点
```

```text
src/components/parkour/CameraSkyMoon.tsx
- 每帧从角色到相机做 raycast
- 用于相机被树/石头挡住时自动拉近
- 可以保留一段时间，但不应该打完整高模地形
```

### 一次性或少量运行

```text
src/components/parkour/Npc.tsx
- NPC 初次落位时 raycast
- 当前实现里还会 new Raycaster，需要顺手去掉
```

```text
src/components/parkour/Obstacles.tsx
- 障碍物生成后落位 raycast
- 数量随运行时间增长，虽然不是每帧，但仍可优化
```

```text
src/components/parkour/Scenery.tsx
- GroundDetail / GLBFlowers / TreeScatter 吸附地面
- 当前是一批实例逐个 raycast，首进跑酷时可能形成尖峰
```

## 为什么 NavMesh / HeightField 更合适

当前地形是静态的：

```text
1. 地形 GLB 不会运行时变形。
2. 石板路、草地、河道位置固定。
3. 玩家移动范围固定。
4. NPC / 星星 / 障碍物主要在固定世界坐标系里运行。
```

所以地面查询可以提前离线计算：

```text
输入：scene-terrain-opt.glb
输出：terrain-navmesh.json 或 terrain-heightfield.bin
运行时：O(1) 或 O(log n) 查询高度 / 合法区域 / 法线
```

这样每帧不用再让 Three.js 遍历完整地形对象树，也不需要对 35MB 高模地形做射线求交。

## 推荐数据形态

### 方案 A：HeightField 网格

适合当前需求，优先推荐。

```text
数据：
- world bounds: minX/maxX/minZ/maxZ
- cellSize: 0.5 或 1.0
- height[y]: Float32Array
- flags: Uint8Array
  - walkable
  - water
  - blocked
  - path
```

查询：

```ts
const y = sampleHeight(x, z);
const walkable = isWalkable(x, z);
const normal = sampleNormal(x, z);
```

优点：

```text
1. 查询极快。
2. 适合角色贴地。
3. 数据可压得很小。
4. 实现简单，风险低。
```

缺点：

```text
1. 不能表达悬空桥、多层楼这种同一 x/z 多高度结构。
2. 如果地形未来变复杂，需要切到真正 navmesh。
```

当前跑酷地形主要是开放地面 + 石板路，HeightField 足够。

### 方案 B：三角 NavMesh

适合更复杂的可行走区域。

```text
数据：
- vertices: Float32Array
- triangles: Uint32Array
- adjacency: Uint32Array
- area flags: walkable / water / blocked
```

查询：

```ts
const hit = navmesh.sampleNearest(x, z);
const next = navmesh.moveAlongSurface(from, desiredDelta);
```

优点：

```text
1. 更准确表达可行走多边形。
2. 可做寻路、边界约束、斜坡。
3. 更接近游戏工程标准。
```

缺点：

```text
1. bake 和调试成本更高。
2. 与当前玩法相比可能过重。
```

## 建议先做 HeightField

推荐第一版先 bake `terrain-heightfield.bin + terrain-heightfield.json`。

原因：

```text
1. 当前最重的热点是角色每帧贴地，这只需要 height 查询。
2. 低模首包已经存在，可以先让低模地形使用同一 heightfield。
3. 比完整 navmesh 更快落地。
4. 后续可以在 heightfield 基础上补 walkable flags。
```

## Bake 流程

新增脚本建议：

```text
scripts/bake-terrain-navmesh.mjs
```

输入：

```text
public/model-site/scene-terrain-opt.glb
```

输出：

```text
public/model-site/terrain-heightfield.json
public/model-site/terrain-heightfield.bin
```

流程：

```text
1. 用 glTF-Transform 或 Three.js 在 Node 环境加载 GLB。
2. 复用 TerrainModel 当前的缩放和 offset 逻辑，保证世界坐标一致。
3. 在固定 x/z 网格上从高处向下射线采样。
4. 过滤树冠、云、非地面材质，只保留地面/石板/水面。
5. 写出高度数据和 flags。
6. 输出统计报告：bounds、cellSize、采样点数量、walkable 比例、文件大小。
```

第一版参数：

```text
bounds: x/z = [-120, 120]
cellSize: 0.5
grid: 481 x 481 = 231,361 samples
height: Float32Array ≈ 925 KB
flags: Uint8Array ≈ 226 KB
gzip/br 后会更小
```

如果希望更小：

```text
cellSize: 1.0
grid: 241 x 241 = 58,081 samples
height: Float32Array ≈ 227 KB
flags: Uint8Array ≈ 57 KB
```

## 运行时接入

新增模块建议：

```text
src/components/parkour/navmesh/terrainHeightfield.ts
```

提供 API：

```ts
export async function loadTerrainHeightfield(): Promise<TerrainHeightfield>;

export interface TerrainHeightfield {
  sampleHeight(x: number, z: number): number;
  sampleNormal(x: number, z: number): THREE.Vector3;
  isWalkable(x: number, z: number): boolean;
  clampToWalkable(from: Vec2, to: Vec2): Vec2;
}
```

替换点：

```text
Character.tsx:
- terrain raycast -> heightfield.sampleHeight(x, z)
- 移动后检查 isWalkable / clampToWalkable

Npc.tsx:
- 初次落位 -> sampleHeight

Obstacles.tsx:
- 障碍物生成落位 -> sampleHeight

Scenery.tsx:
- 花草/树散布时直接 sampleHeight
- 或 bake 时预生成每个实例 y
```

## 相机遮挡怎么处理

相机遮挡不建议直接用 heightfield 替代，因为它要判断“角色和相机之间是否有树/石头挡住”，不是地面高度问题。

建议改成：

```text
1. 不再 raycast 完整 TerrainModel。
2. 为相机单独准备低模 occluder：
   - 树干简化 capsule / cylinder
   - 大石块简化 box / sphere
   - 必要墙体简化 box
3. 相机每帧只 raycast 这个低模 occluder group。
```

这能保留相机不穿帮，又避免对完整地形网格做求交。

## 和低模首包的关系

现在已经有 `LowTerrainShell`。

后续可以改成：

```text
1. 页面进入跑酷时先加载 heightfield。
2. LowTerrainShell 用 heightfield 生成更准确的低模路面。
3. Character 从第一帧开始用 heightfield 贴地。
4. 完整地形 GLB 加载完成后只替换视觉，不影响移动逻辑。
```

这时完整 GLB 的加载失败也不会阻断游戏核心移动。

## 验收指标

性能：

```text
1. Character 每帧不再调用 intersectObject(terrain, true)。
2. 进入跑酷后的主线程长任务减少。
3. 中低端设备跑酷段 FPS 更稳定。
4. 地形 GLB 加载期间也能稳定移动。
```

行为：

```text
1. 角色不会悬空或陷地。
2. 上坡/下坡没有明显跳变。
3. 河道 / 水面区域表现和当前一致。
4. 星星、NPC、障碍物位置不偏。
5. 完整地形加载完成前后，角色 Y 不明显突变。
```

数据：

```text
1. heightfield 文件小于 1.5 MB，最好小于 500 KB。
2. 采样边界覆盖所有可玩区域。
3. build 后自动带 ?v=<BUILD_ID>。
4. 可走区域 flags 可视化检查通过。
```

## 风险点

```text
1. bake 时必须复用 TerrainModel 的 scale / offset，否则坐标会错位。
2. 地形里树冠、云、装饰物会干扰向下采样，必须过滤。
3. 如果同一 x/z 存在多层高度，HeightField 会丢信息。
4. 完整地形和 heightfield 版本必须同步更新。
```

对应措施：

```text
1. bake 脚本输出版本号和源 GLB hash。
2. runtime 检查 heightfield metadata.sourceHash。
3. 提供 debug overlay，把 heightfield 采样点可视化。
4. 保留 raycast fallback 开关，便于回滚。
```

## 分阶段执行

### Phase 1：Bake HeightField

```text
新增 scripts/bake-terrain-navmesh.mjs
输出 terrain-heightfield.json/bin
写 docs/heightfield-bake-report.md
```

### Phase 2：角色贴地替换

```text
Character.tsx 改用 sampleHeight
保留 raycast fallback
对比跑酷段 FPS 和主线程耗时
```

### Phase 3：静态物体落位替换

```text
NPC / Obstacles / GroundDetail / GLBFlowers / TreeScatter 改用 heightfield
减少进入跑酷时的一次性 raycast 峰值
```

### Phase 4：相机低模遮挡体

```text
创建 simplified-occluders
CameraRig 只 raycast 低模遮挡体
完整地形不再参与相机遮挡
```

### Phase 5：完整地形视觉化

```text
完整 GLB 只负责视觉
移动、贴地、可走区域、落位全部走 baked data
```

## 最终目标

```text
完整地形 GLB：视觉资源
HeightField/NavMesh：移动和高度
低模 Occluder：相机遮挡
低模首包：加载期可玩体验
```

这样地形越大，运行时越不怕。静态数据提前算好，浏览器只做轻量查询，才是这个项目更适合的方向。
