# 模型 BYOK 设置与密钥边界

## 目的

API Hub 允许所有者在登录后的“模型设置”页面保存一个 OpenAI-compatible 模型的 Base URL、模型 ID 和 API Key。该凭据只供语义闸机调用模型使用，不属于 API 订阅台账。

订阅新增、修改、导入、Web 智能录入和 OpenClaw 输入仍会拒绝疑似 API Key、Token、Secret、密码或完整卡号。BYOK 设置接口是唯一允许接收模型 API Key 的入口。

## 存储设计

- API Key 使用 AES-256-GCM 加密后写入 SQLite。
- 每次新增或替换都会生成新的 96-bit 随机 IV，并保存 GCM 认证标签。
- SQLite 只包含密文、IV、认证标签和非敏感配置，不包含明文 Key。
- `APIHUB_SECRETS_MASTER_KEY` 是 Base64 编码的 32 字节独立主密钥，必须保存在 VPS 环境变量或 Docker Secret 中，不能写入 SQLite 或 Git。
- 网页与 API 永远不返回 Key、掩码尾号或密文。读取设置只返回是否配置、来源、Base URL、模型 ID 和更新时间。
- 更新时 Key 留空表示保留原 Key；填写新值表示覆盖旧密文。
- 删除 BYOK 后，语义闸机会回退到 `APIHUB_GATE_MODEL_*` 环境变量；若后备也未配置，则安全失败且不写入订阅。

## VPS 首次配置

在 VPS 上生成主密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

把输出存入不提交到 Git 的 `.env`：

```dotenv
APIHUB_SECRETS_MASTER_KEY=<base64-encoded-32-byte-key>
```

然后重建 Gateway：

```bash
docker compose up -d --build
```

通过 HTTPS 登录 API Hub，在“模型设置”中填写模型地址、模型 ID 和 API Key。不要通过聊天、Issue、提交记录或日志传递真实 Key。

## 备份、轮换与恢复

- SQLite 备份与主密钥备份应分开存放并分别限制权限。
- 丢失主密钥后无法解密已保存 Key；应删除 BYOK 配置并重新填写，而不是尝试恢复明文。
- 更换模型服务商 Key 时，在设置页输入新 Key 保存，旧密文会被覆盖。
- 主密钥轮换需要先解密并重新加密现有凭据；当前首版不提供自动主密钥轮换命令，轮换前应维护备份。
- 日志和审计记录只记录 `keyConfigured`、`keyReplaced` 等布尔元数据，不记录 Key 或密文。

## 网络限制

- 公网模型接口必须使用 HTTPS。
- 本地开发仅允许 `http://localhost`、`http://127.0.0.1` 或 `http://[::1]`。
- 默认阻止显式私网 IP 模型地址。确需访问 VPS 私网模型时，评估 SSRF 风险后显式设置 `APIHUB_ALLOW_PRIVATE_MODEL_ENDPOINTS=true`，并同时使用防火墙限制 Gateway 的出站范围。

## 威胁边界

此方案保护 SQLite 文件单独泄露时的 API Key 机密性与完整性。若攻击者同时取得 SQLite、VPS 主密钥或 Gateway 进程权限，凭据仍可能被使用或解密。因此生产部署仍需 HTTPS、强站点密码、最小系统权限、受控备份、日志脱敏与及时轮换上游 Key。
