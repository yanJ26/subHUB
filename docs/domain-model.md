# 内部兼容领域模型

> 本文描述数据库和迁移协议，而不是日常页面的信息架构。用户界面只提供总览、订阅和资产；Provider、CatalogItem、Entitlement 等关系由系统自动处理。部署、入口、使用关系、额度、快照和评价目前只为既有数据兼容保留。

## 主要实体

### Provider

数字产品、基础设施或 AI 服务供应商。供应商本身不区分“API 厂商”“Agent 厂商”或“域名厂商”。

### CatalogItem

市场目录中的产品、服务或工具。一个项目可以同时拥有多个角色，例如：

- model
- api
- agent
- code
- chat
- bot
- app
- automation
- platform
- domain
- hosting
- cloud
- storage
- developer_tool
- security

### Adoption

所有者与目录项目的关系：

- active
- trial
- considering
- unused
- paused
- retired

目录缺失表示“系统尚不知道”；`unused` 表示“已知但当前不用”。

### Entitlement

购买、试用或自托管后取得的使用权益，是费用与到期时间的唯一真相。计费方式包括订阅、Token 包、按量、免费、试用、自托管和混合方式。

### Capability / Model

权益或产品提供的模型与能力。不要求穷举供应商所有动态模型，可记录对实际决策有用的集合。

### AccessSurface

Web、移动 App、桌面端、CLI、API、Bot、消息渠道或其他可使用入口。

### Asset

所有者实际控制的域名、设备、服务器、账号、仓库、网站或工作流。外部产品与自有资产分开建模。

### Deployment

产品或 Agent 在设备、VPS、NAS 或厂商云节点上的运行实例，保留版本、模型、Runtime 与安装方式。

### UsageLink

描述“哪项权益通过什么入口被哪个产品、Agent、设备或工作流使用”。同一权益可被多个入口共享，费用只计算一次。

### QuotaPolicy

平台额度规则。支持自然月、账单周期、固定窗口、滚动窗口、总量余额、长期累计和按量计费；一项权益可以同时拥有多层规则。

### Snapshot

不定期采集的网页证据或人工观察。原始值与推算结果分离，支持累计用量、剩余额度、窗口利用率、费用、活跃度和人工评价。

### Evaluation

面向决策的定性结果：使用程度、产出价值、额度压力、稳定性、趋势、可信度和建议动作。

## 关键关系

```text
Provider
  └─ CatalogItem [many roles]
       ├─ Models / Capabilities
       ├─ AccessSurfaces
       ├─ Adoption
       └─ Entitlements
            ├─ QuotaPolicies
            ├─ Snapshots → Evaluations
            └─ UsageLinks → Item / Agent / Device / Workflow

Assets → Deployments → CatalogItem
```

## 旧项目迁移原则

- apiHUB subscription → CatalogItem + Entitlement + renewal/invoice metadata
- agentHUB Agent → CatalogItem(role=agent) + deployment/access relationships
- agentHUB embedded subscription → entitlement candidate，必须与 apiHUB 记录去重
- 无法唯一匹配时只生成迁移候选，不自动覆盖
- 真实 API Key 永不迁移；只迁移无敏感信息的标签和用途

## 旧仓库边界

apiHUB、agentHUB 和 buddyHUB 始终是独立的只读参考来源。本里程碑不删除、不覆盖、不提交任何修改，也不把它们作为 subHUB 的运行时依赖。未来若要在旧仓库添加迁移说明，必须由所有者另行决定和授权。
