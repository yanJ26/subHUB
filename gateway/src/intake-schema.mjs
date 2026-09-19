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

export const INTAKE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["create_subscription", "unknown"] },
    subscription: {
      type: "object", additionalProperties: false,
      properties: subscriptionProperties, required: INTAKE_FIELDS,
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    missingFields: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
  },
  required: ["intent", "subscription", "confidence", "missingFields", "riskFlags"],
};

function cleanString(value, maxLength) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export function normalizeIntakeResult(input) {
  if (!input || typeof input !== "object" || !["create_subscription", "unknown"].includes(input.intent)) {
    throw new Error("model_output_invalid");
  }
  const subscription = {};
  for (const field of INTAKE_FIELDS) {
    const value = input.subscription?.[field];
    if (value === null || value === undefined) continue;
    if (["serviceName", "providerName", "planName", "channel", "invoiceNumber"].includes(field)) subscription[field] = cleanString(value, 200);
    else if (["website", "invoiceUrl"].includes(field)) subscription[field] = cleanString(value, 1000);
    else if (field === "notes") subscription[field] = cleanString(value, 2000);
    else if (["renewsAt", "expiresAt"].includes(field)) subscription[field] = cleanString(value, 10);
    else if (field === "tags" && Array.isArray(value)) subscription.tags = [...new Set(value.map((tag) => cleanString(tag, 32)).filter(Boolean))].slice(0, 12);
    else subscription[field] = value;
  }
  return {
    intent: input.intent,
    subscription: Object.fromEntries(Object.entries(subscription).filter(([, value]) => value !== null)),
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    missingFields: Array.isArray(input.missingFields) ? input.missingFields.map((field) => cleanString(field, 80)).filter(Boolean) : [],
    riskFlags: Array.isArray(input.riskFlags) ? input.riskFlags.map((flag) => cleanString(flag, 120)).filter(Boolean) : [],
  };
}
