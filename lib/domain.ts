export type ItemRole =
  | "model"
  | "api"
  | "agent"
  | "code"
  | "chat"
  | "bot"
  | "app"
  | "automation"
  | "platform"
  | "domain"
  | "hosting"
  | "cloud"
  | "storage"
  | "developer_tool"
  | "communication"
  | "security"
  | "other";
export type AdoptionStatus = "active" | "trial" | "considering" | "unused" | "paused" | "retired";
export type BillingMode = "subscription" | "token_pack" | "pay_as_you_go" | "free" | "trial" | "self_hosted" | "hybrid" | "bundled" | "one_time";
export type Currency = "CNY" | "USD" | "EUR" | "HKD" | "GBP" | "JPY";
export type QuotaWindowType = "calendar_month" | "billing_cycle" | "fixed_window" | "rolling_window" | "balance" | "lifetime" | "metered";
export type EvaluationLevel = "none" | "low" | "normal" | "high" | "constrained";
export type ValueLevel = "unknown" | "low" | "fair" | "good" | "core";
export type Confidence = "low" | "medium" | "high";
export type Recommendation = "continue" | "observe" | "upgrade" | "downgrade" | "pause" | "stop";
export type AssetKind = "domain" | "device" | "server" | "account" | "repository" | "website" | "workflow" | "other";
export type AssetStatus = "active" | "attention" | "offline" | "expired" | "retired" | "unknown";
export type DeploymentStatus = "online" | "degraded" | "offline" | "unknown" | "retired";
export type EntitlementStatus = "active" | "trial" | "paused" | "expired" | "cancelled";
export type InvoiceStatus = "issued" | "pending" | "none" | "paid" | "reimbursed";

export type Provider = {
  id: string;
  name: string;
  website?: string;
  notes?: string;
};

export type CatalogItem = {
  id: string;
  providerId: string;
  name: string;
  description: string;
  roles: ItemRole[];
  models: string[];
  adoptionStatus: AdoptionStatus;
  website?: string;
  lastReviewedAt?: string;
  useCases?: string[];
  notes?: string;
};

export type Entitlement = {
  id: string;
  itemId: string;
  label: string;
  billingMode: BillingMode;
  amount: number | null;
  currency: Currency;
  billingCycle: "monthly" | "yearly" | "none";
  status?: EntitlementStatus;
  startsAt?: string;
  renewsAt?: string;
  expiresAt?: string;
  resetsAt?: string;
  autoRenew: boolean;
  channel?: string;
  reminderDays?: number;
  tags?: string[];
  credentialLabel?: string;
  notes?: string;
};

export type TagDefinition = {
  id: string;
  name: string;
  background?: string;
  color?: string;
  sortOrder?: number;
};

export type Invoice = {
  id: string;
  entitlementId: string;
  status: InvoiceStatus;
  number?: string;
  url?: string;
  issuedAt?: string;
  dueAt?: string;
  amount?: number;
  currency?: Currency;
  notes?: string;
};

export type Asset = {
  id: string;
  kind: AssetKind;
  name: string;
  status: AssetStatus;
  providerId?: string;
  itemId?: string;
  description?: string;
  domainName?: string;
  registrar?: string;
  expiresAt?: string;
  autoRenew?: boolean;
  deviceType?: string;
  os?: string;
  location?: string;
  roleNote?: string;
  lastCheckedAt?: string;
  url?: string;
  notes?: string;
};

export type Deployment = {
  id: string;
  itemId: string;
  assetId: string;
  name: string;
  role: "primary" | "secondary" | "testing";
  status: DeploymentStatus;
  version?: string;
  model?: string;
  runtime?: string;
  installMethod?: string;
  notes?: string;
};

export type AccessSurface = {
  id: string;
  itemId: string;
  name: string;
  kind: "web" | "mobile" | "desktop" | "cli" | "api" | "bot" | "message" | "workflow";
  device?: string;
  assetId?: string;
  deploymentId?: string;
  account?: string;
  status?: "available" | "limited" | "offline";
  notes?: string;
};

export type UsageLink = {
  id: string;
  entitlementId: string;
  consumerItemId?: string;
  accessSurfaceId?: string;
  assetId?: string;
  deploymentId?: string;
  label: string;
  allocationPercent?: number;
};

export type QuotaPolicy = {
  id: string;
  entitlementId: string;
  label: string;
  metric: "tokens" | "credits" | "calls" | "currency" | "percentage" | "time" | "unknown";
  windowType: QuotaWindowType;
  windowHours?: number;
  limitValue?: number;
  resetTimezone?: string;
  notes?: string;
};

export type UsageSnapshot = {
  id: string;
  entitlementId: string;
  quotaPolicyId?: string;
  observedAt: string;
  periodStart?: string;
  periodEnd?: string;
  usedValue?: number;
  remainingValue?: number;
  utilizationPercent?: number;
  sourceLabel: string;
  evidenceName?: string;
  notes?: string;
};

export type Evaluation = {
  id: string;
  itemId: string;
  evaluatedAt: string;
  utilization: EvaluationLevel;
  outputValue: ValueLevel;
  quotaPressure: EvaluationLevel;
  trend: "rising" | "stable" | "falling" | "unknown";
  recommendation: Recommendation;
  confidence: Confidence;
  evidenceCount: number;
  observationDays: number;
  note?: string;
};

export type WorkRecord = {
  id: string;
  itemId: string;
  title: string;
  occurredAt: string;
  note?: string;
  sourceLabel?: string;
};

export type LegacyRef = {
  sourceSystem: "apiHUB" | "agentHUB" | "buddyHUB" | string;
  entityType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  sourceHash?: string;
  importedAt: string;
};

export type WorkspaceState = {
  providers: Provider[];
  catalog: CatalogItem[];
  entitlements: Entitlement[];
  invoices: Invoice[];
  tagDefinitions: TagDefinition[];
  assets: Asset[];
  deployments: Deployment[];
  accessSurfaces: AccessSurface[];
  usageLinks: UsageLink[];
  quotaPolicies: QuotaPolicy[];
  snapshots: UsageSnapshot[];
  evaluations: Evaluation[];
  workRecords: WorkRecord[];
  legacyRefs: LegacyRef[];
};

export type ExchangeRateSnapshot = {
  rates: Partial<Record<Currency, number>> & { CNY: number };
  rateDate: string;
  source: string;
  lastAttemptDate?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  updatedAt?: string;
};

export const adoptionLabels: Record<AdoptionStatus, string> = {
  active: "正在使用",
  trial: "试用中",
  considering: "考虑使用",
  unused: "暂未使用",
  paused: "已暂停",
  retired: "已停用",
};

export const roleLabels: Record<ItemRole, string> = {
  model: "模型",
  api: "API",
  agent: "Agent",
  code: "Code",
  chat: "Chat",
  bot: "Bot",
  app: "App",
  automation: "自动化",
  platform: "平台",
  domain: "域名",
  hosting: "托管",
  cloud: "云服务",
  storage: "存储",
  developer_tool: "开发工具",
  communication: "通信",
  security: "安全",
  other: "其他",
};

export const recommendationLabels: Record<Recommendation, string> = {
  continue: "继续使用",
  observe: "继续观察",
  upgrade: "考虑升级",
  downgrade: "考虑降级",
  pause: "暂停使用",
  stop: "建议停用",
};
