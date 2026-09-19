import { randomUUID } from "node:crypto";

function id(prefix) { return `${prefix}_${randomUUID()}`; }
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function sameText(left, right) { return text(left).toLocaleLowerCase() === text(right).toLocaleLowerCase(); }

export function addIntakeSubscription(state, fields) {
  const result = structuredClone(state);
  const serviceName = text(fields.serviceName);
  const providerName = text(fields.providerName) || serviceName;
  let provider = result.providers.find((entry) => sameText(entry.name, providerName));
  if (!provider) {
    provider = { id: id("provider"), name: providerName };
    result.providers.push(provider);
  }

  let item = result.catalog.find((entry) => entry.providerId === provider.id && sameText(entry.name, serviceName));
  const role = fields.role || "developer_tool";
  if (item) {
    item.roles = [...new Set([...(item.roles || []), role])];
    if (!item.website && text(fields.website)) item.website = text(fields.website);
    if (["retired", "unused"].includes(item.adoptionStatus)) item.adoptionStatus = fields.billingMode === "trial" ? "trial" : "active";
    item.lastReviewedAt = new Date().toISOString().slice(0, 10);
  } else {
    item = {
      id: id("item"), providerId: provider.id, name: serviceName,
      description: `${serviceName} 的订阅或使用服务`, roles: [role], models: [],
      adoptionStatus: fields.billingMode === "trial" ? "trial" : "active",
      ...(text(fields.website) ? { website: text(fields.website) } : {}),
      lastReviewedAt: new Date().toISOString().slice(0, 10),
    };
    result.catalog.push(item);
  }

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
