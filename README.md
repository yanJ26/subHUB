# API Hub

一个只管理 **API 订阅资料** 的轻量 Web 应用。它记录到期时间、价格、月付/年付、订阅途径、发票状态、发票链接、提醒时间、标签和备注；**订阅记录不设计、不提供、也不保存 API Key、Token 或 Secret 字段**。语义闸机需要的模型 Key 可在独立 BYOK 设置仓库中加密保存。

## 第一版能力

- 订阅总览：月均成本、人民币年化支出、30 天内到期、待处理发票
- 续费雷达：按到期紧迫度呈现近期订阅
- 完整增删改查、搜索、标签筛选和排序
- 月付/年付与 CNY、USD、EUR 多币种记录；原价按币种展示，人民币年化金额使用每月缓存的参考汇率估算
- 自动续费状态、提前提醒天数、支付渠道、登录设备与发票台账
- 发票与报销合并展示，报销进度使用自由备注记录，不强制标准化模板
- 标签设置：默认仅保留主力、常用、弃用，可新增、重命名、换色或删除
- JSON 导入/导出，方便迁移和离线备份
- 单用户密码登录、HttpOnly 服务端会话与 VPS SQLite 跨设备同步
- Web 智能文本录入：自然语言先生成草稿，人工确认后再写入
- 模型 BYOK 设置：登录后新增或替换模型 Key，AES-256-GCM 加密且永不回显
- 响应式布局与 Web App Manifest，为后续安卓封装预留入口
- OpenClaw 私有接入 Gateway、独立大模型语义闸机、确定性策略校验与一次性确认流程

## 数据与隐私

订阅、标签、草稿和审计记录统一保存在 VPS Gateway 的 SQLite 数据库中。浏览器 `localStorage` 仅用于从旧版进行一次迁移，不再是权威数据源。大模型会接收用于解析的自然语言，但 Gateway 不把原文写入数据库，只保留 SHA-256、状态和结构化结果。BYOK 模型 Key 经过 AES-256-GCM 加密后存入独立设置表，解密主密钥必须单独保存在 VPS 环境变量或 Docker Secret 中。

第一版的“发票”包含开票状态、发票号码与文件链接。实际文件上传将在 VPS 后端阶段加入，避免在浏览器本地塞入大文件。

## 本地运行

需要 Node.js 22+ 与 pnpm。

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。

## 构建

```bash
pnpm build
pnpm start
```

## Docker / VPS 起步

仓库包含 `Dockerfile` 与 `docker-compose.yml`：

```bash
docker compose up -d --build
```

部署前必须在未提交到 Git 的 `.env` 中设置一个 Base64 编码的 32 字节 `APIHUB_SECRETS_MASTER_KEY`；生成与备份方法见 [模型 BYOK 设置](docs/byok-model-settings.md)。

容器默认监听 `3000` 端口。生产环境建议在前面配置 Caddy 或 Nginx，并启用 HTTPS。

## 后续路线

1. 发票文件存储：当前仅记录状态、号码和 HTTPS 文件链接。
2. 提醒服务：邮件、Telegram 或 Web Push 到期提醒。
3. 审计与预算：价格变更历史、团队成本中心、报销状态、年度预算。
4. Android：用 Capacitor 或原生壳封装，复用 Gateway；语音由 Android 系统或输入法转为文字。

## OpenClaw 与大模型闸机

项目已经包含一个独立的 `gateway/` 服务，以及只向 OpenClaw 暴露单一提交工具的私有插件。模型只能生成候选 JSON，正式写入必须同时通过确定性策略和所有者一次性确认。

- [双闸机架构](docs/openclaw-apihub-architecture.md)
- [OpenClaw Agent API](docs/openclaw-agent-api.md)
- [大模型语义闸机](docs/llm-semantic-gate.md)
- [VPS 与 OpenClaw 部署](docs/vps-openclaw-deployment.md)
- [输入渠道与 Web 智能录入](docs/input-channels-and-web-intake.md)
- [模型 BYOK 设置与密钥边界](docs/byok-model-settings.md)
- [汇率每月刷新、缓存与降级](docs/exchange-rate-cache.md)

Web UI 与 OpenClaw 现已使用同一个 Gateway SQLite。浏览器通过同源会话代理访问 Web API，Gateway 的 8787 端口不应暴露到公网。

## 安全约束

- 永远不要在名称、备注、渠道、发票链接、智能录入文本等订阅字段中粘贴 API Key 或 Token；模型 Key 只能从登录后的“模型设置”页提交。
- 模型 Key 永不回显、永不写入审计日志；SQLite 与主密钥备份必须分开保存。
- 支付渠道只记录描述与尾号，不记录完整银行卡号或验证码。
- 公网部署必须启用 HTTPS、强站点密码、随机会话密钥、SQLite 备份和访问控制。

## 推送记录

| 时间（GMT+8） | 来源 | 内容 |
| --- | --- | --- |
| 2026-08-27 15:54 | vpsqh（lhins-i3thwkg9） | 品牌名统一：全站 "API Hub" → "apiHUB"（`app/layout.tsx`、`app/page.tsx`、`public/manifest.webmanifest`）；移动端底部 "＋" 按钮改为聚焦智能录入（原为打开新建表单）。与 VPS 线上运行版本对齐。 |
