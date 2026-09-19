# subHUB

> [!NOTE]
> subHUB 由 [apiHUB-DC](https://github.com/yanJ26/apiHUB-DC)、[agentHUB-DC](https://github.com/yanJ26/agentHUB-DC) 和 [buddyHUB-DC](https://github.com/yanJ26/buddyHUB-DC) 三个个人项目演进整合而来。名称中的 `DC` 表示 Discontinued。三个旧项目已于 **2026 年 9 月 19 日**停止维护并转为私有归档；subHUB 是后续唯一维护的统一项目。

subHUB 是一个自托管的个人服务、订阅与数字资产工具。它用三个页面管理大模型官方订阅、API、Agent 工具、域名、设备、服务器、账号、代码仓库和网站：**总览、服务、资产**。

本仓库公开的是应用代码、文档与虚构示例数据，不包含真实 API Key、Token、密码、Cookie、模型密钥、生产数据库或个人订阅记录。部署者必须自行生成密钥，并通过未纳入 Git 的环境变量或 Secret 管理设施保存。

## 产品原则

- **一句话优先**：自由描述服务或订阅，不要求先理解厂商、目录、权益和发票之间的内部关系。
- **三层概念分开**：Codex、Qoder、Kimi 是服务；付费、试用、免费方案或按量关系是订阅记录；示例域名、电脑和 VPS 是自己控制的资产。
- **单一日期**：日常用「到期 / 下次续费」一个日期表达本期结束与下次扣款；底层仍保留续费/到期两列以兼容分期等旧数据，但界面统一显示。
- **来源可追溯**：apiHUB-DC、agentHUB-DC、buddyHUB-DC 只作为只读迁移来源，每条迁移记录保留来源 ID 和内容哈希。
- **密钥隔离**：业务数据只保存凭据标签，不接受或保存真实 Key、Token、密码与 Cookie。
- **兼容但不打扰**：旧版关系字段继续保留以保护已有数据，但不再作为日常操作步骤展示。

## 当前能力

- apiHUB-DC 式自然语言录入：可以只记录未订阅服务，也可以新增或修改订阅；系统整理为可核对草稿后再写入。
- 加密模型 BYOK：首页录入框中的“模型设置”可配置 OpenAI-compatible 模型；Key 以 AES-256-GCM 加密保存且永不回显。
- 手工一步式表单作为模型未配置或需要精确修订时的后备入口。
- 订阅、按量、Token 包、试用、自托管、套餐内含和一次性购买。
- 多币种价格、人民币月度等价、续费/到期雷达和 ECB 参考汇率缓存。
- 发票号码、状态、链接、购买渠道、提醒天数和标签。
- 域名、设备、服务器、账号、仓库、网站和工作流资产。
- Owner 登录、持久原子限速、Gateway 私有网络、SQLite WAL、乐观修订号和安全审计。
- apiHUB-DC / agentHUB-DC / buddyHUB-DC 三源增量迁移预览、逐项冲突决策、内容摘要绑定与来源映射。

部署、入口、使用关系、额度、快照、效率评价与工作记录属于历史兼容数据，不再出现在日常界面。当前也不接入自动采集、消息入口或第三方信息来源。

## 日常录入

首页“一句话记录服务和订阅”是默认入口，不要求按表单格式组织内容。例如：

> 把 Kimi 列进来，我没有订阅，只是偶尔使用。

这只会建立 Kimi 服务，不会制造免费订阅、金额或续费日期。明确存在商业关系时可以这样输入：

> 我订阅了 Qoder Pro，每月 20 美元，下次续费/到期是 10 月 18 日，自动续费，提前 7 天提醒，官网信用卡购买。

模型只把输入整理成固定结构，普通代码会再次检查意图、日期、金额、枚举、标签、重复项和敏感内容。页面先显示草稿，只有 Owner 点击“确认写入”后才会在一个数据库事务中保存服务或完整订阅。原始自然语言不进入数据库，只保留 SHA-256 摘要。

“服务”页统一展示已订阅、试用、免费、按量、已购买和未订阅服务；服务类型与商业状态分别记录。手工表单只是后备入口。自然语言录入当前仅来自登录后的 Web 页面，与 OpenClaw 无关，也不依赖 OpenClaw。

## 内部数据兼容

```text
一句话录入
  ├─ 未订阅服务（只创建服务）
  └─ 有商业关系（服务 + 订阅 + 可选发票）

资产
  └─ 域名 / 设备 / 服务器 / 账号 / 仓库 / 网站

旧版关系字段继续保留在数据库和导入协议中，但不暴露为日常操作路径。
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

业务 JSON 接口继续用于迁移与人工恢复，包含同一修订版的业务实体和来源映射，不包含密码、内部 Token、审计日志或登录限速状态。为保持个人界面简洁，它不再提供日常页面入口；需要时按运维手册调用并先完成恢复预检。

完整 SQLite 备份包含 schema、审计与汇率缓存，使用 Node 内置 SQLite 在线备份 API，可在 Gateway 运行时执行：

    docker compose exec subhub-gateway node scripts/backup.mjs /backups

完整恢复必须先停止 Web 与 Gateway，再从备份卷运行恢复工具；工具会验证来源、创建恢复前安全副本、替换数据库并再次做完整性与外键检查：

    docker compose stop subhub subhub-gateway
    docker compose run --rm subhub-gateway node scripts/restore.mjs /backups/subhub-YYYY-MM-DD.sqlite
    docker compose up -d

备份默认保留最近 14 份，可用 SUBHUB_BACKUP_RETENTION 调整。命名卷不能代替异机备份，应另外将备份文件同步到受控存储。完整操作与反向代理要求见 [运维手册](docs/operations.md)。

当前里程碑不接入任何外部自动信息来源。Web 自然语言录入只处理 Owner 主动提交的文本；未来若增加消息或其他入口，将作为独立适配层建设，不改变核心领域模型，也不能绕过 Gateway 的认证、校验、草稿确认与审计边界。

自然语言录入和模型密钥边界见 [`docs/natural-language-intake.md`](docs/natural-language-intake.md) 与 [`docs/model-byok.md`](docs/model-byok.md)。

## 项目沿革与三个旧项目

subHUB 以 apiHUB-DC 的工程基线开始建设，并吸收 agentHUB-DC 与 buddyHUB-DC 中适合统一产品的设计。三个旧仓库现作为私有历史归档，不作为 subHUB 的运行时依赖：

| 来源 | 基线 | 在 subHUB 中的主要作用 |
| --- | --- | --- |
| `yanJ26/apiHUB-DC` | `9cb7653` | 安全、会话、账务、汇率、发票、标签与 Gateway 基石 |
| `yanJ26/agentHUB-DC` | `8a4ed37` | Agent、设备、部署、入口、重要任务与活跃度模型 |
| `yanJ26/buddyHUB-DC` | `5803521` | 权益优先目录、额度快照、评价和迁移预览理念 |

迁移时优先采用 apiHUB-DC 的费用与发票字段、agentHUB-DC 的运行拓扑字段；buddyHUB-DC 中的非重复快照和评价按来源导入。真实 Key、Token、密码和 Cookie 永不迁移。

更多设计决策见 [`docs/adr/0001-subhub-foundation.md`](docs/adr/0001-subhub-foundation.md)、[`docs/domain-model.md`](docs/domain-model.md) 和 [`docs/migration/legacy-sources.md`](docs/migration/legacy-sources.md)。
