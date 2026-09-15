# ADR 0001：subHUB 基石与统一边界

状态：已接受

日期：2026-09-14

## 决策

subHUB 是全新的私有仓库和部署单元。它以 apiHUB `9cb7653` 的工程实现为技术基石，但不会把 apiHUB、agentHUB、buddyHUB 的 Git 历史或运行数据库机械合并。三个旧仓库继续保持独立。

系统采用一个 Web、一个 Gateway 和一个 SQLite 数据库的模块化单体。API、Agent、应用、域名和托管服务是目录项目的可组合角色，不是平行子系统。

## 关键边界

1. `CatalogItem` 表示外部产品或服务。
2. `Entitlement` 表示购买、试用、按量或自托管后获得的权利，是费用和生命周期的唯一真相。
3. `Asset` 表示所有者实际控制的域名、设备、服务器、账号、仓库或网站。
4. `Deployment` 表示产品或 Agent 在某项资产上的运行实例。
5. `AccessSurface` 表示 Web、App、API、CLI、Bot 或消息入口。
6. `UsageLink` 只建立消费关系，不重复费用。
7. 凭据不属于任何业务实体；subHUB 只保存凭据标签，不接收真实 Key、Token、密码或 Cookie。

## 为什么不直接使用 buddyHUB

buddyHUB 已验证了“权益优先”的方向，但现有迁移会遗漏 apiHUB 的发票、标签和提醒字段，也会压平 agentHUB 的部分设备、部署与入口信息；固定 AI 角色也无法表达域名等资产。因此它作为产品设计来源，而不是代码基线。

## 后果

- 新模型能同时表达 ChatGPT 官方订阅、OpenAI API、无订阅的 WorkBuddy Agent 记录和 `subhub.example.com` 域名。
- 迁移需要显式预览和人工冲突确认。
- 旧项目可以随时独立恢复和核对。
