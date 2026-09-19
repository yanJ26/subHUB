# subHUB 自然语言录入

## 产品路径

自然语言录入继承 apiHUB 的核心体验：Owner 可以随意组织文字，不必先理解 Provider、CatalogItem、Entitlement 和 Invoice 的关系，也不必分多步建立它们。

```text
Owner 自由输入
  → 登录会话与疑似密钥检查
  → 隔离模型输出固定 JSON
  → 确定性策略校验
  → 有时限的草稿预览
  → Owner 明确确认
  → 单事务写入完整关系
```

当前只支持新增订阅。模型没有工具、数据库或写入权限；修改、删除、设置和其他意图会被拒绝或要求澄清。该入口是 subHUB 自身的 Web 功能，与 OpenClaw 无关。

## 数据与安全边界

- 原始输入不持久化；数据库只保存 SHA-256、结构化候选、服务端生成的摘要、状态和过期时间。
- API Key、Token、密码、Cookie、私钥和完整卡号会在调用模型前被拒绝。
- 模型必须用 `null` 表达未知信息，不得自行补全金额、日期、厂商、标签、发票或续费设置。
- 普通代码再次验证真实日历日期、金额范围、枚举、HTTPS 链接、标签目录、重复方案和置信度。
- `renewsAt` 是下次扣款或续费日期；`expiresAt` 是访问权益实际结束日期，二者分别保存。
- 草稿绑定创建时的数据库 revision。其他窗口先修改数据后，旧草稿提交会返回冲突并要求重新生成。
- 草稿过期、取消或已提交后都不能再次写入。

## 自动建立的关系

确认草稿后，Gateway 会在一个 SQLite 事务里：

1. 按名称复用或创建 Provider。
2. 在该 Provider 下复用或创建 CatalogItem，并补充服务角色。
3. 创建 Entitlement，写入方案、计费、续费、到期、提醒、渠道和标签。
4. 仅在存在发票信息时创建 Invoice。
5. 增加 revision、记录受控审计摘要并把草稿标记为 committed。

任一步失败，整个事务回滚。

## 接口

这些接口只由已登录的同源 Web 通过内部 Bearer 通道调用：

```text
POST /v1/web/intake
POST /v1/web/intake/drafts/:id/commit
POST /v1/web/intake/drafts/:id/cancel
```

模型使用 OpenAI-compatible `POST /chat/completions`，要求支持严格 `json_schema` 响应格式。默认 30 秒超时、`temperature: 0`，一次输入最多调用模型一次。
