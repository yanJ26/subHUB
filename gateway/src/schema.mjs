export const ALLOWED_INTENTS = [
  "create_subscription",
  "update_subscription",
  "update_invoice",
  "archive_subscription",
  "query_subscriptions",
  "unknown",
];

export const MUTATION_INTENTS = new Set([
  "create_subscription",
  "update_subscription",
  "update_invoice",
  "archive_subscription",
]);

export const SUBSCRIPTION_FIELDS = [
  "name",
  "provider",
  "plan",
  "price",
  "currency",
  "billingCycle",
  "renewalDate",
  "channel",
  "loginDevice",
  "tags",
  "autoRenew",
  "invoiceStatus",
  "invoiceNumber",
  "invoiceUrl",
  "reminderDays",
  "notes",
];

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const nullableBoolean = { type: ["boolean", "null"] };

const subscriptionProperties = {
  name: nullableString,
  provider: nullableString,
  plan: nullableString,
  price: nullableNumber,
  currency: { type: ["string", "null"], enum: ["CNY", "USD", "EUR", null] },
  billingCycle: { type: ["string", "null"], enum: ["monthly", "yearly", null] },
  renewalDate: nullableString,
  channel: nullableString,
  loginDevice: nullableString,
  tags: { type: ["array", "null"], items: { type: "string" } },
  autoRenew: nullableBoolean,
  invoiceStatus: { type: ["string", "null"], enum: ["issued", "pending", "none", null] },
  invoiceNumber: nullableString,
  invoiceUrl: nullableString,
  reminderDays: nullableNumber,
  notes: nullableString,
};

const subscriptionObject = {
  type: "object",
  additionalProperties: false,
  properties: subscriptionProperties,
  required: SUBSCRIPTION_FIELDS,
};

export const INTAKE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ALLOWED_INTENTS },
    target: {
      type: "object",
      additionalProperties: false,
      properties: { name: nullableString },
      required: ["name"],
    },
    subscription: subscriptionObject,
    changes: subscriptionObject,
    confidence: { type: "number", minimum: 0, maximum: 1 },
    missingFields: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
  },
  required: ["intent", "target", "subscription", "changes", "confidence", "missingFields", "riskFlags"],
};

function cleanString(value, maxLength) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export function normalizeFields(input = {}) {
  const result = {};
  for (const key of SUBSCRIPTION_FIELDS) {
    const value = input[key];
    if (value === null || value === undefined) continue;
    if (["name", "provider", "plan", "channel", "loginDevice", "invoiceNumber"].includes(key)) result[key] = cleanString(value, 200);
    else if (key === "notes") result[key] = cleanString(value, 2000);
    else if (key === "invoiceUrl") result[key] = cleanString(value, 1000);
    else if (key === "renewalDate") result[key] = cleanString(value, 10);
    else if (key === "tags" && Array.isArray(value)) result[key] = [...new Set(value.map((tag) => cleanString(tag, 32)).filter(Boolean))].slice(0, 12);
    else result[key] = value;
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== null));
}

export function normalizeModelResult(input) {
  if (!input || typeof input !== "object" || !ALLOWED_INTENTS.includes(input.intent)) {
    throw new Error("model_output_invalid");
  }
  return {
    intent: input.intent,
    target: { name: cleanString(input.target?.name, 200) },
    subscription: normalizeFields(input.subscription),
    changes: normalizeFields(input.changes),
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    missingFields: Array.isArray(input.missingFields) ? input.missingFields.map((field) => cleanString(field, 80)).filter(Boolean) : [],
    riskFlags: Array.isArray(input.riskFlags) ? input.riskFlags.map((flag) => cleanString(flag, 120)).filter(Boolean) : [],
  };
}
