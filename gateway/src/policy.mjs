import { MUTATION_INTENTS } from "./schema.mjs";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SENSITIVE_FIELD_PATTERN = /api.?key|token|secret|password|card.?number|cvv/i;

function issue(code, message) {
  return { code, message };
}

export function validateCommonFields(fields, allowedTags) {
  const issues = [];
  for (const key of Object.keys(fields)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) issues.push(issue("sensitive_field", `禁止字段：${key}`));
  }
  if (fields.price != null && (!Number.isFinite(fields.price) || fields.price < 0 || fields.price > 1_000_000)) {
    issues.push(issue("invalid_price", "价格必须在 0 到 1,000,000 之间"));
  }
  if (fields.renewalDate != null && (!DATE_PATTERN.test(fields.renewalDate) || Number.isNaN(Date.parse(`${fields.renewalDate}T00:00:00Z`)))) {
    issues.push(issue("invalid_date", "到期时间必须是有效的 YYYY-MM-DD 日期"));
  }
  if (fields.invoiceUrl && !/^https:\/\//i.test(fields.invoiceUrl)) {
    issues.push(issue("invalid_invoice_url", "发票链接必须使用 HTTPS"));
  }
  if (fields.reminderDays != null && (!Number.isInteger(fields.reminderDays) || fields.reminderDays < 0 || fields.reminderDays > 365)) {
    issues.push(issue("invalid_reminder", "提醒天数必须是 0 到 365 的整数"));
  }
  if (Array.isArray(fields.tags)) {
    const unknown = fields.tags.filter((tag) => !allowedTags.includes(tag));
    if (unknown.length) issues.push(issue("unknown_tags", `标签不存在：${unknown.join("、")}`));
  }
  return issues;
}

function formatValue(field, value) {
  if (Array.isArray(value)) return value.length ? value.join("、") : "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  const labels = { monthly: "月付", yearly: "年付", issued: "已开票", pending: "待开票", none: "无需发票" };
  return labels[value] || String(value ?? "未填写");
}

const fieldLabels = {
  name: "名称", provider: "服务商", plan: "方案", price: "价格", currency: "币种",
  billingCycle: "订阅周期", renewalDate: "到期时间", channel: "订阅渠道", loginDevice: "登录设备", tags: "标签",
  autoRenew: "自动续费", invoiceStatus: "发票状态", invoiceNumber: "发票号码",
  invoiceUrl: "发票链接", reminderDays: "提前提醒", notes: "备注",
};

export function formatDraftSummary(parsed, before = null) {
  const title = parsed.intent === "create_subscription" ? `新增订阅：${parsed.subscription.name}`
    : parsed.intent === "archive_subscription" ? `归档订阅：${parsed.target.name}`
      : `修改订阅：${parsed.target.name}`;
  const fields = parsed.intent === "create_subscription" ? parsed.subscription : parsed.changes;
  const lines = [title];
  for (const [field, value] of Object.entries(fields)) {
    if (before && Object.hasOwn(before, field)) lines.push(`${fieldLabels[field] || field}：${formatValue(field, before[field])} → ${formatValue(field, value)}`);
    else lines.push(`${fieldLabels[field] || field}：${formatValue(field, value)}`);
  }
  return lines.join("\n");
}

export function evaluateParsedIntent(parsed, db, config) {
  if (parsed.riskFlags.length) {
    return { status: "rejected", issues: parsed.riskFlags.map((flag) => issue("model_risk", flag)) };
  }
  if (parsed.intent === "unknown") {
    return { status: "needs_clarification", issues: [issue("unknown_intent", "无法确定安全且受支持的操作")] };
  }
  if (parsed.confidence < config.confidenceThreshold) {
    return {
      status: "needs_clarification",
      issues: [issue("low_confidence", `解析置信度 ${parsed.confidence.toFixed(2)} 低于阈值`)],
    };
  }

  if (parsed.intent === "query_subscriptions") {
    return { status: "query_ready", results: db.searchSubscriptions(parsed.target.name || "") };
  }
  if (!MUTATION_INTENTS.has(parsed.intent)) return { status: "rejected", issues: [issue("intent_not_allowed", "操作未被允许")] };

  const fields = parsed.intent === "create_subscription" ? parsed.subscription : parsed.changes;
  const issues = validateCommonFields(fields, config.allowedTags);
  let target = null;

  if (parsed.intent === "create_subscription") {
    if (!fields.name) issues.push(issue("missing_required", `新增订阅缺少：${fieldLabels.name}`));
    const duplicates = fields.name ? db.findExactActiveSubscriptions(fields.name) : [];
    if (duplicates.length) issues.push(issue("possible_duplicate", `已存在同名订阅：${fields.name}`));
  } else {
    if (!parsed.target.name) issues.push(issue("missing_target", "未指定要修改的订阅"));
    const matches = parsed.target.name ? db.findExactActiveSubscriptions(parsed.target.name) : [];
    if (matches.length !== 1) issues.push(issue(matches.length ? "ambiguous_target" : "target_not_found", matches.length ? "找到多个同名订阅，请在网页中处理" : "没有找到对应订阅"));
    else target = matches[0];
    if (["update_subscription", "update_invoice"].includes(parsed.intent) && !Object.keys(fields).length) issues.push(issue("no_changes", "没有识别到需要修改的字段"));
  }

  if (issues.length) return { status: "needs_clarification", issues };
  return {
    status: "draft_ready",
    target,
    payload: { subscription: parsed.subscription, changes: parsed.changes },
    summary: formatDraftSummary(parsed, target),
  };
}
