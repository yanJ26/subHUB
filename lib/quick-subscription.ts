import type {
  BillingMode, Currency, InvoiceStatus, ItemRole, WorkspaceState,
} from "./domain";

export type QuickSubscriptionDraft = {
  serviceName: string;
  providerName: string;
  role: ItemRole;
  website?: string;
  planName: string;
  billingMode: BillingMode;
  amount: number | null;
  currency: Currency;
  billingCycle: "monthly" | "yearly" | "none";
  renewsAt?: string;
  expiresAt?: string;
  autoRenew: boolean;
  reminderDays: number;
  channel?: string;
  tags: string[];
  notes?: string;
  invoiceStatus: InvoiceStatus;
  invoiceNumber?: string;
  invoiceUrl?: string;
};

type IdFactory = (prefix: string) => string;

function defaultId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function sameText(left: string, right: string) {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function optional(value: string | undefined) {
  return value?.trim() || undefined;
}

export function buildQuickSubscriptionWorkspace(
  state: WorkspaceState,
  draft: QuickSubscriptionDraft,
  createId: IdFactory = defaultId,
) {
  const serviceName = draft.serviceName.trim();
  const providerName = draft.providerName.trim() || serviceName;
  const providers = [...state.providers];
  let provider = providers.find((entry) => sameText(entry.name, providerName));
  if (!provider) {
    provider = { id: createId("provider"), name: providerName };
    providers.push(provider);
  }

  const catalog = state.catalog.map((entry) => ({ ...entry, roles: [...entry.roles], models: [...entry.models] }));
  let item = catalog.find((entry) => entry.providerId === provider.id && sameText(entry.name, serviceName));
  if (item) {
    item.roles = [...new Set([...item.roles, draft.role])];
    if (!item.website && optional(draft.website)) item.website = optional(draft.website);
    if (item.adoptionStatus === "retired" || item.adoptionStatus === "unused") item.adoptionStatus = draft.billingMode === "trial" ? "trial" : "active";
    item.lastReviewedAt = new Date().toISOString().slice(0, 10);
  } else {
    item = {
      id: createId("item"), providerId: provider.id, name: serviceName,
      description: `${serviceName} 的订阅或使用服务`, roles: [draft.role], models: [],
      adoptionStatus: draft.billingMode === "trial" ? "trial" : "active",
      ...(optional(draft.website) ? { website: optional(draft.website) } : {}),
      lastReviewedAt: new Date().toISOString().slice(0, 10),
    };
    catalog.push(item);
  }

  const entitlementId = createId("entitlement");
  const entitlement = {
    id: entitlementId, itemId: item.id, label: draft.planName.trim() || "订阅方案",
    billingMode: draft.billingMode, amount: draft.amount, currency: draft.currency,
    billingCycle: draft.billingCycle,
    status: draft.billingMode === "trial" ? "trial" as const : "active" as const,
    ...(optional(draft.renewsAt) ? { renewsAt: optional(draft.renewsAt) } : {}),
    ...(optional(draft.expiresAt) ? { expiresAt: optional(draft.expiresAt) } : {}),
    autoRenew: draft.autoRenew,
    ...(optional(draft.channel) ? { channel: optional(draft.channel) } : {}),
    reminderDays: draft.reminderDays,
    tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))],
    ...(optional(draft.notes) ? { notes: optional(draft.notes) } : {}),
  };

  const shouldCreateInvoice = draft.invoiceStatus !== "none" || Boolean(optional(draft.invoiceNumber) || optional(draft.invoiceUrl));
  const invoices = shouldCreateInvoice ? [...state.invoices, {
    id: createId("invoice"), entitlementId, status: draft.invoiceStatus,
    ...(optional(draft.invoiceNumber) ? { number: optional(draft.invoiceNumber) } : {}),
    ...(optional(draft.invoiceUrl) ? { url: optional(draft.invoiceUrl) } : {}),
    ...(draft.amount !== null ? { amount: draft.amount, currency: draft.currency } : {}),
  }] : state.invoices;

  return {
    workspace: { ...state, providers, catalog, entitlements: [...state.entitlements, entitlement], invoices },
    itemId: item.id,
    entitlementId,
  };
}
