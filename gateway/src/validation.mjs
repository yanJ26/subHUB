export const workspaceArrayKeys = [
  "providers", "catalog", "entitlements", "invoices", "tagDefinitions", "assets",
  "deployments", "accessSurfaces", "usageLinks", "quotaPolicies", "snapshots",
  "evaluations", "workRecords", "legacyRefs",
];

const entityArrayKeys = workspaceArrayKeys.filter((key) => key !== "legacyRefs");

const values = {
  adoptionStatus: new Set(["active", "trial", "considering", "unused", "paused", "retired"]),
  billingMode: new Set(["subscription", "token_pack", "pay_as_you_go", "free", "trial", "self_hosted", "hybrid", "bundled", "one_time"]),
  billingCycle: new Set(["monthly", "yearly", "none"]),
  currency: new Set(["CNY", "USD", "EUR", "HKD", "GBP", "JPY"]),
  entitlementStatus: new Set(["active", "trial", "paused", "expired", "cancelled"]),
  invoiceStatus: new Set(["issued", "pending", "none", "paid", "reimbursed"]),
  assetKind: new Set(["domain", "device", "server", "account", "repository", "website", "workflow", "other"]),
  assetStatus: new Set(["active", "attention", "offline", "expired", "retired", "unknown"]),
  deploymentRole: new Set(["primary", "secondary", "testing"]),
  deploymentStatus: new Set(["online", "degraded", "offline", "unknown", "retired"]),
  surfaceKind: new Set(["web", "mobile", "desktop", "cli", "api", "bot", "message", "workflow"]),
  surfaceStatus: new Set(["available", "limited", "offline"]),
  quotaMetric: new Set(["tokens", "credits", "calls", "currency", "percentage", "time", "unknown"]),
  quotaWindow: new Set(["calendar_month", "billing_cycle", "fixed_window", "rolling_window", "balance", "lifetime", "metered"]),
  evaluationLevel: new Set(["none", "low", "normal", "high", "constrained"]),
  valueLevel: new Set(["unknown", "low", "fair", "good", "core"]),
  trend: new Set(["rising", "stable", "falling", "unknown"]),
  recommendation: new Set(["continue", "observe", "upgrade", "downgrade", "pause", "stop"]),
  confidence: new Set(["low", "medium", "high"]),
  itemRole: new Set(["model", "api", "agent", "code", "chat", "bot", "app", "automation", "platform", "domain", "hosting", "cloud", "storage", "developer_tool", "communication", "security", "other"]),
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validationError(details) {
  const error = new Error("invalid_workspace_state");
  error.details = details.slice(0, 50);
  return error;
}

export function assertExpectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new Error("expected_revision_required");
    error.details = [{ path: "$.expectedRevision", message: "必须提供非负整数修订号" }];
    throw error;
  }
  return value;
}

export function assertWorkspaceState(input, { requireAll = true } = {}) {
  const details = [];
  const issue = (path, message) => { if (details.length < 50) details.push({ path, message }); };
  if (!isRecord(input)) throw validationError([{ path: "$", message: "工作区必须是对象" }]);

  for (const key of workspaceArrayKeys) {
    if (!Array.isArray(input[key])) {
      if (requireAll || input[key] !== undefined) issue(`$.${key}`, "必须是数组");
    }
  }
  if (details.length) throw validationError(details);

  const state = { ...input };
  const ids = new Map();
  const collect = (collection, rows) => {
    const set = new Set();
    ids.set(collection, set);
    rows.forEach((row, index) => {
      const path = `$.${collection}[${index}]`;
      if (!isRecord(row)) return issue(path, "必须是对象");
      if (typeof row.id !== "string" || !row.id.trim() || row.id.length > 200) issue(`${path}.id`, "必须是 1–200 字符的 ID");
      else if (set.has(row.id)) issue(`${path}.id`, "ID 重复");
      else set.add(row.id);
    });
  };
  for (const key of entityArrayKeys) collect(key, state[key]);
  if (details.length) throw validationError(details);

  const requiredString = (row, field, path, allowEmpty = false) => {
    if (typeof row[field] !== "string" || (!allowEmpty && !row[field].trim()) || row[field].length > 5000) issue(`${path}.${field}`, "必须是有效文本");
  };
  const optionalString = (row, field, path) => {
    if (row[field] !== undefined && (typeof row[field] !== "string" || row[field].length > 5000)) issue(`${path}.${field}`, "必须是文本");
  };
  const enumeration = (row, field, allowed, path, optional = false) => {
    if (optional && row[field] === undefined) return;
    if (!allowed.has(row[field])) issue(`${path}.${field}`, "值不受支持");
  };
  const number = (row, field, path, { optional = true, nullable = false, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) => {
    const value = row[field];
    if (value === undefined && optional) return;
    if (value === null && nullable) return;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) issue(`${path}.${field}`, "必须是范围内的数字");
  };
  const date = (row, field, path) => {
    if (row[field] === undefined || row[field] === "") return;
    const value = row[field];
    const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
    if (!match) return issue(`${path}.${field}`, "必须是有效日期");
    const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    const validCalendar = calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
    const validSuffix = match[4] === "" || (match[4].startsWith("T") && !Number.isNaN(Date.parse(value)));
    if (!validCalendar || !validSuffix) issue(`${path}.${field}`, "必须是有效日期");
  };
  const reference = (row, field, target, path, optional = false) => {
    const value = row[field];
    if (optional && (value === undefined || value === "")) return;
    if (typeof value !== "string" || !ids.get(target)?.has(value)) issue(`${path}.${field}`, `引用的 ${target} 不存在`);
  };

  state.providers.forEach((row, index) => {
    const path = `$.providers[${index}]`;
    requiredString(row, "name", path); optionalString(row, "website", path); optionalString(row, "notes", path);
  });
  state.catalog.forEach((row, index) => {
    const path = `$.catalog[${index}]`;
    reference(row, "providerId", "providers", path); requiredString(row, "name", path); requiredString(row, "description", path, true);
    enumeration(row, "adoptionStatus", values.adoptionStatus, path);
    if (!Array.isArray(row.roles) || !row.roles.length || row.roles.some((role) => !values.itemRole.has(role))) issue(`${path}.roles`, "必须是非空且受支持的角色数组");
    if (!Array.isArray(row.models) || row.models.some((model) => typeof model !== "string" || model.length > 5000)) issue(`${path}.models`, "必须是模型数组");
    if (row.useCases !== undefined && (!Array.isArray(row.useCases) || row.useCases.some((value) => typeof value !== "string" || value.length > 5000))) issue(`${path}.useCases`, "必须是文本数组");
    optionalString(row, "website", path); optionalString(row, "notes", path); date(row, "lastReviewedAt", path);
  });
  state.entitlements.forEach((row, index) => {
    const path = `$.entitlements[${index}]`;
    reference(row, "itemId", "catalog", path); requiredString(row, "label", path);
    enumeration(row, "billingMode", values.billingMode, path); enumeration(row, "currency", values.currency, path);
    enumeration(row, "billingCycle", values.billingCycle, path); enumeration(row, "status", values.entitlementStatus, path, true);
    number(row, "amount", path, { optional: false, nullable: true }); number(row, "reminderDays", path, { integer: true, max: 3650 });
    ["startsAt", "renewsAt", "expiresAt", "resetsAt"].forEach((field) => date(row, field, path));
    if (typeof row.autoRenew !== "boolean") issue(`${path}.autoRenew`, "必须是布尔值");
    if (row.tags !== undefined && (!Array.isArray(row.tags) || row.tags.some((tag) => typeof tag !== "string"))) issue(`${path}.tags`, "必须是标签数组");
    ["channel", "credentialLabel", "notes"].forEach((field) => optionalString(row, field, path));
  });
  state.tagDefinitions.forEach((row, index) => {
    const path = `$.tagDefinitions[${index}]`;
    requiredString(row, "name", path); optionalString(row, "background", path); optionalString(row, "color", path);
    number(row, "sortOrder", path, { integer: true, min: -100000 });
  });
  state.invoices.forEach((row, index) => {
    const path = `$.invoices[${index}]`;
    reference(row, "entitlementId", "entitlements", path); enumeration(row, "status", values.invoiceStatus, path);
    number(row, "amount", path); enumeration(row, "currency", values.currency, path, true);
    ["issuedAt", "dueAt"].forEach((field) => date(row, field, path));
    ["number", "url", "notes"].forEach((field) => optionalString(row, field, path));
  });
  state.assets.forEach((row, index) => {
    const path = `$.assets[${index}]`;
    requiredString(row, "name", path); enumeration(row, "kind", values.assetKind, path); enumeration(row, "status", values.assetStatus, path);
    reference(row, "providerId", "providers", path, true); reference(row, "itemId", "catalog", path, true);
    ["expiresAt", "lastCheckedAt"].forEach((field) => date(row, field, path));
    if (row.autoRenew !== undefined && typeof row.autoRenew !== "boolean") issue(`${path}.autoRenew`, "必须是布尔值");
    ["description", "domainName", "registrar", "deviceType", "os", "location", "roleNote", "url", "notes"].forEach((field) => optionalString(row, field, path));
  });
  state.deployments.forEach((row, index) => {
    const path = `$.deployments[${index}]`;
    reference(row, "itemId", "catalog", path); reference(row, "assetId", "assets", path); requiredString(row, "name", path);
    enumeration(row, "role", values.deploymentRole, path); enumeration(row, "status", values.deploymentStatus, path);
    ["version", "model", "runtime", "installMethod", "notes"].forEach((field) => optionalString(row, field, path));
  });
  state.accessSurfaces.forEach((row, index) => {
    const path = `$.accessSurfaces[${index}]`;
    reference(row, "itemId", "catalog", path); requiredString(row, "name", path); enumeration(row, "kind", values.surfaceKind, path);
    reference(row, "assetId", "assets", path, true); reference(row, "deploymentId", "deployments", path, true);
    enumeration(row, "status", values.surfaceStatus, path, true);
    ["device", "account", "notes"].forEach((field) => optionalString(row, field, path));
  });
  state.usageLinks.forEach((row, index) => {
    const path = `$.usageLinks[${index}]`;
    reference(row, "entitlementId", "entitlements", path); requiredString(row, "label", path);
    reference(row, "consumerItemId", "catalog", path, true); reference(row, "accessSurfaceId", "accessSurfaces", path, true);
    reference(row, "assetId", "assets", path, true); reference(row, "deploymentId", "deployments", path, true);
    number(row, "allocationPercent", path, { max: 100 });
  });
  state.quotaPolicies.forEach((row, index) => {
    const path = `$.quotaPolicies[${index}]`;
    reference(row, "entitlementId", "entitlements", path); requiredString(row, "label", path);
    enumeration(row, "metric", values.quotaMetric, path); enumeration(row, "windowType", values.quotaWindow, path);
    number(row, "windowHours", path); number(row, "limitValue", path); optionalString(row, "resetTimezone", path); optionalString(row, "notes", path);
  });
  const quotaEntitlement = new Map(state.quotaPolicies.map((row) => [row.id, row.entitlementId]));
  state.snapshots.forEach((row, index) => {
    const path = `$.snapshots[${index}]`;
    reference(row, "entitlementId", "entitlements", path); reference(row, "quotaPolicyId", "quotaPolicies", path, true);
    if (row.quotaPolicyId && quotaEntitlement.get(row.quotaPolicyId) !== row.entitlementId) issue(`${path}.quotaPolicyId`, "额度规则属于另一项权益");
    date(row, "observedAt", path); if (!row.observedAt) issue(`${path}.observedAt`, "必须提供观察时间");
    ["periodStart", "periodEnd"].forEach((field) => date(row, field, path));
    ["usedValue", "remainingValue"].forEach((field) => number(row, field, path));
    number(row, "utilizationPercent", path, { max: 100 }); requiredString(row, "sourceLabel", path);
    optionalString(row, "evidenceName", path); optionalString(row, "notes", path);
  });
  state.evaluations.forEach((row, index) => {
    const path = `$.evaluations[${index}]`;
    reference(row, "itemId", "catalog", path); date(row, "evaluatedAt", path); if (!row.evaluatedAt) issue(`${path}.evaluatedAt`, "必须提供评价日期");
    enumeration(row, "utilization", values.evaluationLevel, path); enumeration(row, "outputValue", values.valueLevel, path);
    enumeration(row, "quotaPressure", values.evaluationLevel, path); enumeration(row, "trend", values.trend, path);
    enumeration(row, "recommendation", values.recommendation, path); enumeration(row, "confidence", values.confidence, path);
    number(row, "evidenceCount", path, { optional: false, integer: true }); number(row, "observationDays", path, { optional: false, integer: true }); optionalString(row, "note", path);
  });
  state.workRecords.forEach((row, index) => {
    const path = `$.workRecords[${index}]`;
    reference(row, "itemId", "catalog", path); requiredString(row, "title", path); date(row, "occurredAt", path);
    if (!row.occurredAt) issue(`${path}.occurredAt`, "必须提供发生日期"); optionalString(row, "note", path); optionalString(row, "sourceLabel", path);
  });

  const legacyKeys = new Set();
  const targetCollections = {
    provider: "providers", catalog_item: "catalog", entitlement: "entitlements", invoice: "invoices",
    tag_definition: "tagDefinitions", asset: "assets", deployment: "deployments",
    access_surface: "accessSurfaces", usage_link: "usageLinks", quota_policy: "quotaPolicies",
    usage_snapshot: "snapshots", evaluation: "evaluations", work_record: "workRecords",
  };
  state.legacyRefs.forEach((row, index) => {
    const path = `$.legacyRefs[${index}]`;
    if (!isRecord(row)) return issue(path, "必须是对象");
    ["sourceSystem", "entityType", "sourceId", "targetType", "targetId", "importedAt"].forEach((field) => requiredString(row, field, path));
    date(row, "importedAt", path); optionalString(row, "sourceHash", path);
    const key = `${row.sourceSystem}\u0000${row.entityType}\u0000${row.sourceId}`;
    if (legacyKeys.has(key)) issue(path, "来源映射重复"); else legacyKeys.add(key);
    const collection = targetCollections[row.targetType];
    if (!collection || !ids.get(collection)?.has(row.targetId)) issue(`${path}.targetId`, "来源映射目标不存在");
  });

  if (details.length) throw validationError(details);
  return state;
}

export function emptyWorkspace() {
  return Object.fromEntries(workspaceArrayKeys.map((key) => [key, []]));
}
