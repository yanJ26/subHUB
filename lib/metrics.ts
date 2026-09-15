import type { Entitlement, Evaluation, WorkspaceState } from "./domain";

export function monthlyEquivalent(entitlement: Entitlement, rates: Record<string, number> = { CNY: 1, USD: 7.1, EUR: 7.8, HKD: 0.91, GBP: 9.2, JPY: 0.048 }) {
  if (entitlement.amount === null || ["free", "trial", "bundled"].includes(entitlement.billingMode) || ["expired", "cancelled", "paused"].includes(entitlement.status || "active")) return 0;
  const monthly = entitlement.billingCycle === "yearly" ? entitlement.amount / 12 : entitlement.amount;
  return monthly * (rates[entitlement.currency] || 1);
}

export function daysUntil(value?: string, now = new Date()) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

export function nextEntitlementDate(entitlement: Entitlement) {
  const candidates = [entitlement.renewsAt, entitlement.expiresAt, entitlement.resetsAt].filter(Boolean) as string[];
  return candidates.sort()[0] || undefined;
}

export function latestEvaluation(itemId: string, evaluations: Evaluation[]) {
  return evaluations
    .filter((evaluation) => evaluation.itemId === itemId)
    .sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt))[0];
}

export function workspaceSummary(state: WorkspaceState) {
  const active = state.catalog.filter((item) => item.adoptionStatus === "active").length;
  const unused = state.catalog.filter((item) => item.adoptionStatus === "unused").length;
  const trial = state.catalog.filter((item) => item.adoptionStatus === "trial").length;
  const monthlyCost = state.entitlements.reduce((sum, entitlement) => sum + monthlyEquivalent(entitlement), 0);
  const upcoming = state.entitlements.filter((entitlement) => {
    const days = daysUntil(nextEntitlementDate(entitlement));
    return days !== null && days >= 0 && days <= 30;
  }).length;
  const pendingInvoices = state.invoices.filter((invoice) => invoice.status === "pending").length;
  const attentionAssets = state.assets.filter((asset) => ["attention", "expired", "offline"].includes(asset.status)).length;
  return { active, unused, trial, monthlyCost, upcoming, pendingInvoices, attentionAssets };
}

export function estimateUsagePace(entitlementId: string, state: WorkspaceState) {
  const rows = state.snapshots
    .filter((snapshot) => snapshot.entitlementId === entitlementId)
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows.at(-1)!;
  const observationDays = Math.max(1, Math.round((new Date(last.observedAt).getTime() - new Date(first.observedAt).getTime()) / 86_400_000));
  const confidence = observationDays >= 21 && rows.length >= 3 ? "high" : observationDays >= 7 ? "medium" : "low";

  if (first.remainingValue !== undefined && last.remainingValue !== undefined) {
    const consumed = first.remainingValue - last.remainingValue;
    if (consumed >= 0) {
      const monthlyEstimate = consumed / observationDays * 30;
      return { kind: "balance" as const, observationDays, evidenceCount: rows.length, confidence, monthlyEstimate, summary: `按 ${observationDays} 天消耗速度，30 天约使用 ${Math.round(monthlyEstimate * 10) / 10} 个原始额度单位` };
    }
  }
  if (first.usedValue !== undefined && last.usedValue !== undefined) {
    const consumed = last.usedValue - first.usedValue;
    if (consumed >= 0) {
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
