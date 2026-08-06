# VPS 部署：API Hub Gateway 与 OpenClaw

## 网络建议

API Hub Web 继续由 Caddy/Nginx 通过 HTTPS 对外服务。Gateway 只绑定：

```text
127.0.0.1:8787
```

OpenClaw 如果运行在 VPS 宿主机，访问 `http://127.0.0.1:8787`；如果运行在同一个 Docker 网络中，访问 `http://api-hub-gateway:8787`。

不要把 8787 映射为 `0.0.0.0:8787`，也不要为它配置公共域名。

## 环境变量

从项目根目录复制示例文件：

```bash
cp .env.example .env
```

生成彼此不同的高熵随机 Secret，并填入：

```text
APIHUB_OPENCLAW_TOKEN=...
APIHUB_OPENCLAW_HMAC_SECRET=...
APIHUB_WEB_INTERNAL_TOKEN=...
APIHUB_WEB_SESSION_SECRET=...
```

另设一个只由所有者掌握的站点密码：

```text
APIHUB_WEB_PASSWORD=...
```

然后配置闸机模型：

```text
APIHUB_GATE_MODEL_BASE_URL=https://provider.example/v1
APIHUB_GATE_MODEL=your-structured-output-model
APIHUB_GATE_MODEL_API_KEY=...
APIHUB_SECRETS_MASTER_KEY=<base64-encoded-32-byte-key>
```

`.env` 已被 Git 忽略，`.env.example` 只保留字段名和安全占位符。

## 启动 Gateway

```bash
docker compose up -d --build api-hub-gateway
curl http://127.0.0.1:8787/health
```

只有 `status: ok` 才允许继续连接 OpenClaw。

## 安装 OpenClaw 插件

先人工阅读 `integrations/openclaw-apihub` 的全部代码，然后在 VPS 上安装本地插件：

```bash
openclaw plugins install /path/to/apiHUB/integrations/openclaw-apihub --force
```

本地路径插件属于任意来源安装，`--force` 表示操作者已经审阅源码，不代表绕过 OpenClaw 自身安全策略。

OpenClaw 服务进程需要相同的：

```text
APIHUB_GATEWAY_URL=http://127.0.0.1:8787
APIHUB_OPENCLAW_TOKEN=...
APIHUB_OPENCLAW_HMAC_SECRET=...
```

它不需要、也不应获得 `APIHUB_GATE_MODEL_API_KEY`。

## OpenClaw 权限

只允许：

```json5
{
  tools: {
    allow: ["apihub_submit_message"]
  },
  commands: {
    ownerAllowFrom: ["<你的渠道所有者ID>"]
  }
}
```

不要因为安装此插件而开启 `exec`、浏览器、文件写入或整个插件的工具通配符。运行：

```bash
openclaw security audit --deep
```

## 数据卷与备份

Gateway SQLite 位于 Docker 卷 `/data/apihub.sqlite`。每天备份整个数据卷或使用 SQLite 在线备份方式，并在备份后验证可恢复性。至少保留最近 7～30 天，备份文件应加密且存放在 VPS 之外。

## 上线检查

- [ ] 8787 仅回环或私有网络可达
- [ ] Web 入口已经启用 HTTPS 和登录保护
- [ ] Web、OpenClaw 和会话使用三个不同的随机 Secret/Token
- [ ] OpenClaw 只允许所有者私聊或严格白名单
- [ ] 只允许 `apihub_submit_message`
- [ ] `/apihub-confirm` 与 `/apihub-cancel` 由插件命令直接处理
- [ ] Token、HMAC Secret、模型 Key 均不在 Git 中
- [ ] `/health` 为 `ok`
- [ ] Gateway 自动测试通过
- [ ] OpenClaw 深度安全审计通过
- [ ] SQLite 备份和恢复演练完成
