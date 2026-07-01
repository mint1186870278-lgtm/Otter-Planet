# 地形材质清单（scene-terrain.glb）

> 数据来自运行时 console 打点（两轮采样）。高度 `centerY` 为材质改色前、缩放施加前的**模型本地坐标系** Y 质心。
> 分流阈值：castShadow 用 `HEIGHT_SPLIT_Y = 1.2`；SpruceTreeLeaf 草地/松树冠分流用 `SPRUCE_GROUND_MAX_Y = 3`。

---

## ⚠️ 核心坑：满地变青绿的真正原因

最初误判为"草地由低矮 Green.NNN 树叶铺成"，**错误**。真相是：

```
[ELEVATED] centerY=8.26 | mesh=Cylinder150_7 | mat=SpruceTreeLeaf.003 | color=#78c500   ← 高处松树冠
[GROUND]   centerY=0.03 | mesh=Cylinder150_8 | mat=SpruceTreeLeaf.001 | color=#78c500   ← 贴地大地面(草地)
```

**地面（草地）的材质名是 `SpruceTreeLeaf.001`**，和高处的松树冠 `SpruceTreeLeaf.003` 同属 `SpruceTreeLeaf` 前缀、同源色 `#78c500`。

之前规则 `n.startsWith('SpruceTreeLeaf') → 松树青绿(#35C8A5)`，把贴地的大地面也一起染成了青绿 → **满屏青绿**。

### 解法：SpruceTreeLeaf 按高度分流
- `centerY < 3`（贴地）→ 草地色 `#B8D94D`（暖黄绿）
- `centerY ≥ 3`（高处）→ 松树冠色 `#35C8A5`（青绿）

并对 SpruceTreeLeaf **clone 材质后再赋色**，避免草地与松树冠共享实例时互相覆盖。

---

## 材质名 → 用途 → 处理规则 总表

| 材质名 / 前缀 | 原色 | mesh 示例 | centerY | 实际用途 | 处理 |
|---|---|---|---|---|---|
| `SpruceTreeLeaf.*`（低） | #78c500 | Cylinder150_8 | 0.03 | **地面草地（大网格）** | → grass `#B8D94D`（clone） |
| `SpruceTreeLeaf.*`（高） | #78c500 | Cylinder150_7 | 8.26 | 松树冠 | → spruceLeaf `#35C8A5`（clone） |
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
