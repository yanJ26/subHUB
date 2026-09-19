export const INTAKE_FIELDS = [
  "serviceName", "providerName", "role", "website", "planName", "billingMode",
  "amount", "currency", "billingCycle", "renewsAt", "expiresAt", "autoRenew",
  "reminderDays", "channel", "tags", "notes", "invoiceStatus", "invoiceNumber", "invoiceUrl",
];

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const nullableBoolean = { type: ["boolean", "null"] };

const subscriptionProperties = {
  serviceName: nullableString,
  providerName: nullableString,
  role: { type: ["string", "null"], enum: ["developer_tool", "agent", "api", "chat", "model", "app", "platform", "cloud", "other", null] },
  website: nullableString,
  planName: nullableString,
  billingMode: { type: ["string", "null"], enum: ["subscription", "pay_as_you_go", "token_pack", "trial", "free", "bundled", "one_time", "self_hosted", "hybrid", null] },
  amount: nullableNumber,
  currency: { type: ["string", "null"], enum: ["CNY", "USD", "EUR", "HKD", "GBP", "JPY", null] },
  billingCycle: { type: ["string", "null"], enum: ["monthly", "yearly", "none", null] },
  renewsAt: nullableString,
  expiresAt: nullableString,
  autoRenew: nullableBoolean,
  reminderDays: nullableNumber,
  channel: nullableString,
  tags: { type: ["array", "null"], items: { type: "string" } },
  notes: nullableString,
  invoiceStatus: { type: ["string", "null"], enum: ["issued", "pending", "none", "paid", "reimbursed", null] },
  invoiceNumber: nullableString,
  invoiceUrl: nullableString,
};

export const ALLOWED_INTENTS = ["create_subscription", "update_subscription", "unknown"];

const subscriptionObject = {
  type: "object", additionalProperties: false,
  properties: subscriptionProperties, required: INTAKE_FIELDS,
};

export const INTAKE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ALLOWED_INTENTS },
    target: nullableString,
    subscription: subscriptionObject,
    changes: subscriptionObject,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    missingFields: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
  },
  required: ["intent", "target", "subscription", "changes", "confidence", "missingFields", "riskFlags"],
};

function cleanString(value, maxLength) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeSubscriptionFields(source) {
  const result = {};
  for (const field of INTAKE_FIELDS) {
    const value = source?.[field];
    if (value === null || value === undefined) continue;
    if (["serviceName", "providerName", "planName", "channel", "invoiceNumber"].includes(field)) result[field] = cleanString(value, 200);
    else if (["website", "invoiceUrl"].includes(field)) result[field] = cleanString(value, 1000);
    else if (field === "notes") result[field] = cleanString(value, 2000);
    else if (["renewsAt", "expiresAt"].includes(field)) result[field] = cleanString(value, 10);
    else if (field === "tags" && Array.isArray(value)) result.tags = [...new Set(value.map((tag) => cleanString(tag, 32)).filter(Boolean))].slice(0, 12);
    else result[field] = value;
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null));
}

export function normalizeIntakeResult(input) {
  if (!input || typeof input !== "object" || !ALLOWED_INTENTS.includes(input.intent)) {
    throw new Error("model_output_invalid");
  }
  return {
    intent: input.intent,
    target: cleanString(input.target, 200),
    subscription: normalizeSubscriptionFields(input.subscription),
    changes: normalizeSubscriptionFields(input.changes),
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    missingFields: Array.isArray(input.missingFields) ? input.missingFields.map((field) => cleanString(field, 80)).filter(Boolean) : [],
    riskFlags: Array.isArray(input.riskFlags) ? input.riskFlags.map((flag) => cleanString(flag, 120)).filter(Boolean) : [],
  };
}
