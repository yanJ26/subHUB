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

- 产品与服务目录，多角色、采用状态和模型/能力清单。
- 订阅、按量、Token 包、试用、自托管、套餐内含及一次性权益。
- 多币种价格、人民币月度等价、续费/到期雷达和 ECB 参考汇率缓存。
- 发票号码、状态、链接、购买渠道、提醒天数和标签。
- 域名、设备、服务器、账号、仓库、网站和工作流资产。
- Agent/服务部署实例、运行节点、版本、模型、Runtime 和安装方式。
- Web、移动端、桌面端、CLI、API、Bot、消息及工作流入口。
- 额度规则、不定期快照、定性效率评价与重要工作记录。
- Owner 登录、Gateway 私有网络、SQLite WAL、乐观修订号、审计与安全导出。
- apiHUB / agentHUB / buddyHUB 三源迁移预览、冲突确认与来源映射。
- 手工维护与三源迁移是当前信息入口；自动采集、消息入口和第三方适配器留待后续单独设计。

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

未配置 Owner 密码时，Web 显示明确标记的预览数据，不写入数据库。完整本机服务需要分别启动 Gateway 和 Web，并使两者使用同一个 `SUBHUB_WEB_INTERNAL_TOKEN`。

```powershell
pwsh gateway/scripts/start-local.ps1
pwsh scripts/start-web-local.ps1
```

## 验证

```bash
pnpm test
pnpm lint
```

测试覆盖规范化存储、迁移字段保留和 ID 重映射、冲突阻断、敏感信息扫描、HTTP 认证边界、页面构建与渲染。

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

当前里程碑不接入任何自动信息来源。未来若增加消息、网页或其他外部入口，将作为独立适配层建设，不改变核心领域模型，也不能绕过 Gateway 的认证、校验与审计边界。

## 三个旧项目

subHUB 以 apiHUB 的工程基线开始建设，同时参考另外两个项目。三个仓库保持独立，不删除、不覆盖，也不作为 subHUB 的运行时依赖：

| 来源 | 基线 | 在 subHUB 中的主要作用 |
| --- | --- | --- |
| `yanJ26/apiHUB` | `9cb7653` | 安全、会话、账务、汇率、发票、标签与 Gateway 基石 |
| `yanJ26/agentHUB` | `8a4ed37` | Agent、设备、部署、入口、重要任务与活跃度模型 |
| `yanJ26/buddyHUB` | `5803521` | 权益优先目录、额度快照、评价和迁移预览理念 |

迁移时优先采用 apiHUB 的费用与发票字段、agentHUB 的运行拓扑字段；buddyHUB 中的非重复快照和评价按来源导入。真实 Key、Token、密码和 Cookie 永不迁移。

更多设计决策见 [`docs/adr/0001-subhub-foundation.md`](docs/adr/0001-subhub-foundation.md)、[`docs/domain-model.md`](docs/domain-model.md) 和 [`docs/migration/legacy-sources.md`](docs/migration/legacy-sources.md)。
