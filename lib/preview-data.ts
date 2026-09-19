import type { WorkspaceState } from "./domain";

// Public preview data is entirely fictional and exists only to demonstrate the UI.
// It does not describe the repository owner's subscriptions, assets, usage, or dates.
export const previewState: WorkspaceState = {
  providers: [
    { id: "provider_openai", name: "OpenAI", website: "https://openai.com" },
    { id: "provider_xai", name: "xAI" },
    { id: "provider_moonshot", name: "Moonshot AI" },
    { id: "provider_minimax", name: "MiniMax" },
    { id: "provider_zhipu", name: "智谱 AI" },
    { id: "provider_doubao", name: "豆包" },
    { id: "provider_workbuddy", name: "WorkBuddy" },
    { id: "provider_koda", name: "Koda" },
    { id: "provider_anthropic", name: "Anthropic" },
    { id: "provider_cloudflare", name: "Cloudflare", website: "https://cloudflare.com" },
    { id: "provider_registrar", name: "域名注册商" },
  ],
  catalog: [
    { id: "item_codex", providerId: "provider_openai", name: "Codex", description: "编程与仓库级协作入口", roles: ["agent", "code", "app"], models: ["GPT 系列"], adoptionStatus: "active", lastReviewedAt: "2030-01-20" },
    { id: "item_openai_api", providerId: "provider_openai", name: "OpenAI API", description: "按量 API 与模型能力入口", roles: ["api", "model", "platform"], models: ["GPT 系列"], adoptionStatus: "considering", lastReviewedAt: "2030-01-20" },
    { id: "item_grok", providerId: "provider_xai", name: "Grok", description: "聊天、Agent 与模型服务", roles: ["chat", "agent", "app"], models: ["Grok 系列"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_kimi", providerId: "provider_moonshot", name: "Kimi", description: "聊天与模型应用", roles: ["chat", "app", "model"], models: ["Kimi 系列"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_kimi_code", providerId: "provider_moonshot", name: "Kimi Code", description: "编程 Agent 与代码入口", roles: ["agent", "code"], models: ["Kimi 系列"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_minimax_api", providerId: "provider_minimax", name: "MiniMax API / Token Plan", description: "API、Token Plan 与模型能力", roles: ["api", "model", "platform"], models: ["MiniMax 系列"], adoptionStatus: "active", lastReviewedAt: "2030-01-20" },
    { id: "item_m_code", providerId: "provider_minimax", name: "M Code", description: "编程 Agent 入口", roles: ["agent", "code"], models: ["MiniMax 系列"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_glm_api", providerId: "provider_zhipu", name: "GLM API", description: "模型 API 与平台能力", roles: ["api", "model", "platform"], models: ["GLM 系列"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_z_code", providerId: "provider_zhipu", name: "Z Code", description: "编程 Agent 入口", roles: ["agent", "code"], models: ["GLM 系列"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_doubao", providerId: "provider_doubao", name: "豆包", description: "聊天与 Agent 应用入口", roles: ["chat", "agent", "app"], models: ["豆包模型"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_doubao_api", providerId: "provider_doubao", name: "豆包 API", description: "模型 API 与平台能力", roles: ["api", "model", "platform"], models: ["豆包模型"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_workbuddy", providerId: "provider_workbuddy", name: "WorkBuddy", description: "办公工作流与 Agent 应用", roles: ["agent", "app", "automation"], models: [], adoptionStatus: "active", lastReviewedAt: "2030-01-20" },
    { id: "item_koda", providerId: "provider_koda", name: "Koda", description: "AI 应用与 Agent 入口", roles: ["agent", "app"], models: [], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_claude_code", providerId: "provider_anthropic", name: "Claude Code", description: "编程 Agent 与 CLI 入口", roles: ["agent", "code"], models: ["Claude 系列"], adoptionStatus: "unused", lastReviewedAt: "2030-01-20" },
    { id: "item_domain_registration", providerId: "provider_registrar", name: "域名注册服务", description: "域名所有权、续费和注册商关系", roles: ["domain", "platform"], models: [], adoptionStatus: "active", lastReviewedAt: "2030-01-20" },
    { id: "item_cloudflare", providerId: "provider_cloudflare", name: "Cloudflare", description: "DNS、证书和边缘网络服务", roles: ["domain", "cloud", "security"], models: [], adoptionStatus: "active", lastReviewedAt: "2030-01-20" },
  ],
  entitlements: [
    { id: "ent_codex", itemId: "item_codex", label: "ChatGPT 方案（演示）", billingMode: "subscription", amount: 20, currency: "USD", billingCycle: "monthly", renewsAt: "2030-02-01", autoRenew: true, notes: "虚构预览数据：同一权益可覆盖多个使用入口。" },
    { id: "ent_minimax", itemId: "item_minimax_api", label: "Token Plan（演示）", billingMode: "token_pack", amount: null, currency: "CNY", billingCycle: "none", expiresAt: "2030-03-01", autoRenew: false, credentialLabel: "示例 API 标签（不保存 Key）" },
    { id: "ent_example_domain", itemId: "item_domain_registration", label: "example.net 注册权益（演示）", billingMode: "subscription", amount: null, currency: "USD", billingCycle: "yearly", expiresAt: "2030-12-31", autoRenew: true, reminderDays: 30, tags: ["基础设施"], notes: "虚构预览数据。" },
  ],
  invoices: [
    { id: "invoice_codex", entitlementId: "ent_codex", status: "pending" },
  ],
  tagDefinitions: [
    { id: "tag_primary", name: "主力", background: "#e7f6ef", color: "#167351", sortOrder: 0 },
    { id: "tag_infra", name: "基础设施", background: "#eaf1ff", color: "#315faa", sortOrder: 1 },
  ],
  assets: [
    { id: "asset_example_domain", kind: "domain", name: "example.net（演示）", domainName: "example.net", status: "active", providerId: "provider_registrar", itemId: "item_domain_registration", registrar: "示例注册商", expiresAt: "2030-12-31", autoRenew: true, notes: "虚构域名资产，用于演示 DNS、证书和站点关联。" },
    { id: "asset_dev_pc", kind: "device", name: "开发电脑", status: "active", deviceType: "laptop", os: "Windows", location: "本地" },
    { id: "asset_vps", kind: "server", name: "主力 VPS", status: "active", deviceType: "vps", os: "Linux", location: "云端" },
  ],
  deployments: [],
  accessSurfaces: [
    { id: "surface_codex_desktop", itemId: "item_codex", name: "Codex Desktop", kind: "desktop", device: "Windows" },
    { id: "surface_codex_cli", itemId: "item_codex", name: "Codex CLI", kind: "cli", device: "开发电脑" },
    { id: "surface_minimax_api", itemId: "item_minimax_api", name: "MiniMax API", kind: "api" },
    { id: "surface_workbuddy_web", itemId: "item_workbuddy", name: "WorkBuddy Web", kind: "web" },
  ],
  usageLinks: [
    { id: "link_codex_desktop", entitlementId: "ent_codex", accessSurfaceId: "surface_codex_desktop", label: "桌面开发" },
    { id: "link_codex_cli", entitlementId: "ent_codex", accessSurfaceId: "surface_codex_cli", label: "CLI 开发" },
  ],
  quotaPolicies: [
    { id: "quota_codex_rolling", entitlementId: "ent_codex", label: "短周期使用窗口", metric: "percentage", windowType: "rolling_window", windowHours: 5, notes: "实际规则待快照确认，不直接换算月度 Token。" },
    { id: "quota_minimax_balance", entitlementId: "ent_minimax", label: "Token Plan 余额", metric: "credits", windowType: "balance", notes: "只用于判断消耗速度与预计耗尽时间。" },
  ],
  snapshots: [
    { id: "snap_codex_1", entitlementId: "ent_codex", quotaPolicyId: "quota_codex_rolling", observedAt: "2030-01-05T12:00:00.000Z", utilizationPercent: 35, sourceLabel: "虚构演示快照", evidenceName: "example-usage-1.png" },
    { id: "snap_codex_2", entitlementId: "ent_codex", quotaPolicyId: "quota_codex_rolling", observedAt: "2030-01-20T12:00:00.000Z", utilizationPercent: 50, sourceLabel: "虚构演示快照", evidenceName: "example-usage-2.png" },
    { id: "snap_minimax_1", entitlementId: "ent_minimax", quotaPolicyId: "quota_minimax_balance", observedAt: "2030-01-05T12:00:00.000Z", remainingValue: 900, sourceLabel: "虚构演示快照" },
    { id: "snap_minimax_2", entitlementId: "ent_minimax", quotaPolicyId: "quota_minimax_balance", observedAt: "2030-01-20T12:00:00.000Z", remainingValue: 750, sourceLabel: "虚构演示快照" },
  ],
  evaluations: [
    { id: "eval_codex", itemId: "item_codex", evaluatedAt: "2030-01-20", utilization: "normal", outputValue: "good", quotaPressure: "normal", trend: "stable", recommendation: "continue", confidence: "low", evidenceCount: 2, observationDays: 15, note: "虚构评价，仅用于演示。" },
    { id: "eval_minimax", itemId: "item_minimax_api", evaluatedAt: "2030-01-20", utilization: "normal", outputValue: "good", quotaPressure: "low", trend: "stable", recommendation: "continue", confidence: "low", evidenceCount: 2, observationDays: 15 },
    { id: "eval_workbuddy", itemId: "item_workbuddy", evaluatedAt: "2030-01-20", utilization: "low", outputValue: "fair", quotaPressure: "none", trend: "stable", recommendation: "observe", confidence: "low", evidenceCount: 1, observationDays: 15 },
  ],
  workRecords: [
    { id: "work_subhub", itemId: "item_codex", title: "演示：启动统一项目", occurredAt: "2030-01-20", note: "虚构工作记录，用于展示订阅、API、Agent 与数字资产的统一模型。", sourceLabel: "虚构预览数据" },
  ],
  legacyRefs: [],
};
