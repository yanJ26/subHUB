import assert from "node:assert/strict";
import test from "node:test";
import { SubHubDatabase } from "../src/database.mjs";
import { previewLegacyMigration } from "../src/migration.mjs";

const apiHub = { subscriptions: [{
  id: "sub_codex", name: "Codex", provider: "OpenAI", plan: "ChatGPT Plus", price: 20,
  currency: "USD", billingCycle: "monthly", renewalDate: "2026-09-01", channel: "官网",
  loginDevice: "Windows", tags: ["Agent"], autoRenew: true, archived: false, notes: "",
  reminderDays: 14, invoiceStatus: "issued", invoiceNumber: "INV-001", invoiceUrl: "https://example.com/invoice.pdf",
}] };

const agentHub = {
  version: 3,
  agents: [{ id: "agent_codex", name: "Codex", provider: "OpenAI", description: "coding", status: "primary", useCases: ["开发"], activity: [{ period: "2026-08", level: 3, note: "主力" }], subscription: { mode: "subscription", plan: "Plus", amount: 20, currency: "USD", billingCycle: "monthly", renewalDate: "2026-09-01", autoRenew: true } }],
  devices: [{ id: "dev1", name: "开发电脑", type: "desktop", os: "Windows" }],
  deployments: [{ id: "dep1", name: "Codex Desktop", agentId: "agent_codex", deviceId: "dev1", role: "primary", status: "online" }],
  accessRoutes: [{ id: "route1", agentId: "agent_codex", deploymentId: "dep1", clientDeviceId: "dev1", kind: "desktop", app: "Codex", status: "available" }],
};

test("migration merges roles but blocks ambiguous duplicate entitlements", () => {
  const result = previewLegacyMigration({ apiHub, agentHub });
  assert.equal(result.workspace.catalog.length, 1);
  assert.deepEqual([...result.workspace.catalog[0].roles].sort(), ["agent", "api", "app", "model", "platform"]);
  assert.equal(result.workspace.entitlements.length, 1);
  assert.equal(result.workspace.entitlements[0].reminderDays, 14);
  assert.deepEqual(result.workspace.entitlements[0].tags, ["Agent"]);
  assert.equal(result.workspace.invoices[0].number, "INV-001");
  assert.equal(result.workspace.accessSurfaces.length, 3);
  assert.equal(result.workspace.assets.length, 2);
  assert.equal(result.workspace.deployments[0].assetId.startsWith("asset_"), true);
  assert.equal(result.workspace.snapshots.length, 1);
  assert.equal(result.workspace.legacyRefs.length > 0, true);
  assert.equal(result.conflicts.some((item) => item.code === "duplicate_entitlement"), true);
  assert.equal(result.canCommit, false);
});

test("single-project migration is committable", () => {
  const result = previewLegacyMigration({ apiHub });
  assert.equal(result.canCommit, true);
  assert.equal(result.stats.catalogItems, 1);
  assert.equal(result.workspace.usageLinks.length, 1);
});

test("an Agent record without commercial details does not create a fake entitlement", () => {
  const result = previewLegacyMigration({ agentHub: {
    version: 3,
    agents: [{ id: "workbuddy", name: "WorkBuddy", provider: "WorkBuddy", status: "active", subscription: { mode: "unknown", amount: null }, activity: [{ period: "2026-08", level: 2, note: "普通使用" }] }],
    devices: [], deployments: [], accessRoutes: [],
  } });
  assert.equal(result.workspace.catalog.length, 1);
  assert.deepEqual(result.workspace.catalog[0].roles, ["agent", "app"]);
  assert.equal(result.workspace.entitlements.length, 0);
  assert.equal(result.workspace.snapshots.length, 0);
  assert.equal(result.workspace.workRecords.length, 1);
  assert.equal(result.workspace.workRecords[0].sourceLabel, "agentHUB");
});

test("buddyHUB relationships are remapped to canonical subHUB ids and remain committable", () => {
  const buddyHub = { workspace: {
    providers: [{ id: "bp1", name: "OpenAI" }],
    catalog: [{ id: "bi1", providerId: "bp1", name: "Codex", description: "编程", roles: ["agent", "code"], models: ["GPT"], adoptionStatus: "active" }],
    entitlements: [{ id: "be1", itemId: "bi1", label: "ChatGPT 方案", billingMode: "subscription", amount: 20, currency: "USD", billingCycle: "monthly", autoRenew: true }],
    assets: [{ id: "ba1", kind: "device", name: "备用电脑", status: "active", deviceType: "desktop" }],
    deployments: [{ id: "bd1", itemId: "bi1", assetId: "ba1", name: "Codex CLI", role: "secondary", status: "online" }],
    accessSurfaces: [{ id: "bs1", itemId: "bi1", name: "CLI", kind: "cli", assetId: "ba1", deploymentId: "bd1" }],
    usageLinks: [{ id: "bl1", entitlementId: "be1", consumerItemId: "bi1", accessSurfaceId: "bs1", assetId: "ba1", deploymentId: "bd1", label: "备用开发" }],
    quotaPolicies: [{ id: "bq1", entitlementId: "be1", label: "5h 窗口", metric: "percentage", windowType: "rolling_window", windowHours: 5 }],
    snapshots: [{ id: "bss1", entitlementId: "be1", quotaPolicyId: "bq1", observedAt: "2026-09-01T12:00:00.000Z", utilizationPercent: 70, sourceLabel: "buddyHUB 快照" }],
    evaluations: [{ id: "bev1", itemId: "bi1", evaluatedAt: "2026-09-01", utilization: "high", outputValue: "core", quotaPressure: "normal", trend: "stable", recommendation: "continue", confidence: "medium", evidenceCount: 2, observationDays: 20 }],
    workRecords: [{ id: "bw1", itemId: "bi1", title: "交付功能", occurredAt: "2026-09-01" }],
  } };
  const result = previewLegacyMigration({ apiHub, buddyHub });
  const entitlement = result.workspace.entitlements[0];
  const snapshot = result.workspace.snapshots.find((entry) => entry.sourceLabel === "buddyHUB 快照");
  const quota = result.workspace.quotaPolicies[0];
  const link = result.workspace.usageLinks.find((entry) => entry.label === "备用开发");
  assert.equal(result.workspace.entitlements.length, 1);
  assert.equal(snapshot.entitlementId, entitlement.id);
  assert.equal(snapshot.quotaPolicyId, quota.id);
  assert.equal(quota.entitlementId, entitlement.id);
  assert.equal(link.entitlementId, entitlement.id);
  assert.notEqual(snapshot.entitlementId, "be1");
  assert.equal(result.workspace.legacyRefs.some((entry) => entry.sourceSystem === "buddyHUB" && entry.sourceId === "bss1" && entry.targetId === snapshot.id), true);

  const db = new SubHubDatabase(":memory:");
  try {
    const stored = db.replaceWorkspace(result.workspace);
    assert.equal(stored.snapshots[0].entitlementId, entitlement.id);
    assert.equal(stored.deployments[0].assetId, result.workspace.assets.find((entry) => entry.name === "备用电脑").id);
    assert.equal(stored.legacyRefs.length, result.workspace.legacyRefs.length);
  } finally { db.close(); }
});
