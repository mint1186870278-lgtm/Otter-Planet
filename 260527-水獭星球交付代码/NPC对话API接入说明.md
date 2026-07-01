# 水獭星球 · NPC 对话生成 API 接入说明

> 本文档整理跑酷环节三个 NPC（啄木鸟 / kiwi 基维鸟 / 叽里咕噜）AI 对话的接口、模型、请求格式、流式解析与标记约定。
> 全部实现集中在 [`src/components/SectionParkour.tsx`](src/components/SectionParkour.tsx) 顶部（第 10–108 行）。

---

## 一、接口与模型一览

| 项 | 值 |
|---|---|
| 服务商 | 阶跃星辰 **StepFun** |
| 接口地址 | `POST https://api.stepfun.com/v1/chat/completions` |
| 接口风格 | OpenAI 兼容（`messages` / `choices[].delta` 结构一致） |
| 模型 | **`step-2-16k`** |
| 鉴权 | HTTP Header `Authorization: Bearer <API_KEY>` |
| 密钥来源 | 环境变量 `VITE_STEPFUN_API_KEY`（Vite 注入，见 `import.meta.env`） |
| 返回方式 | **流式（SSE，`stream: true`）**，逐 token 累计显示 |

### 模型选型说明
- 定稿原定的 `step-1-flash` 在当前 StepFun 账号下已不存在（请求返回 **404 `model_invalid`**）。
- 改用 `step-2-16k`：实测可用、**非推理模型**、响应快、输出干净，适合儿童短对话场景。

---

## 二、配置常量

```ts
// SectionParkour.tsx:10-15
const STEPFUN_API_URL = 'https://api.stepfun.com/v1/chat/completions';
const API_KEY = import.meta.env.VITE_STEPFUN_API_KEY;
const MODEL = 'step-2-16k';
```

> 部署前需在项目根的 `.env`（或部署环境变量）里配置 `VITE_STEPFUN_API_KEY=sk-xxxx`。
> 未配置时对话会抛错并走友好兜底文案（见第六节）。

---

## 三、消息结构

```ts
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
```

每个 NPC 进入对话时，`messages` 数组按如下顺序组装：

1. **第 0 条** `system`：该 NPC 的人设与任务 prompt（见第四节）。
2. **第 1 条** `assistant`：hardcode 开场白（不调用 API，纯前端打字机播放，但作为上下文喂给模型）。
3. **之后** 依次追加每轮 `user`（小朋友输入）/ `assistant`（AI 回复，含标记原文）。

每次小朋友发送消息，都把**完整历史**重新发给接口（无服务端会话状态）。

---

## 四、三个 NPC 的 System Prompt

索引 0/1/2 对应 NPC1/2/3，定义在 `NPC_SYSTEM_PROMPTS`（SectionParkour.tsx:20-27）。

### NPC1 · 啄木鸟（意图判断）
> 你是啄木鸟，一个潮酷的老登，穿花衬衫、红色大背头，说话简短有力，像一个见过世面的酷叔叔，偶尔用老派俚语。你在跑酷路上遇到了一个小朋友，你的任务是：判断小朋友说的话是否和"去找月亮"有关。规则：如果小朋友说的内容和"找月亮/寻找月亮/月亮不见了/去找月亮"有关，给予热情鼓励，然后说"有人知道月亮在哪！多去问问，完成考验就能知道答案～"，在回复末尾加上 `[COMPLETE]`。如果无关，给一个有趣的提示引导他们说出正确意图，语气像酷叔叔在考验小朋友，不要直接说答案。回复不超过 30 字，儿童友好但保持潮酷个性，不能有不适合儿童的内容，中文回复。

### NPC2 · kiwi 基维鸟（猜名字 + 指错路）
> 你是 kiwi 基维鸟，一个星际旅行背包客，活泼好奇，口头禅是"kiwi"，说话轻快有趣，像永远在旅途中的冒险家。互动流程：第一步问"你猜猜我是谁？"第二步无论小朋友说什么名字都开心接受，回复"没错我就是[名字]！kiwi！"并加上 `[NAME:名字]` 标记。第三步告诉小朋友你知道月亮线索，引导他继续跑但故意说错方向（指向假月亮），说"kiwi！我知道月亮在哪！往那边跑！"末尾加 `[COMPLETE]`。每次回复不超过 25 字，必须含"kiwi"口头禅，语气活泼，不能有不适合儿童的内容，中文回复。

### NPC3 · 叽里咕噜（描述月亮）
> 你是叽里咕噜，水獭的发小，热爱植物的科学家，说话有点书呆子气但非常可爱，喜欢引用"研究数据"和"观测记录"，内心温柔支持小朋友。你的任务是让小朋友描述月亮长什么样子。先说"完成我的小考验，我就告诉你月亮在哪！考验是——说出月亮长什么样！"无论小朋友怎么描述月亮（任何描述都算对），给出充满惊喜/好奇/赞美的情绪回应，像科学家发现新物种一样兴奋，然后说"根据我的观测记录，真月亮就在前面！跟我来！"末尾加 `[COMPLETE]`。每次回复不超过 35 字，要有科学家书呆子语气但温柔可爱，对描述充分肯定，不能有不适合儿童的内容，中文回复。

---

## 五、请求与流式解析

### 请求体
```ts
// SectionParkour.tsx:65-73
fetch('https://api.stepfun.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: 'step-2-16k',
    messages,        // 完整对话历史（system + 开场白 + 往返）
    stream: true,    // 开启 SSE 流式
  }),
  signal,            // AbortController.signal，关闭对话时中断请求
})
```

### 流式解析函数 `streamChat`
（SectionParkour.tsx:57-108）

```ts
async function streamChat(
  messages: ChatMessage[],
  onToken: (full: string) => void,   // 每次回调传"累计全文"，不是单个 delta
  signal?: AbortSignal,
): Promise<string> {                  // 返回含标记的完整原始文本
  if (!API_KEY || API_KEY === 'YOUR_STEPFUN_API_KEY') {
    throw new Error('VITE_STEPFUN_API_KEY 未配置');
  }
  const res = await fetch(STEPFUN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`StepFun API ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE：以 \n 分隔的 "data: {...}" 行
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';        // 末行可能不完整，留到下一轮
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) { full += delta; onToken(full); }
      } catch {
        // 不完整的 JSON 分片，忽略
      }
    }
  }
  return full;
}
```

解析要点：
- 用 `ReadableStream` reader + `TextDecoder` 增量解码；按 `\n` 切行，末行留到下一轮（防截断）。
- 只处理 `data:` 行，跳过 `[DONE]` 结束标记。
- 每行取 `json.choices[0].delta.content`，累加进 `full`，回调 `onToken(full)` 传累计全文。
- 半截 / 不完整 JSON 分片 `try/catch` 静默忽略。

---

## 六、调用方与标记解析

### 调用入口 `handleSend`
```ts
const full = await streamChat(
  history,
  partial => setDisplayedNpcText(sanitizeForDisplay(partial)), // 流式逐字显示，截掉半截标记
  controller.signal,
);
setDisplayedNpcText(stripMarkers(full));                  // 收尾：去掉所有标记
setMessages(prev => [...prev, { role: 'assistant', content: full }]); // 历史存含标记原文
const name = extractName(full);                           // [NAME:xxx] → npc2Name
if (name) setNpc2Name(name);
if (full.includes('[COMPLETE]')) setDialogComplete(true); // 触发"继续"按钮
```

### 控制标记约定
由 system prompt 要求模型在回复中自行附加：

| 标记 | 含义 | 处理 |
|---|---|---|
| `[COMPLETE]` | 本 NPC 对话完成 | 显示"继续 ▶"按钮，结束对话 |
| `[NAME:名字]` | NPC2 接受的名字 | 抽取存入 `npc2Name`，供后续使用 |

### 三个文本工具函数（SectionParkour.tsx:30-51）
```ts
// 去掉所有标记，用于最终展示与历史
function stripMarkers(text: string): string {
  return text.replace(/\[COMPLETE\]/g, '').replace(/\[NAME:[^\]]*\]/g, '').trim();
}

// 流式显示用：去已闭合标记 + 截断末尾半截标记（如 "[COMPL"），防一闪而过
function sanitizeForDisplay(text: string): string {
  let s = text.replace(/\[COMPLETE\]/g, '').replace(/\[NAME:[^\]]*\]/g, '');
  const lastOpen = s.lastIndexOf('[');
  if (lastOpen !== -1 && s.indexOf(']', lastOpen) === -1) s = s.slice(0, lastOpen);
  return s;
}

// 抽取 [NAME:xxx] 里的名字（取第一个匹配）
function extractName(text: string): string | null {
  const m = text.match(/\[NAME:([^\]]*)\]/);
  return m ? m[1].trim() : null;
}
```

---

## 七、错误兜底

- **密钥未配置 / 接口非 2xx**：`streamChat` 抛错，`handleSend` 的 `catch` 显示友好文案：
  - 中文：「让我想想……再跟我说一次吧！」
  - 英文：「Let me think… tell me again!」
  - 兜底不写入历史，方便小朋友重试。
- **AbortError**（关闭对话时主动中断）：静默忽略，不报错。

---

## 八、接入 / 替换清单

若需换模型或换服务商，集中改这几处：

1. `STEPFUN_API_URL` / `MODEL` / 鉴权 Header —— SectionParkour.tsx:11-15、67-69。
2. 流式解析字段 `json.choices[0].delta.content` —— 若新接口字段不同需同步改（SectionParkour.tsx:97）。
3. `messages` 结构 —— 当前为 OpenAI 兼容；换非兼容接口需重写组装逻辑。
4. system prompt 与标记约定（`[COMPLETE]` / `[NAME:xxx]`）—— 换模型时确认新模型能稳定遵循标记输出。

---

> 说明文档生成于交付代码现状，对应 `SectionParkour.tsx` 第 10–108 行实现。
