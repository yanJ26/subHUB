import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceState } from "../lib/domain.ts";
import { buildQuickSubscriptionWorkspace, type QuickSubscriptionDraft } from "../lib/quick-subscription.ts";

const emptyWorkspace: WorkspaceState = {
  providers: [], catalog: [], entitlements: [], invoices: [], tagDefinitions: [], assets: [],
  deployments: [], accessSurfaces: [], usageLinks: [], quotaPolicies: [], snapshots: [],
  evaluations: [], workRecords: [], legacyRefs: [],
};

const draft: QuickSubscriptionDraft = {
  serviceName: "Codex", providerName: "OpenAI", role: "developer_tool", planName: "Pro",
  billingMode: "subscription", amount: 20, currency: "USD", billingCycle: "monthly",
  renewsAt: "2026-10-01", autoRenew: true, reminderDays: 7,
  channel: "官网", tags: ["主力"], invoiceStatus: "pending",
};

function ids() {
  let sequence = 0;
  return (prefix: string) => `${prefix}-${sequence += 1}`;
}

test("quick subscription creates provider, catalog, entitlement, and invoice in one workspace", () => {
  const result = buildQuickSubscriptionWorkspace(emptyWorkspace, draft, ids()).workspace;
  assert.equal(result.providers.length, 1);
  assert.equal(result.catalog.length, 1);
  assert.equal(result.entitlements.length, 1);
  assert.equal(result.invoices.length, 1);
  assert.equal(result.catalog[0].providerId, result.providers[0].id);
  assert.equal(result.entitlements[0].itemId, result.catalog[0].id);
  assert.equal(result.invoices[0].entitlementId, result.entitlements[0].id);
  assert.equal(result.entitlements[0].renewsAt, "2026-10-01");
  assert.equal(result.entitlements[0].expiresAt, "2026-10-01");
});

test("quick subscription reuses an existing provider and catalog item without losing roles", () => {
  const initial = buildQuickSubscriptionWorkspace(emptyWorkspace, { ...draft, invoiceStatus: "none" }, ids()).workspace;
  const result = buildQuickSubscriptionWorkspace(initial, {
    ...draft, serviceName: " codex ", providerName: "openai", role: "agent", planName: "Team", invoiceStatus: "none",
  }, ids()).workspace;
  assert.equal(result.providers.length, 1);
  assert.equal(result.catalog.length, 1);
  assert.equal(result.entitlements.length, 2);
  assert.deepEqual(new Set(result.catalog[0].roles), new Set(["developer_tool", "agent"]));
});
