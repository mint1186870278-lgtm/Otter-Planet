# SectionVisualNovel — UI 布局备注

测量基准：**1600 × 900 viewport**，截图脚本 `C:\Temp\vn_measure.mjs`

---

## 中文文案折行（`wrapCJK`）

设计稿铁律「每屏短句、6 岁能读」→ 卡片文字用 `wrapCJK()` 硬折行，不靠 CSS 宽度（字体度量不可控）。
- 规则「标点优先 + 均匀分行」：先按 `，。！？～…` 断句；每句 ≤6 实字整句成行；超 6 则均匀分成若干行（尽量等长，避免孤字）。
- 例：`故事讲得越详细，` 7 字 → `故事讲得`/`越详细，`（4+3），不是 6+1 孤字。
- 标点不计入字数、黏在所在行尾；仅对 zh 生效（en 走自然换行）。
- 渲染：文字容器加 `whitespace-pre-line` 让 `\n` 生效；`{lang==='zh' ? wrapCJK(text) : text}`。
- 调每行字数：改模块级常量 `LINE_MAX`（当前 6）。

---

## 顶部 HUD（`z-20`，高度区间 0 → ~186px）

| 元素 | 定位方式 | 尺寸（Tailwind） |
|---|---|---|
| 返回按钮（按钮1.png） | `absolute left-4 top-4` (md: left-8 top-6) | `w-14 h-14` (md: w-16 h-16) |
| 进度条（进度条初始.png） | `absolute left-1/2 -translate-x-1/2 top-4` | `h-16` (md: h-20, lg: h-24) |
| 冒险进度标签（冒险标签无文字.png） | 进度条下方 `gap-1.5` | `h-12` (md: h-14, lg: h-16) |
| 星星数（星星数初始无数字.png） | `absolute right-4 top-4` (md: right-8 top-6) | `h-14` (md: h-16, lg: h-[72px]) |

> 三列全用 `absolute` 定位，**不用 `justify-between`**（两侧宽度不等会把中间列偏移 ~43px）。

冒险进度标签底部实测约 **186px**。

---

## IP 立绘（ip人物.png，`z-10`）

- `absolute bottom-0 left-2` (md: left-6)
- 容器高度 `h-[60vh]`，图片 `max-h-[95%] object-contain`
- 浮动动画：`y: [0, -10, 0]`，周期 4s

---

## 气泡卡片 + 继续按钮（`z-20`）

外层容器：
```
absolute left-0 right-0 top-[180px] bottom-0
flex items-center justify-center
px-4 pb-20
```
`pb-20` 是卡片组垂直位置的关键调节值（增大 → 组整体上移）。

卡片+按钮列（`flex-col items-center`）：
```
w-[94%] sm:w-[88%] md:w-[78%] lg:w-[70%]
[max-width:min(60rem,100vh)]
-mt-2 md:-mt-1
```

### 气泡卡片（主卡片.png）

实测 `主卡片.png` 比例结构：

| 区域 | y 范围（相对卡片高） |
|---|---|
| 上方透明边距 | 0 → 14% |
| 白色气泡身体 | 14% → 78% |
| 气泡尾巴 | 78% → 83% |
| 下方透明边距 | 83% → 100% |

- 宽高比：`aspect-[1402/1122]`（≈ 1.25:1）
- **只通过宽度控制尺寸**，绝不加 `max-h` / `h-[]`（会破坏 aspect-ratio 拉伸气泡）

文字区：
```
absolute left-[10%] right-[10%] top-[14%] bottom-[22%]
flex items-center justify-center text-center
```

### 1600×900 实测数值

```
card:   top=175  bottom=895  w=900  h=720  cx=800
text:   top=276  bottom=737  w=720  h=461  cx=800
button: top=760  bottom=841  w=270  h=81   cx=800
button_bottom_margin = 59px
```

### 继续按钮（按钮2.png）

```
-mt-[16%] md:-mt-[15%]
w-[42%] sm:w-[36%] md:w-[30%] max-w-xs
```

负 margin 把按钮拉进卡片底部透明区（视觉上在气泡尾巴下方），避免额外撑高导致超出屏幕。
打字机播完（`openingDone=true`）后才渲染。

---

## 语音步（④⑩）卡片内元素

`current.type === 'voice'` 时，气泡身体内垂直排布（`flex-col + gap=LAYOUT.voiceGap`，`top-[12%] bottom-[13%]`）：
**语音题标签 → 问题文字 → 语音条 → 麦克风**。尺寸全在 `LAYOUT.voiceLabel/voiceBar/mic`。

### 语音条文字框（`语音条文字框.png`）——星星别被裁的坑

- PNG 1536×1024，但**黄胶囊本体只占 y 280~678（≈39% 高）**，上下是大片透明留白；右上角有装饰星星。
- ❌ 错误做法：固定容器高 + `overflow-hidden` + img 放大居中 → 胶囊垂直中心(46.8%)不在图正中，放大后**上沿连同星星被裁**。
- ✅ 正确做法：`<img className="w-full object-contain">` **完整显示不裁切**，用**负 margin 按宽度百分比**吸收透明留白：
  ```
  marginTop: '-18.2%'   // 上留白 280/1536
  marginBottom: '-22.5%' // 下留白 346/1536
  ```
  这样图完整（星星不裁）、又不占多余垂直空间，且负 margin 随宽度自动缩放。
- 文字层：`absolute inset-0 flex items-center justify-center`，叠在胶囊中央。空稿显占位提示，有稿显识别文字（实时）。

> 测 PNG 不透明边界的脚本思路：zlib 解 IDAT → 反 filter → 逐行扫 alpha>30。

