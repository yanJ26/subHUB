# subHUB 模型 BYOK

## 配置方式

登录后进入“数据与连接”→“一句话录入模型”，填写兼容接口地址、模型 ID 和 API Key。网页保存的 BYOK 优先于服务器的 `SUBHUB_GATE_MODEL_*` 环境变量；删除网页 BYOK 后自动回退到环境配置。

## 密钥边界

- API Key 只允许通过专用模型设置接口提交，普通录入、手工业务数据、导入和恢复仍会拒绝疑似密钥。
- Gateway 使用 AES-256-GCM、每次随机 96-bit IV 和认证标签加密 Key。
- SQLite 只保存密文、IV、认证标签和非敏感模型信息。
- `SUBHUB_SECRETS_MASTER_KEY` 只存在于 Gateway 环境或受控 Secret 中，不进入 SQLite、业务 JSON、浏览器响应或审计摘要。
- 页面只显示是否已配置，从不返回 Key、尾号或密文。更新时 Key 留空表示保留原 Key。
- 生产模型地址必须使用 HTTPS。私网地址默认阻止；确有需要时可显式设置 `SUBHUB_ALLOW_PRIVATE_MODEL_ENDPOINTS=true` 并同时限制 Gateway 出站网络。

## 备份与恢复

完整 SQLite 备份包含 BYOK 密文，但不包含主密钥。业务 JSON 不包含模型配置。SQLite 与主密钥必须分开备份；若主密钥丢失或不匹配，应删除旧 BYOK 并重新配置，不能恢复明文。
