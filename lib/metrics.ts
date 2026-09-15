import type { Entitlement, Evaluation, ExchangeRateSnapshot, WorkspaceState } from "./domain";

export const defaultExchangeRates: ExchangeRateSnapshot = {
  rates: { CNY: 1, USD: 6.7714, EUR: 7.6969 }, rateDate: "2026-07-28", source: "built_in",
};

export function monthlyEquivalent(entitlement: Entitlement, rates: ExchangeRateSnapshot["rates"] = defaultExchangeRates.rates) {
  if (["expired", "cancelled", "paused"].includes(entitlement.status || "active")) return 0;
  if (!["subscription", "self_hosted", "hybrid"].includes(entitlement.billingMode) || entitlement.billingCycle === "none") return 0;
  const amount = entitlement.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const rate = rates[entitlement.currency];
  if (!Number.isFinite(rate)) return null;
  const monthly = entitlement.billingCycle === "yearly" ? amount / 12 : amount;
  return monthly * Number(rate);
}

export function daysUntil(value?: string, now = new Date()) {
  if (!value) return null;
  const match = value.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export function nextEntitlementDate(entitlement: Entitlement) {
  const candidates = [entitlement.renewsAt, entitlement.expiresAt].filter(Boolean) as string[];
  const future = candidates.filter((date) => (daysUntil(date) ?? -1) >= 0).sort();
  if (future.length) return future[0];
  return candidates.sort().at(-1);
}

export function lifecycleEvents(state: WorkspaceState, now = new Date()) {
  const events: Array<{ id: string; itemId?: string; label: string; date: string; kind: "renewal" | "entitlement_expiry" | "asset_expiry"; days: number }> = [];
  for (const entitlement of state.entitlements) {
    if (["cancelled", "expired"].includes(entitlement.status || "active")) continue;
    for (const [kind, date] of [["renewal", entitlement.renewsAt], ["entitlement_expiry", entitlement.expiresAt]] as const) {
      const days = daysUntil(date, now);
      if (date && days !== null && days >= 0) events.push({ id: `${entitlement.id}:${kind}`, itemId: entitlement.itemId, label: entitlement.label, date, kind, days });
    }
  }
  for (const asset of state.assets) {
    if (["retired", "expired"].includes(asset.status)) continue;
    const days = daysUntil(asset.expiresAt, now);
    if (asset.expiresAt && days !== null && days >= 0) events.push({ id: `${asset.id}:asset_expiry`, ...(asset.itemId ? { itemId: asset.itemId } : {}), label: asset.domainName || asset.name, date: asset.expiresAt, kind: "asset_expiry", days });
  }
  const unique = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const key = `${event.itemId || event.label.toLocaleLowerCase()}\u0000${event.date}`;
    const current = unique.get(key);
    if (!current || current.kind === "asset_expiry") unique.set(key, event);
  }
  return [...unique.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function latestEvaluation(itemId: string, evaluations: Evaluation[]) {
  return evaluations
    .filter((evaluation) => evaluation.itemId === itemId)
    .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt))[0];
}

export function workspaceSummary(state: WorkspaceState, rates: ExchangeRateSnapshot["rates"] = defaultExchangeRates.rates) {
  const active = state.catalog.filter((item) => item.adoptionStatus === "active").length;
  const unused = state.catalog.filter((item) => item.adoptionStatus === "unused").length;
  const trial = state.catalog.filter((item) => item.adoptionStatus === "trial").length;
  let monthlyCost = 0;
  let unpricedRecurring = 0;
  for (const entitlement of state.entitlements) {
    const amount = monthlyEquivalent(entitlement, rates);
    if (amount === null) unpricedRecurring += 1;
    else monthlyCost += amount;
  }
  const upcoming = lifecycleEvents(state).filter((event) => event.days <= 30).length;
  const pendingInvoices = state.invoices.filter((invoice) => invoice.status === "pending").length;
  const attentionAssets = state.assets.filter((asset) => ["attention", "expired", "offline"].includes(asset.status)).length;
  return { active, unused, trial, monthlyCost, unpricedRecurring, upcoming, pendingInvoices, attentionAssets };
}

export function estimateUsagePace(entitlementId: string, state: WorkspaceState) {
  const rows = state.snapshots
    .filter((snapshot) => snapshot.entitlementId === entitlementId)
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  if (rows.length < 2) return null;
  const policyKeys = new Set(rows.map((row) => row.quotaPolicyId || "unassigned"));
  if (policyKeys.size !== 1) return null;
  const measurementKinds = new Set(rows.flatMap((row) => [
    row.remainingValue !== undefined ? "remaining" : null,
    row.usedValue !== undefined ? "used" : null,
    row.utilizationPercent !== undefined ? "percentage" : null,
  ].filter(Boolean)));
  if (measurementKinds.size !== 1) return null;
  const first = rows[0];
  const last = rows.at(-1)!;
  const observationDays = Math.max(1, Math.round((new Date(last.observedAt).getTime() - new Date(first.observedAt).getTime()) / 86_400_000));
  const confidence = observationDays >= 21 && rows.length >= 3 ? "high" : observationDays >= 7 ? "medium" : "low";

  if (first.remainingValue !== undefined && last.remainingValue !== undefined) {
    const consumed = first.remainingValue - last.remainingValue;
    if (consumed > 0) {
      const monthlyEstimate = consumed / observationDays * 30;
      return { kind: "balance" as const, observationDays, evidenceCount: rows.length, confidence, monthlyEstimate, summary: `按 ${observationDays} 天消耗速度，30 天约使用 ${Math.round(monthlyEstimate * 10) / 10} 个原始额度单位` };
    }
  }
  if (first.usedValue !== undefined && last.usedValue !== undefined) {
    const consumed = last.usedValue - first.usedValue;
    if (consumed > 0) {
      const monthlyEstimate = consumed / observationDays * 30;
      return { kind: "cumulative" as const, observationDays, evidenceCount: rows.length, confidence, monthlyEstimate, summary: `按 ${observationDays} 天增长速度，30 天约使用 ${Math.round(monthlyEstimate * 10) / 10} 个原始额度单位` };
    }
  }
  const percentages = rows.map((row) => row.utilizationPercent).filter((value): value is number => value !== undefined);
  if (percentages.length >= 2) {
    const average = percentages.reduce((sum, value) => sum + value, 0) / percentages.length;
    return { kind: "window" as const, observationDays, evidenceCount: rows.length, confidence, average, summary: `不同重置窗口平均利用率约 ${Math.round(average)}%；不强行折算为月度 Token` };
  }
  return null;
}
