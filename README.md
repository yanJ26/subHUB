# subHUB

subHUB 是一个私有的个人数字服务、使用权益与基础设施控制台。它把大模型官方订阅、按量 API、Token Plan、Agent 工具、域名、设备、VPS、部署实例和访问入口放进同一套关系模型，但费用、资产与凭据仍保持清晰边界。

## 产品原则

- **权益是费用真相**：同一项订阅可以供多个 Agent、应用、API 入口或设备使用，成本只计算一次。
- **服务与资产分开**：Cloudflare、注册商或 WorkBuddy 是外部产品；`subhub.example.com`、电脑和 VPS 是所有者控制的资产。
- **生命周期分开**：续费、到期和额度重置分别记录，避免用一个日期表达三种含义。
- **来源可追溯**：apiHUB、agentHUB、buddyHUB 只作为只读迁移来源，每条迁移记录保留来源 ID 和内容哈希。
- **密钥隔离**：业务数据只保存凭据标签，不接受或保存真实 Key、Token、密码与 Cookie。
- **近似但诚实**：用量快照和效率评价允许缺失及低置信度，不制造精确 Token 会计。

## 当前能力

- apiHUB 式自然语言录入：随意描述一项订阅，系统整理为可核对草稿，确认后一次创建或复用厂商、目录、权益和可选发票。
- 加密模型 BYOK：登录后可在设置页配置 OpenAI-compatible 模型；Key 以 AES-256-GCM 加密保存且永不回显。
- 手工一步式表单仍作为模型未配置或需要精确修订时的后备入口。
- 产品与服务目录，多角色、采用状态和模型/能力清单。
- 订阅、按量、Token 包、试用、自托管、套餐内含及一次性权益。
- 多币种价格、人民币月度等价、续费/到期雷达和 ECB 参考汇率缓存。
- 发票号码、状态、链接、购买渠道、提醒天数和标签。
- 域名、设备、服务器、账号、仓库、网站和工作流资产。
- Agent/服务部署实例、运行节点、版本、模型、Runtime 和安装方式。
- Web、移动端、桌面端、CLI、API、Bot、消息及工作流入口。
- 额度规则、不定期快照、定性效率评价与重要工作记录。
- Owner 登录、持久原子限速、Gateway 私有网络、SQLite WAL、乐观修订号、审计查看与安全导出。
- apiHUB / agentHUB / buddyHUB 三源增量迁移预览、逐项冲突决策、内容摘要绑定与来源映射。
- 目录、权益/发票、资产、部署、入口、使用关系、额度规则、快照、评价和工作记录的手工维护。
- 手工维护与三源迁移是当前信息入口；自动采集、消息入口和第三方适配器留待后续单独设计。

## 日常录入

首页“一句话录入订阅”是默认入口，不要求按表单格式组织内容。例如：

> 我订阅了 Qoder Pro，每月 20 美元，10 月 18 日自动续费，11 月 18 日权益到期，提前 7 天提醒，官网信用卡购买。

模型只把这段话整理成固定结构，普通代码会再次检查日期、金额、枚举、标签、重复项和敏感内容。页面先显示草稿，只有 Owner 点击“确认写入”后才会在一个数据库事务中创建或复用目录关系并写入权益及可选发票。原始自然语言不进入数据库，只保留 SHA-256 摘要。

“使用权益”页仍保留手工一步式表单。资产、部署、入口、额度和评价属于可选关系，不是添加普通订阅的前置步骤。自然语言录入当前仅来自登录后的 Web 页面，与 OpenClaw 无关，也不依赖 OpenClaw。

## 领域关系

```text
Provider
  └─ CatalogItem / Offering
       ├─ Models & Capabilities
       ├─ Entitlements ── Invoices / Renewal / Expiry / Quota
       └─ AccessSurfaces

Assets (Domain / Device / Server / Account / Website)
  └─ Deployments ── CatalogItem

UsageLinks connect Entitlement, AccessSurface, Asset, Deployment and consumer Item.
```

## 技术架构

- Web：React 19 + vinext。
- Gateway：Node.js 24 原生 HTTP 服务，通过私有 Bearer 通道为 Web 提供数据访问。
- 数据：SQLite WAL，采用版本化 SQL migration 和规范化关系表。
- 安全：12 小时 Owner 会话、登录限速、2 MB 导入限制、敏感字段扫描、修订冲突控制与审计日志。

## 本地开发

需要 Node.js 24 和 pnpm 11：

```bash
pnpm install
pnpm dev
```

未配置 Owner 密码时，Web 显示明确标记的预览数据，不写入数据库。完整本机服务需要分别启动 Gateway 和 Web，并使两者使用同一个 `SUBHUB_WEB_INTERNAL_TOKEN`。要从网页安全保存自然语言模型 Key，还需配置独立的 `SUBHUB_SECRETS_MASTER_KEY`。

```powershell
pwsh gateway/scripts/start-local.ps1
pwsh scripts/start-web-local.ps1
```

## 验证

```bash
pnpm test
pnpm lint
```

测试覆盖运行时数据契约、事务回滚、迁移幂等与冲突处理、敏感信息扫描、并发登录限速、Web 会话/Origin/请求体边界、成本和生命周期口径、业务备份恢复、页面构建与渲染。

## Docker / VPS

复制 `.env.example` 为未纳入 Git 的 `.env`，生成唯一的 Owner 密码、会话 Secret 和内部 Token，然后：

```bash
docker compose up -d --build
```

- Web：宿主机 `3003`
- Gateway：宿主机回环 `127.0.0.1:8790`
- 推荐反向代理路径：`/code/subhub`
- SQLite：Docker 命名卷 `subhub-data`

Gateway 不应直接暴露到公网。

Compose 默认把 Web 和 Gateway 都绑定到宿主机回环地址。生产环境必须将 SUBHUB_PUBLIC_ORIGIN 设置为浏览器实际访问的 HTTPS Origin（例如 https://subhub.example.com，不含路径）。默认使用全局 Owner 登录限速；只有反向代理会覆盖而不是追加客户端 IP 头时，才可启用 SUBHUB_TRUST_PROXY_HEADERS=true。

## 备份与恢复

设置页的“业务 JSON”适合迁移与人工恢复，包含同一修订版的业务实体和来源映射，不包含密码、内部 Token、审计日志或登录限速状态。恢复必须先预检，提交时再次校验文件摘要和目标修订号。

完整 SQLite 备份包含 schema、审计与汇率缓存，使用 Node 内置 SQLite 在线备份 API，可在 Gateway 运行时执行：

    docker compose exec subhub-gateway node scripts/backup.mjs /backups

完整恢复必须先停止 Web 与 Gateway，再从备份卷运行恢复工具；工具会验证来源、创建恢复前安全副本、替换数据库并再次做完整性与外键检查：

    docker compose stop subhub subhub-gateway
    docker compose run --rm subhub-gateway node scripts/restore.mjs /backups/subhub-YYYY-MM-DD.sqlite
    docker compose up -d

备份默认保留最近 14 份，可用 SUBHUB_BACKUP_RETENTION 调整。命名卷不能代替异机备份，应另外将备份文件同步到受控存储。完整操作与反向代理要求见 [运维手册](docs/operations.md)。

当前里程碑不接入任何外部自动信息来源。Web 自然语言录入只处理 Owner 主动提交的文本；未来若增加消息或其他入口，将作为独立适配层建设，不改变核心领域模型，也不能绕过 Gateway 的认证、校验、草稿确认与审计边界。

自然语言录入和模型密钥边界见 [`docs/natural-language-intake.md`](docs/natural-language-intake.md) 与 [`docs/model-byok.md`](docs/model-byok.md)。

## 三个旧项目

subHUB 以 apiHUB 的工程基线开始建设，同时参考另外两个项目。三个仓库保持独立，不删除、不覆盖，也不作为 subHUB 的运行时依赖：

| 来源 | 基线 | 在 subHUB 中的主要作用 |
| --- | --- | --- |
| `yanJ26/apiHUB` | `9cb7653` | 安全、会话、账务、汇率、发票、标签与 Gateway 基石 |
| `yanJ26/agentHUB` | `8a4ed37` | Agent、设备、部署、入口、重要任务与活跃度模型 |
| `yanJ26/buddyHUB` | `5803521` | 权益优先目录、额度快照、评价和迁移预览理念 |

迁移时优先采用 apiHUB 的费用与发票字段、agentHUB 的运行拓扑字段；buddyHUB 中的非重复快照和评价按来源导入。真实 Key、Token、密码和 Cookie 永不迁移。

更多设计决策见 [`docs/adr/0001-subhub-foundation.md`](docs/adr/0001-subhub-foundation.md)、[`docs/domain-model.md`](docs/domain-model.md) 和 [`docs/migration/legacy-sources.md`](docs/migration/legacy-sources.md)。
