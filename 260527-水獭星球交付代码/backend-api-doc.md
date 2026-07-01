# Otter Planet 后端接口文档

## 1. 服务概览

- 服务名称：`Otter Planet Server`
- 技术栈：`FastAPI + SQLite`
- 当前监听端口：`6636`
- 基础地址：`http://localhost:6636`
- 在线文档：`http://localhost:6636/docs`
- 数据格式：除特别说明外，均为 `application/json`
- 鉴权方式：当前版本无鉴权，前后端可直接访问

## 2. 功能模块

当前后端包含以下能力：

1. 健康检查
2. 行为埋点上报
3. 埋点统计
4. 埋点明细分页查询
5. 留资提交
6. 留资统计
7. 留资明细分页查询
8. AI 文字对话
9. AI 图片生成

## 3. 通用约定

### 3.1 时间戳格式

- 所有 `ts` 字段均为毫秒级时间戳
- 示例：`1780464366334`

### 3.2 分页参数

新增加的列表接口统一支持以下分页参数：

- `page`：页码，从 `1` 开始
- `pageSize`：每页条数，范围 `1-100`

统一返回格式：

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 123,
  "items": []
}
```

### 3.3 错误返回格式

FastAPI 默认错误返回示例：

```json
{
  "detail": "sessionId and event are required"
}
```

---

## 4. 接口明细

## 4.1 健康检查

### 接口信息

- 方法：`GET`
- 路径：`/health`
- 用途：检查服务是否正常运行

### 请求参数

- 无

### 请求示例

```bash
curl http://localhost:6636/health
```

### 返回示例

```json
{
  "status": "ok",
  "timestamp": 1780464366334
}
```

### 字段说明

- `status`：服务状态，固定为 `ok`
- `timestamp`：服务返回时的毫秒时间戳

---

## 4.2 埋点上报

### 接口信息

- 方法：`POST`
- 路径：`/api/track`
- 用途：接收前端埋点事件，例如页面进入、按钮点击、游戏开始、分段停留时长等

### 请求体格式

```json
{
  "sessionId": "string",
  "event": "string",
  "ts": 1780464366334,
  "anyOtherField": "any"
}
```

### 必填参数

- `sessionId`：会话 ID，字符串
- `event`：事件名称，字符串

### 可选参数

- `ts`：事件时间，毫秒时间戳；不传则后端自动生成
- 其他任意字段：会被整体保存到 `payload`

### 参数说明

| 参数名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | `string` | 是 | 当前用户或设备的一次会话标识 |
| `event` | `string` | 是 | 事件名，如 `game_start`、`section_duration` |
| `ts` | `number` | 否 | 事件发生时间，毫秒时间戳 |
| `...payload` | `any` | 否 | 其他扩展字段，自动收进 `payload` |

### 请求示例

```bash
curl -X POST http://localhost:6636/api/track \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "sess_001",
    "event": "section_duration",
    "ts": 1780464366334,
    "section": "landing",
    "durationMs": 3200,
    "lang": "zh"
  }'
```

### 成功返回

```json
{
  "success": true
}
```

### 失败示例

缺少必填参数：

```json
{
  "detail": "sessionId and event are required"
}
```

### 数据库存储说明

该接口会把以下数据写入 `tracking_events` 表：

- `session_id`
- `event`
- `payload`，JSON 字符串
- `ts`
- `created_at`

---

## 4.3 埋点统计

### 接口信息

- 方法：`GET`
- 路径：`/api/track/stats`
- 用途：获取埋点总量、会话数、按事件类型聚合的数据

### 请求参数

- 无

### 请求示例

```bash
curl http://localhost:6636/api/track/stats
```

### 返回示例

```json
{
  "total": 29,
  "sessions": 6,
  "byEvent": [
    {
      "event": "game_start",
      "count": 7
    },
    {
      "event": "section_duration",
      "count": 20
    }
  ]
}
```

### 字段说明

- `total`：埋点总条数
- `sessions`：去重后的 `sessionId` 数量
- `byEvent`：按事件名分组统计
- `byEvent[].event`：事件名
- `byEvent[].count`：该事件出现次数

### 前端适用场景

- 顶部统计卡片
- 事件分布柱状图或饼图
- 会话数趋势展示的基础总览区

---

## 4.4 埋点明细列表

### 接口信息

- 方法：`GET`
- 路径：`/api/track/events`
- 用途：分页查询埋点明细，供前端展示表格、筛选和调试使用

### 查询参数

| 参数名 | 类型 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | `number` | 否 | `1` | 页码，从 1 开始 |
| `pageSize` | `number` | 否 | `20` | 每页数量，最大 100 |
| `sessionId` | `string` | 否 | - | 按会话 ID 精确筛选 |
| `event` | `string` | 否 | - | 按事件名精确筛选 |

### 请求示例

查询第一页：

```bash
curl "http://localhost:6636/api/track/events?page=1&pageSize=20"
```

按事件筛选：

```bash
curl "http://localhost:6636/api/track/events?page=1&pageSize=10&event=section_duration"
```

按会话筛选：

```bash
curl "http://localhost:6636/api/track/events?page=1&pageSize=10&sessionId=sess_001"
```

### 返回示例

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 2,
  "items": [
    {
      "id": 29,
      "sessionId": "sess_001",
      "event": "section_duration",
      "payload": {
        "section": "landing",
        "durationMs": 3200,
        "lang": "zh"
      },
      "ts": 1780464366334,
      "createdAt": "2026-06-02 16:46:06"
    },
    {
      "id": 28,
      "sessionId": "sess_001",
      "event": "game_start",
      "payload": {},
      "ts": 1780464300000,
      "createdAt": "2026-06-02 16:45:00"
    }
  ]
}
```

### 字段说明

- `items[].id`：数据库主键 ID
- `items[].sessionId`：会话 ID
- `items[].event`：事件名
- `items[].payload`：扩展埋点内容，JSON 对象
- `items[].ts`：埋点时间，毫秒时间戳
- `items[].createdAt`：数据库写入时间

### 前端展示建议

- 表格字段建议展示：`id`、`sessionId`、`event`、`ts`、`createdAt`
- `payload` 建议做“查看详情”弹窗，避免表格过宽
- 筛选器建议至少支持：
  - `event`
  - `sessionId`
  - 时间范围（当前后端还未提供时间范围筛选，如需要可继续扩展）

---

## 4.5 留资提交

### 接口信息

- 方法：`POST`
- 路径：`/api/otter-egg`
- 用途：提交用户留资信息，支持中英文场景差异化校验

### 请求体格式

```json
{
  "email": "string | null",
  "wechat": "string | null",
  "lang": "zh | en",
  "source": "string",
  "ts": 1780464366334
}
```

### 参数说明

| 参数名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `email` | `string` | 条件必填 | 英文用户必须填写 |
| `wechat` | `string` | 条件必填 | 中文用户必须填写 |
| `lang` | `string` | 是 | 语言标识，当前逻辑主要区分 `zh` 和 `en` |
| `source` | `string` | 是 | 提交来源，如 `landing-page`、`otter-egg` |
| `ts` | `number` | 否 | 提交时间，毫秒时间戳，不传则后端自动生成 |

### 校验规则

- `lang=zh` 时，必须有 `wechat`
- `lang=en` 时，必须有 `email`
- `lang=en` 且传了 `email` 时，会校验邮箱格式

### 请求示例

中文用户：

```bash
curl -X POST http://localhost:6636/api/otter-egg \
  -H "Content-Type: application/json" \
  -d '{
    "wechat": "fangbaini_001",
    "lang": "zh",
    "source": "landing-page",
    "ts": 1780464366334
  }'
```

英文用户：

```bash
curl -X POST http://localhost:6636/api/otter-egg \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "lang": "en",
    "source": "landing-page"
  }'
```

### 成功返回

```json
{
  "success": true
}
```

### 失败示例

中文场景缺少微信号：

```json
{
  "detail": "Wechat is required for Chinese users"
}
```

英文场景缺少邮箱：

```json
{
  "detail": "Email is required for English users"
}
```

邮箱格式不正确：

```json
{
  "detail": "Invalid email format"
}
```

---

## 4.6 留资统计

### 接口信息

- 方法：`GET`
- 路径：`/api/otter-egg/stats`
- 用途：获取留资总量、按语言统计、最近 10 条留资记录

### 请求参数

- 无

### 请求示例

```bash
curl http://localhost:6636/api/otter-egg/stats
```

### 返回示例

```json
{
  "total": 3,
  "byLang": [
    {
      "lang": "en",
      "count": 1
    },
    {
      "lang": "zh",
      "count": 2
    }
  ],
  "recent": [
    {
      "id": 3,
      "email": null,
      "wechat": "111",
      "lang": "zh",
      "source": "otter-egg",
      "ts": 1780386967141,
      "created_at": "2026-06-02 07:56:07"
    }
  ]
}
```

### 字段说明

- `total`：留资总条数
- `byLang`：按语言分组统计
- `recent`：最近 10 条留资记录

### 前端适用场景

- 顶部统计卡片
- 语言分布图表
- 首页最近留资滚动列表

---

## 4.7 留资明细列表

### 接口信息

- 方法：`GET`
- 路径：`/api/otter-egg/submissions`
- 用途：分页查询留资明细，供前端展示完整留资列表、搜索和筛选

### 查询参数

| 参数名 | 类型 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | `number` | 否 | `1` | 页码，从 1 开始 |
| `pageSize` | `number` | 否 | `20` | 每页数量，最大 100 |
| `lang` | `string` | 否 | - | 按语言筛选，如 `zh`、`en` |
| `source` | `string` | 否 | - | 按来源筛选 |
| `keyword` | `string` | 否 | - | 模糊搜索 `email` 或 `wechat` |

### 请求示例

查询第一页：

```bash
curl "http://localhost:6636/api/otter-egg/submissions?page=1&pageSize=20"
```

按语言筛选：

```bash
curl "http://localhost:6636/api/otter-egg/submissions?page=1&pageSize=20&lang=zh"
```

按关键词搜索：

```bash
curl "http://localhost:6636/api/otter-egg/submissions?page=1&pageSize=20&keyword=example"
```

### 返回示例

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 3,
  "items": [
    {
      "id": 3,
      "email": null,
      "wechat": "111",
      "lang": "zh",
      "source": "otter-egg",
      "ts": 1780386967141,
      "createdAt": "2026-06-02 07:56:07"
    },
    {
      "id": 2,
      "email": "test@example.com",
      "wechat": null,
      "lang": "en",
      "source": "test",
      "ts": 1234567890,
      "createdAt": "2026-06-02 00:54:58"
    }
  ]
}
```

### 字段说明

- `items[].id`：记录 ID
- `items[].email`：邮箱，中文用户可能为空
- `items[].wechat`：微信号，英文用户可能为空
- `items[].lang`：语言
- `items[].source`：来源
- `items[].ts`：业务时间戳
- `items[].createdAt`：数据库写入时间

### 前端展示建议

- 表格字段建议展示：`id`、`lang`、`email`、`wechat`、`source`、`ts`、`createdAt`
- 筛选器建议支持：
  - `lang`
  - `source`
  - `keyword`
- 搜索框可统一查邮箱和微信号

---

## 4.8 AI 文字对话

### 接口信息

- 方法：`POST`
- 路径：`/api/chat`
- 用途：调用 `Doubao-Seed-2.0-lite` 模型进行文字对话，供前端聊天框、多轮问答和 AI 助手场景使用

### 请求体格式

```json
{
  "messages": [
    {
      "role": "system",
      "content": "你是一个友好的助手"
    },
    {
      "role": "user",
      "content": "你好，请做个自我介绍"
    }
  ],
  "temperature": 0.7,
  "maxTokens": 2048,
  "topP": 0.7
}
```

### 参数说明

| 参数名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `messages` | `object[]` | 是 | 完整对话消息列表，多轮对话时前端需要带上历史消息 |
| `messages[].role` | `string` | 是 | 消息角色，仅支持 `system`、`user`、`assistant` |
| `messages[].content` | `string` | 是 | 消息文本内容 |
| `temperature` | `number` | 否 | 采样温度，范围 `0-1`，越大越发散 |
| `maxTokens` | `number` | 否 | 最大输出 token 数，默认 `2048` |
| `topP` | `number` | 否 | 核采样阈值，范围 `0-1` |

### 请求示例

单轮对话：

```bash
curl -X POST http://localhost:6636/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "你好，请回复：测试成功"
      }
    ],
    "temperature": 0.2,
    "maxTokens": 128,
    "topP": 0.7
  }'
```

多轮对话：

```bash
curl -X POST http://localhost:6636/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "system",
        "content": "你是 Otter Planet 的 AI 助手"
      },
      {
        "role": "user",
        "content": "我想了解这个产品"
      },
      {
        "role": "assistant",
        "content": "这是一个 AI 互动产品。"
      },
      {
        "role": "user",
        "content": "请继续详细介绍"
      }
    ]
  }'
```

### 成功返回

```json
{
  "id": "0217804818665561c239b210ad979e2a15a147bceeac3acdfe4f3",
  "model": "doubao-seed-2-0-lite-260428",
  "reply": "测试成功",
  "reasoning": "我将直接回复用户“测试成功”。",
  "usage": {
    "promptTokens": 41,
    "completionTokens": 85,
    "totalTokens": 126,
    "reasoningTokens": 83
  },
  "message": {
    "role": "assistant",
    "content": "测试成功"
  }
}
```

### 字段说明

- `id`：上游 ARK 请求 ID
- `model`：实际使用的模型 ID
- `reply`：助手最终回复文本
- `reasoning`：模型返回的思考摘要，若上游提供则返回
- `usage`：本次请求的 token 消耗情况
- `message`：标准化后的 assistant 消息对象，前端可直接追加到聊天记录里

### 前端对接建议

- 前端本地维护完整 `messages` 列表
- 每次新提问时，把历史消息和当前 `user` 消息一起传给后端
- 拿到响应后，将返回的 `message` 直接追加到本地消息列表
- 如果只需要展示正文，可直接使用 `reply`

### 实现说明

- 当前默认模型为：`doubao-seed-2-0-lite-260428`
- 当前调用的是 ARK Chat API：`/api/v3/chat/completions`
- 当前接口为非流式返回，适合先快速接前端聊天框

> ⚠️ **响应耗时提醒**：该模型是推理模型，每次会先生成思考内容（`usage.reasoningTokens` 约 200），**单次响应实测需 5~9 秒**。又因为是非流式（一次性返回完整结果），前端在拿到结果前会有明显等待。前端需做好 loading 态/打字机回放，并避免设置过短的请求超时（建议 ≥ 30 秒）。若后续要追求"边说边出"的即时感，可考虑让后端改成 SSE 流式输出。

---

## 4.9 AI 图片生成

### 接口信息

- 方法：`POST`
- 路径：`/api/generate-image`
- 用途：调用外部 ARK 模型生成图片，返回图片 URL

### 请求体格式

```json
{
  "prompt": "string",
  "images": ["string"],
  "size": "string"
}
```

### 参数说明

| 参数名 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `prompt` | `string` | 是 | 图片生成提示词 |
| `images` | `string[]` | 否 | 参考图片 URL 列表（字段名为复数 `images`，必须是公网 https 可访问的图） |
| `size` | `string` | 是 | 图片尺寸，可用值 `2K` 或 `2048x2048`；⚠️ **`1024x1024` 实测会返回 400，不要用** |

> ⚠️ **尺寸踩坑提醒**：当前 ARK 模型只接受 `2K` / `2048x2048` 等写法，`1024x1024` 会被上游拒绝（400 Bad Request）。下方示例已用可用值。
> ⚠️ **参考图来源**：`images` 里的 URL 必须是国内可访问的公网图。实测 `raw.githubusercontent.com` 会超时，需用 CDN（如 jsDelivr）镜像。

### 请求示例

```bash
curl -X POST http://localhost:6636/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cute otter in a dreamy planet, 3D style",
    "images": [],
    "size": "2K"
  }'
```

### 成功返回

```json
{
  "url": "https://example.com/generated-image.png"
}
```

### 失败示例

缺少参数：

```json
{
  "detail": "prompt and size are required"
}
```

未配置 API Key：

```json
{
  "detail": "ARK_API_KEY not configured"
}
```

### 实现说明

- 当前模型固定为：`doubao-seedream-4-0-250828`
- 最多自动重试 `5` 次
- 返回值仅为图片 URL，不会落库存储

---

## 5. 前端展示页对接建议

## 5.1 埋点数据展示页

建议前端页面拆成两块：

1. 总览区
2. 明细表格区

建议调用方式：

- 总览区调用：`GET /api/track/stats`
- 明细表格调用：`GET /api/track/events`

建议页面字段：

- 总埋点数
- 总会话数
- 按事件分布图
- 埋点明细表格

表格建议列：

- `id`
- `sessionId`
- `event`
- `ts`
- `createdAt`
- `payload`

---

## 5.2 留资数据展示页

建议前端页面拆成两块：

1. 总览区
2. 留资明细区

建议调用方式：

- 总览区调用：`GET /api/otter-egg/stats`
- 明细表格调用：`GET /api/otter-egg/submissions`

建议页面字段：

- 留资总数
- 中英文分布
- 最近留资
- 完整留资表格

表格建议列：

- `id`
- `lang`
- `email`
- `wechat`
- `source`
- `ts`
- `createdAt`

---

## 6. 当前接口清单汇总

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/track` | 上报埋点 |
| `GET` | `/api/track/stats` | 获取埋点统计 |
| `GET` | `/api/track/events` | 获取埋点明细分页列表 |
| `POST` | `/api/otter-egg` | 提交留资 |
| `GET` | `/api/otter-egg/stats` | 获取留资统计 |
| `GET` | `/api/otter-egg/submissions` | 获取留资明细分页列表 |
| `POST` | `/api/chat` | 文字对话 |
| `POST` | `/api/generate-image` | 生成图片 |

## 7. 后续可扩展项

如果后续你们要做运营后台，我建议下一步可以继续补：

1. 时间范围筛选，例如开始时间、结束时间
2. 按来源统计，例如 `source` 聚合
3. 埋点导出和留资导出
4. 简单鉴权，避免后台数据接口裸露
5. 数据删除或标记处理状态
