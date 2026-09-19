const values = {
  roles: new Set(["developer_tool", "agent", "api", "chat", "model", "app", "platform", "cloud", "other"]),
  billingModes: new Set(["subscription", "pay_as_you_go", "token_pack", "trial", "free", "bundled", "one_time", "self_hosted", "hybrid"]),
  currencies: new Set(["CNY", "USD", "EUR", "HKD", "GBP", "JPY"]),
  billingCycles: new Set(["monthly", "yearly", "none"]),
  invoiceStatuses: new Set(["issued", "pending", "none", "paid", "reimbursed"]),
};

const labels = {
  serviceName: "服务", providerName: "服务商", role: "类型", planName: "方案", billingMode: "计费方式",
  amount: "金额", currency: "币种", billingCycle: "周期", renewsAt: "下次续费", expiresAt: "权益到期",
  autoRenew: "自动续费", reminderDays: "提前提醒", channel: "购买渠道", tags: "标签", invoiceStatus: "发票状态",
  invoiceNumber: "发票号码", invoiceUrl: "发票链接", website: "官网", notes: "备注",
};

function issue(code, message) { return { code, message }; }

function validDate(value) {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

function formatValue(field, value) {
  if (Array.isArray(value)) return value.length ? value.join("、") : "无";
  if (typeof value === "boolean") return value ? "是" : "否";
  const named = { monthly: "月付", yearly: "年付", none: "无固定周期", subscription: "订阅", pay_as_you_go: "按量", trial: "试用", free: "免费", issued: "已开票", pending: "待开票", paid: "已支付", reimbursed: "已报销" };
  return named[value] || String(value ?? "未填写");
}

const UPDATABLE = new Set(["planName", "billingMode", "amount", "currency", "billingCycle", "renewsAt", "expiresAt", "autoRenew", "channel", "reminderDays", "tags", "notes"]);
const ENTITLEMENT_FIELD = { planName: "label" };

function entitlementField(field) { return ENTITLEMENT_FIELD[field] || field; }

function validateFields(fields, config) {
  const issues = [];
  if (fields.amount !== undefined && (!Number.isFinite(fields.amount) || fields.amount < 0 || fields.amount > 1_000_000)) issues.push(issue("invalid_amount", "金额必须在 0 到 1,000,000 之间"));
  if (fields.role && !values.roles.has(fields.role)) issues.push(issue("invalid_role", "服务类型不受支持"));
  if (fields.billingMode && !values.billingModes.has(fields.billingMode)) issues.push(issue("invalid_billing_mode", "计费方式不受支持"));
  if (fields.currency && !values.currencies.has(fields.currency)) issues.push(issue("invalid_currency", "币种不受支持"));
  if (fields.billingCycle && !values.billingCycles.has(fields.billingCycle)) issues.push(issue("invalid_billing_cycle", "计费周期不受支持"));
  if (fields.invoiceStatus && !values.invoiceStatuses.has(fields.invoiceStatus)) issues.push(issue("invalid_invoice_status", "发票状态不受支持"));
  for (const field of ["renewsAt", "expiresAt"]) if (fields[field] && !validDate(fields[field])) issues.push(issue("invalid_date", `${labels[field]}必须是真实有效的 YYYY-MM-DD 日期`));
  if (fields.reminderDays !== undefined && (!Number.isInteger(fields.reminderDays) || fields.reminderDays < 0 || fields.reminderDays > 365)) issues.push(issue("invalid_reminder", "提醒天数必须是 0 到 365 的整数"));
  for (const field of ["website", "invoiceUrl"]) if (fields[field] && !/^https:\/\//i.test(fields[field])) issues.push(issue("invalid_url", `${labels[field]}必须使用 HTTPS`));
  if (Array.isArray(fields.tags)) {
    const allowed = new Set(config.allowedTags || []);
    const unknown = fields.tags.filter((tag) => !allowed.has(tag));
    if (unknown.length) issues.push(issue("unknown_tags", `标签尚未创建：${unknown.join("、")}`));
  }
  return issues;
}

function createDraft(fields) {
  const lines = [`新增订阅：${fields.serviceName}`];
  for (const [field, value] of Object.entries(fields)) lines.push(`${labels[field] || field}：${formatValue(field, value)}`);
  return { status: "draft_ready", payload: { op: "create", ...fields }, summary: lines.join("\n") };
}

function updateDraft(workspace, item, entitlement, changes) {
  const lines = [`修改订阅：${item.name}（${entitlement.label}）`];
  for (const [field, value] of Object.entries(changes)) {
    const before = entitlement[entitlementField(field)];
    lines.push(`${labels[field] || field}：${formatValue(field, before)} → ${formatValue(field, value)}`);
  }
  return {
    status: "draft_ready",
    payload: { op: "update", entitlementId: entitlement.id, itemId: item.id, serviceName: item.name, planLabel: entitlement.label, changes },
    summary: lines.join("\n"),
  };
}

export function evaluateIntakeResult(parsed, workspace, config) {
  if (parsed.riskFlags.length) return { status: "rejected", issues: parsed.riskFlags.map((flag) => issue("model_risk", flag)) };
  if (parsed.intent === "unknown") return { status: "needs_clarification", issues: [issue("unknown_intent", "目前只能用自然语言新增订阅或修改已有订阅，请说明是新增还是修改，以及服务名称。")] };
  if (parsed.confidence < config.confidenceThreshold) return { status: "needs_clarification", issues: [issue("low_confidence", `解析置信度 ${parsed.confidence.toFixed(2)} 低于阈值，请补充更明确的信息`)] };

  if (parsed.intent === "create_subscription") {
    const fields = parsed.subscription;
    const issues = [];
    if (!fields.serviceName) issues.push(issue("missing_required", "请至少说明订阅或服务名称"));
    issues.push(...validateFields(fields, config));
    if (fields.serviceName) {
      const itemIds = new Set(workspace.catalog.filter((item) => item.name.trim().toLocaleLowerCase() === fields.serviceName.trim().toLocaleLowerCase()).map((item) => item.id));
      const plan = (fields.planName || "订阅方案").trim().toLocaleLowerCase();
      const duplicate = workspace.entitlements.find((entry) => itemIds.has(entry.itemId) && entry.label.trim().toLocaleLowerCase() === plan && entry.status !== "cancelled");
      if (duplicate) issues.push(issue("possible_duplicate", `已存在同名方案：${fields.serviceName} / ${fields.planName || "订阅方案"}；如需修改请选择“修改已有订阅”。`));
    }
    if (issues.length) return { status: "needs_clarification", issues };
    return createDraft(fields);
  }

  // update_subscription
  const target = parsed.target;
  if (!target) return { status: "needs_clarification", issues: [issue("missing_target", "请说明要修改哪个已有订阅的服务名称")] };
  const changes = parsed.changes || {};
  if (!Object.keys(changes).length) return { status: "needs_clarification", issues: [issue("no_changes", "没有识别到需要修改的内容，请说明要改哪个字段。")] };
  const lowered = target.trim().toLocaleLowerCase();
  const matchedItems = workspace.catalog.filter((item) => item.name.trim().toLocaleLowerCase() === lowered);
  if (!matchedItems.length) return { status: "needs_clarification", issues: [issue("target_not_found", `没有找到名为“${target}”的订阅，请确认名称或改用新增。`)] };
  const candidates = [];
  for (const item of matchedItems) {
    for (const entitlement of workspace.entitlements.filter((entry) => entry.itemId === item.id && entry.status !== "cancelled")) candidates.push({ item, entitlement });
  }
  if (!candidates.length) return { status: "needs_clarification", issues: [issue("target_not_found", `“${target}”没有可修改的有效订阅权益，请改用新增。`)] };
  if (candidates.length > 1) return { status: "needs_clarification", issues: [issue("ambiguous_target", `“${target}”匹配到多个订阅方案，请在网页列表中手动修改。`)] };

  const { item, entitlement } = candidates[0];
  const issues = [];
  const unsupported = Object.keys(changes).filter((field) => !UPDATABLE.has(field));
  if (unsupported.length) issues.push(issue("unsupported_change", `以下字段暂不支持通过录入修改，请在网页中编辑：${unsupported.map((field) => labels[field] || field).join("、")}`));
  issues.push(...validateFields(changes, config));
  if (issues.length) return { status: "needs_clarification", issues };
  return updateDraft(workspace, item, entitlement, changes);
}
