import assert from "node:assert/strict";
import test from "node:test";
import type { Entitlement, WorkspaceState } from "../lib/domain.ts";
import { daysUntil, estimateUsagePace, lifecycleEvents, monthlyEquivalent, nextEntitlementDate, workspaceSummary } from "../lib/metrics.ts";

const baseEntitlement: Entitlement = {
  id: "e1", itemId: "i1", label: "Plan", billingMode: "subscription", amount: 120,
  currency: "CNY", billingCycle: "yearly", autoRenew: true, status: "active",
};

const emptyWorkspace: WorkspaceState = {
  providers: [], catalog: [], entitlements: [], invoices: [], tagDefinitions: [], assets: [], deployments: [],
  accessSurfaces: [], usageLinks: [], quotaPolicies: [], snapshots: [], evaluations: [], workRecords: [], legacyRefs: [],
};

test("fixed monthly cost excludes non-recurring spend and reports unknown recurring prices", () => {
  assert.equal(monthlyEquivalent(baseEntitlement, { CNY: 1 }), 10);
  assert.equal(monthlyEquivalent({ ...baseEntitlement, billingMode: "one_time", billingCycle: "none" }, { CNY: 1 }), 0);
  assert.equal(monthlyEquivalent({ ...baseEntitlement, amount: null }, { CNY: 1 }), null);
  assert.equal(monthlyEquivalent({ ...baseEntitlement, currency: "USD" }, { CNY: 1, USD: 7 }), 70);
  assert.equal(monthlyEquivalent({ ...baseEntitlement, currency: "GBP" }, { CNY: 1 }), null);

  const summary = workspaceSummary({ ...emptyWorkspace, entitlements: [baseEntitlement, { ...baseEntitlement, id: "e2", amount: null }] }, { CNY: 1 });
  assert.equal(summary.monthlyCost, 10);
  assert.equal(summary.unpricedRecurring, 1);
});

test("calendar dates treat today as zero and quota reset never hides renewal", () => {
  assert.equal(daysUntil("2026-09-15", new Date("2026-09-15T23:59:59-04:00")), 0);
  assert.equal(daysUntil("2026-09-16", new Date("2026-09-15T12:00:00-04:00")), 1);
  assert.equal(nextEntitlementDate({ ...baseEntitlement, renewsAt: "2099-10-01", expiresAt: "2099-12-01", resetsAt: "2020-01-01" }), "2099-10-01");
  const events = lifecycleEvents({ ...emptyWorkspace, entitlements: [{ ...baseEntitlement, renewsAt: "2026-09-15", resetsAt: "2020-01-01" }], assets: [{ id: "a1", kind: "domain", name: "example.com", status: "active", expiresAt: "2026-09-16" }] }, new Date("2026-09-15T12:00:00-04:00"));
  assert.deepEqual(events.map((entry) => [entry.kind, entry.days]), [["renewal", 0], ["asset_expiry", 1]]);
});

test("usage pace never combines quota policies, units, or reset-like increases", () => {
  const snapshots = [
    { id: "s1", entitlementId: "e1", quotaPolicyId: "q1", observedAt: "2026-09-01T00:00:00.000Z", remainingValue: 100, sourceLabel: "manual" },
    { id: "s2", entitlementId: "e1", quotaPolicyId: "q2", observedAt: "2026-09-10T00:00:00.000Z", remainingValue: 50, sourceLabel: "manual" },
  ];
  assert.equal(estimateUsagePace("e1", { ...emptyWorkspace, snapshots }), null);
  assert.equal(estimateUsagePace("e1", { ...emptyWorkspace, snapshots: [{ ...snapshots[0], quotaPolicyId: "q1" }, { ...snapshots[1], quotaPolicyId: "q1", usedValue: 50, remainingValue: undefined }] }), null);
  assert.equal(estimateUsagePace("e1", { ...emptyWorkspace, snapshots: [{ ...snapshots[0], quotaPolicyId: "q1", remainingValue: 50 }, { ...snapshots[1], quotaPolicyId: "q1", remainingValue: 100 }] }), null);
});
