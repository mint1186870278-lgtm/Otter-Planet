# 地形材质清单（scene-terrain-opt.glb）

> 高度 `centerY` 分两栏：**模型本地** = glb 内原始坐标；**世界** = 运行时 `box.setFromObject(mesh)` 实际看到的值（已含 autoScale≈1.30 + offset≈-0.27）。分流代码比的是**世界 cy**。
> 分流阈值：castShadow 用 `HEIGHT_SPLIT_Y = 1.2`；SpruceTreeLeaf 草地/松树冠分流用 `SPRUCE_GROUND_MAX_Y = -1`（世界 Y）。
> 🔧 **改阈值/排查同色问题前，先跑 `node scripts/measure-terrain-heights.mjs`** —— 它复刻运行时变换，逐网格打印真实世界 Y，别再靠记忆里的旧数字。

---

## ⚠️ 核心坑：松树与草地同色的真正原因

`SpruceTreeLeaf` 这个材质名**同时**用在两种网格上：贴地的大地面（草地）和高处的松树冠。必须按 mesh 世界高度分流，只看名字会把两者染成同色。

### 2026-07 实测（scripts/measure-terrain-heights.mjs，共 21 个 SpruceTreeLeaf 网格）

```
[GROUND] 世界cy -4.20 / -3.43 / -2.81 | node=地形2            ← 贴地大地面(草地)，minY 低至 -8.67
[CANOPY] 世界cy  0.05 ~ 1.19          | node=SpruceTreeLeaf.00x ← 松树冠，maxY 高至 2.11
```

两簇之间有 ~2.86 的世界 Y 间隙，**阈值取 -1 落在间隙内**：世界 cy < -1 → 草地；≥ -1 → 松树冠。

### 历史事故
- 旧阈值 `SPRUCE_GROUND_MAX_Y = 3`（还标注为"未缩放模型坐标、草地≈0.03/松树冠≈8.26"）。但**当前 glb 里没有任何 SpruceTreeLeaf 网格世界 cy 高于 3** → 全部判成草地 → 松树冠也被涂成草地色 → 满屏一个绿。旧数字来自某个早已不同的模型版本，已作废。

### 解法：SpruceTreeLeaf 按世界高度分流（并 clone 材质后再赋色）
- 世界 `cy < -1`（贴地）→ 草地色 `#C2E282`
- 世界 `cy ≥ -1`（高处）→ 松树冠：先给 spruceLeaf 底色，再由 `patchPineDepth` shader 覆盖为 `PINE_DEPTH` 指定色 **`#63CB68`**（近/远同色）
- clone 材质是必须的：草地与松树冠共享同一材质实例时会互相覆盖（满地变松树色就是这么来的）。

---

## 材质名 → 用途 → 处理规则 总表

| 材质名 / 前缀 | 原色 | 节点示例 | 世界cy | 实际用途 | 处理 |
|---|---|---|---|---|---|
| `SpruceTreeLeaf.*`（低，cy<-1） | #78c500 | 地形2 | -4.2~-2.8 | **地面草地（大网格）** | → grass `#C2E282`（clone） |
| `SpruceTreeLeaf.*`（高，cy≥-1） | #78c500 | SpruceTreeLeaf.00x | 0.05~1.19 | 松树冠 | → spruceLeaf 底色 + `patchPineDepth` shader 覆盖为 `#63CB68`（clone） |
| `Green.NNN`（步长~5，排除506/507） | #38cd00 | Tree004~Tree104 | ≈0.87 | 圆形树丛叶片 | → roundLeaf `#AEE33D` |
| `Rock` | #a8a8a8 | Cylinder150_2 | 1.25 | 岩石 | → rock `#9FB8B6` |
| `Stone` | #d5b392 | Cylinder150_3 | 0.32 | 石头路面 | → stone `#E9CC8E` |
| `clouds.*` | #e0e7e5 / #e7e7e7 | Cloud001~011 | 26~43 | 云朵 | → cloud `#EEF6FF` |
| `Material_0.*` | #ffffff | Mesh_0~Mesh_0024 | 2~8 | 贴图驱动物体 | 仅清 metalness=0，不改 color |

---

## 保持原样（不在改色列）

| 材质名 | 原色 | 用途 | 原因 |
|---|---|---|---|
| `Green.506` | #9f7f56 | 树干底座 | 原色合适（暖棕） |
| `Green.507` | #facf80 | 松树底盘 | 原色合适（暖黄） |
| `Trunk` | #8b5e3c | 圆树树干 | 原色合适（深棕） |
| `SpruceTreeTrunk.*` | #f7b831 | 松树树干 | 原色合适（橙黄） |
| `Material.002` | #20e700 | NURBS 路径标记线 | 调试标记，不动 |
| `Material.004` | #e70008 | NURBS 路径标记（红） | 调试标记，不动 |
| `Material.005` | #e7c300 | NURBS 路径标记（黄） | 调试标记，不动 |
| `Material.006` | #30e700 | NURBS 路径标记（绿） | 调试标记，不动 |

---

## 经验教训

1. **材质名会撒谎** — `SpruceTreeLeaf` 这个名字被复用在了地面草地上，不能只看名字，必须结合高度/用途验证。
2. **同名材质可能身兼两职** — 同前缀材质用在不同高度的网格上时，必须按 mesh 高度分流 + clone 材质，否则共享实例会互相覆盖。
3. **`Green.NNN` 是圆树树丛叶**，不是草地。它们 centerY≈0.87 偏低，但属于低矮灌木丛，用 roundLeaf 黄绿色合适。
4. **高度阈值会随模型版本失效** — `SPRUCE_GROUND_MAX_Y` 是绑定具体 glb 坐标的硬编码值。换模型/重导出后旧阈值可能整体高于或低于所有网格，导致全判一类、同色。**换 glb 或调阈值前必跑 `scripts/measure-terrain-heights.mjs`**，用实测世界 cy 重定阈值，别信注释里的旧数字。
