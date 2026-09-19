import { randomUUID } from "node:crypto";

function id(prefix) { return `${prefix}_${randomUUID()}`; }
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function sameText(left, right) { return text(left).toLocaleLowerCase() === text(right).toLocaleLowerCase(); }

function ensureService(result, fields, { serviceOnly = false } = {}) {
  const serviceName = text(fields.serviceName);
  const explicitProvider = text(fields.providerName);
  let item;
  let provider;

  if (!explicitProvider) {
    const matches = result.catalog.filter((entry) => sameText(entry.name, serviceName));
    if (matches.length === 1) {
      item = matches[0];
      provider = result.providers.find((entry) => entry.id === item.providerId);
    }
  }
  const providerName = explicitProvider || provider?.name || serviceName;
  if (!provider) provider = result.providers.find((entry) => sameText(entry.name, providerName));
  if (!provider) {
    provider = { id: id("provider"), name: providerName };
    result.providers.push(provider);
  }

  if (!item) item = result.catalog.find((entry) => entry.providerId === provider.id && sameText(entry.name, serviceName));
  const role = fields.role || "other";
  const adoptionStatus = fields.adoptionStatus || (fields.billingMode === "trial" ? "trial" : "active");
  if (item) {
    item.roles = [...new Set([...(item.roles || []), role])];
    if (!item.website && text(fields.website)) item.website = text(fields.website);
    if (["retired", "unused"].includes(item.adoptionStatus) || fields.adoptionStatus) item.adoptionStatus = adoptionStatus;
    if (serviceOnly && text(fields.notes)) item.notes = text(fields.notes);
    item.lastReviewedAt = new Date().toISOString().slice(0, 10);
  } else {
    item = {
      id: id("item"), providerId: provider.id, name: serviceName,
      description: `${serviceName} 服务`, roles: [role], models: [], adoptionStatus,
      ...(text(fields.website) ? { website: text(fields.website) } : {}),
      ...(serviceOnly && text(fields.notes) ? { notes: text(fields.notes) } : {}),
      lastReviewedAt: new Date().toISOString().slice(0, 10),
    };
    result.catalog.push(item);
  }
  return item;
}

export function applyIntakeSubscriptionUpdate(state, draft) {
  const result = structuredClone(state);
  const entitlement = result.entitlements.find((entry) => entry.id === draft.entitlementId);
  if (!entitlement) throw new Error("intake_target_missing");
  const changes = draft.changes || {};
  const has = (field) => Object.prototype.hasOwnProperty.call(changes, field);
  if (has("planName")) entitlement.label = text(changes.planName) || entitlement.label;
  if (has("billingMode")) entitlement.billingMode = changes.billingMode;
  if (has("amount") && Number.isFinite(changes.amount)) entitlement.amount = changes.amount;
  if (has("currency")) entitlement.currency = changes.currency;
  if (has("billingCycle")) entitlement.billingCycle = changes.billingCycle;
  if (has("renewsAt")) entitlement.renewsAt = text(changes.renewsAt);
  if (has("expiresAt")) entitlement.expiresAt = text(changes.expiresAt);
  if (has("autoRenew")) entitlement.autoRenew = Boolean(changes.autoRenew);
  if (has("channel")) entitlement.channel = text(changes.channel);
  if (has("reminderDays") && Number.isInteger(changes.reminderDays)) entitlement.reminderDays = changes.reminderDays;
  if (has("tags")) entitlement.tags = [...new Set((Array.isArray(changes.tags) ? changes.tags : []).map(text).filter(Boolean))];
  if (has("notes")) entitlement.notes = text(changes.notes);
  entitlement.status = entitlement.status === "expired" || entitlement.status === "cancelled" ? entitlement.status : "active";
  return result;
}

export function addIntakeService(state, fields) {
  const result = structuredClone(state);
  ensureService(result, fields, { serviceOnly: true });
  return result;
}

export function addIntakeSubscription(state, fields) {
  const result = structuredClone(state);
  const item = ensureService(result, { ...fields, role: fields.role || "developer_tool" });

  const entitlementId = id("entitlement");
  result.entitlements.push({
    id: entitlementId, itemId: item.id, label: text(fields.planName) || "订阅方案",
    billingMode: fields.billingMode || "subscription",
    amount: Number.isFinite(fields.amount) ? fields.amount : null,
    currency: fields.currency || "CNY",
    billingCycle: fields.billingCycle || "monthly",
    status: fields.billingMode === "trial" ? "trial" : "active",
    ...(text(fields.renewsAt) ? { renewsAt: text(fields.renewsAt) } : {}),
    ...(text(fields.expiresAt) ? { expiresAt: text(fields.expiresAt) } : {}),
    autoRenew: Boolean(fields.autoRenew),
    ...(text(fields.channel) ? { channel: text(fields.channel) } : {}),
    reminderDays: Number.isInteger(fields.reminderDays) ? fields.reminderDays : 7,
    tags: Array.isArray(fields.tags) ? [...new Set(fields.tags.map(text).filter(Boolean))] : [],
    ...(text(fields.notes) ? { notes: text(fields.notes) } : {}),
  });

  const invoiceStatus = fields.invoiceStatus || "none";
  if (invoiceStatus !== "none" || text(fields.invoiceNumber) || text(fields.invoiceUrl)) {
    result.invoices.push({
      id: id("invoice"), entitlementId, status: invoiceStatus,
      ...(text(fields.invoiceNumber) ? { number: text(fields.invoiceNumber) } : {}),
      ...(text(fields.invoiceUrl) ? { url: text(fields.invoiceUrl) } : {}),
      ...(Number.isFinite(fields.amount) ? { amount: fields.amount, currency: fields.currency || "CNY" } : {}),
    });
  }
  return result;
}
