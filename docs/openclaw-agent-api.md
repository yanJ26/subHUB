# API Hub OpenClaw Agent API

基础地址默认是 `http://127.0.0.1:8787`。在 VPS 上只绑定回环地址或 Docker 私有网络，不经公网暴露。

## 认证

每个 `/v1/openclaw/*` 请求必须包含：

```http
Authorization: Bearer <APIHUB_OPENCLAW_TOKEN>
```

如果配置了 `APIHUB_OPENCLAW_HMAC_SECRET`，所有 POST 请求还必须包含对原始请求体计算的 HMAC：

```http
x-apihub-signature: sha256=<hex digest>
```

Token 和 HMAC Secret 必须通过 VPS 环境变量或 Docker Secret 提供，不能进入 Git、日志、聊天或数据库。

## `GET /health`

不需要认证。仅返回服务是否就绪及缺失的环境变量名称，不返回值。

```json
{
  "status": "ok",
  "missingConfiguration": []
}
```

## `POST /v1/openclaw/intake`

OpenClaw 唯一可由模型触发的写入入口。请求体：

```json
{
  "sourceMessageId": "openclaw:stable-message-hash",
  "senderId": "telegram-owner-id",
  "channel": "telegram",
  "message": "记录 Cursor Pro，每月 20 美元，9 月 8 日到期，主力",
  "timestamp": "2026-08-05T21:00:00.000Z"
}
```

限制：

- `timestamp` 与服务器时间相差不能超过 15 分钟。
- `message` 最长 12,000 字符。
- 请求体默认不能超过 32 KiB。
- 相同 `sourceMessageId` 永远幂等。
- 疑似包含 API Key、Token 或 Secret 时，在调用模型之前拒绝。

### 成功生成草稿

HTTP 201：

```json
{
  "status": "pending_confirmation",
  "draft": {
    "id": "41ec...",
    "intent": "create_subscription",
    "summary": "新增订阅：Cursor Pro\n价格：20\n币种：USD",
    "status": "pending_confirmation",
    "expiresAt": "2026-08-05T21:15:00.000Z"
  },
  "approval": {
    "code": "583104",
    "command": "/apihub-confirm 41ec... 583104",
    "expiresAt": "2026-08-05T21:15:00.000Z"
  }
}
```

### 需要补充信息

HTTP 200，状态为 `needs_clarification`，没有草稿和确认码。

### 疑似密钥或禁止操作

HTTP 422。消息原文不落库。

### 模型不可用

HTTP 503，状态为 `parse_failed`。消息哈希和失败状态会被记录，但不会生成或修改订阅。

## `GET /v1/openclaw/drafts/{id}`

返回不包含确认码哈希和模型内部结果的安全草稿摘要。

## `POST /v1/openclaw/drafts/{id}/commit`

只能由确定性 `/apihub-confirm` 命令调用：

```json
{
  "approvalCode": "583104"
}
```

提交条件：草稿存在、尚未提交、没有过期且确认码正确。写入在 SQLite `BEGIN IMMEDIATE` 事务中进行，并同时写入审计日志。

## `POST /v1/openclaw/drafts/{id}/cancel`

取消待确认草稿。已提交或已取消的草稿不会再次改变状态。

## `GET /v1/openclaw/subscriptions/search?q=Codex`

只读模糊搜索，最多返回 20 条未归档订阅。接口不返回任何凭据，因为数据模型中不存在凭据字段。

## `GET /v1/openclaw/reports/upcoming?days=30`

返回未来 1～365 天内到期的未归档订阅。

## OpenClaw 插件

插件源码位于：

```text
integrations/openclaw-apihub/
```

它注册：

- 可选且仅限所有者上下文的 `apihub_submit_message` 工具。
- 绕过模型的 `/apihub-confirm` 命令。
- 绕过模型的 `/apihub-cancel` 命令。

不要在 OpenClaw 中允许整个插件命名空间，只单独允许 `apihub_submit_message`。不要为 OpenClaw 开启任意 Shell 来替代该插件。
