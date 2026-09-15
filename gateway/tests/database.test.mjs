import assert from "node:assert/strict";
import test from "node:test";
import { SubHubDatabase } from "../src/database.mjs";

function sampleWorkspace() {
  return {
    providers: [{ id: "p1", name: "OpenAI" }],
    catalog: [{ id: "i1", providerId: "p1", name: "Codex", description: "coding", roles: ["agent", "code"], models: ["GPT"], adoptionStatus: "active" }],
    entitlements: [{ id: "e1", itemId: "i1", label: "Plus", billingMode: "subscription", amount: 20, currency: "USD", billingCycle: "monthly", autoRenew: true, tags: ["核心"] }],
    tagDefinitions: [{ id: "t1", name: "核心", background: "#111111", color: "#ffffff", sortOrder: 0 }],
    invoices: [{ id: "inv1", entitlementId: "e1", status: "paid", number: "INV-1", amount: 20, currency: "USD" }],
    assets: [{ id: "asset1", kind: "device", name: "开发电脑", status: "active", deviceType: "desktop", os: "Windows" }],
    deployments: [{ id: "dep1", itemId: "i1", assetId: "asset1", name: "Codex Desktop", role: "primary", status: "online", runtime: "native" }],
    accessSurfaces: [{ id: "a1", itemId: "i1", name: "Desktop", kind: "desktop", assetId: "asset1", deploymentId: "dep1" }],
    usageLinks: [{ id: "u1", entitlementId: "e1", accessSurfaceId: "a1", assetId: "asset1", deploymentId: "dep1", label: "Windows" }],
    quotaPolicies: [{ id: "q1", entitlementId: "e1", label: "5h", metric: "percentage", windowType: "rolling_window", windowHours: 5 }],
    snapshots: [{ id: "s1", entitlementId: "e1", quotaPolicyId: "q1", observedAt: "2026-08-27T12:00:00.000Z", utilizationPercent: 80, sourceLabel: "网页快照" }],
    evaluations: [{ id: "v1", itemId: "i1", evaluatedAt: "2026-08-27", utilization: "high", outputValue: "core", quotaPressure: "normal", trend: "stable", recommendation: "continue", confidence: "medium", evidenceCount: 1, observationDays: 10 }],
    workRecords: [{ id: "w1", itemId: "i1", title: "完成迁移", occurredAt: "2026-08-27", sourceLabel: "agentHUB" }],
    legacyRefs: [{ sourceSystem: "apiHUB", entityType: "subscription", sourceId: "old-e1", targetType: "entitlement", targetId: "e1", sourceHash: "abc123", importedAt: "2026-08-27T12:00:00.000Z" }],
  };
}

test("workspace is stored in normalized tables and reconstructed", () => {
  const db = new SubHubDatabase(":memory:");
  try {
    const state = db.replaceWorkspace(sampleWorkspace());
    assert.equal(state.catalog[0].name, "Codex");
    assert.deepEqual(state.catalog[0].roles, ["agent", "code"]);
    assert.deepEqual(state.catalog[0].models, ["GPT"]);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM catalog_item_roles").get().n, 2);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM catalog_item_models").get().n, 1);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
    assert.equal(state.legacyRefs[0].sourceId, "old-e1");
    assert.equal(state.invoices[0].number, "INV-1");
    assert.equal(state.deployments[0].assetId, "asset1");
    assert.equal(state.workRecords[0].title, "完成迁移");

    db.addSnapshot({ entitlementId: "e1", observedAt: "2026-08-28T12:00:00.000Z", sourceLabel: "手工记录", remainingValue: 40 });
    assert.equal(db.getWorkspace().snapshots.length, 2);
    db.updateAdoptionStatus("i1", "paused");
    assert.equal(db.getWorkspace().catalog[0].adoptionStatus, "paused");
  } finally { db.close(); }
});

test("workspace replacement rejects stale revisions without changing data", () => {
  const db = new SubHubDatabase(":memory:");
  try {
    db.replaceWorkspace(sampleWorkspace(), { expectedRevision: 0 });
    assert.throws(() => db.replaceWorkspace({ ...sampleWorkspace(), catalog: [] }, { expectedRevision: 0 }), /revision_conflict/);
    assert.equal(db.getRevision(), 1);
    assert.equal(db.getWorkspace().catalog.length, 1);
  } finally { db.close(); }
});
