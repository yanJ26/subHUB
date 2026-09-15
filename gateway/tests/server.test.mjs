import assert from "node:assert/strict";
import test from "node:test";
import { createGateway } from "../src/server.mjs";

const emptyWorkspace = {
  providers: [], catalog: [], entitlements: [], invoices: [], tagDefinitions: [], assets: [],
  deployments: [], accessSurfaces: [], usageLinks: [], quotaPolicies: [], snapshots: [],
  evaluations: [], workRecords: [], legacyRefs: [],
};

function manualWorkspace() {
  return {
    ...structuredClone(emptyWorkspace),
    providers: [{ id: "manual-provider", name: "Manual" }],
    catalog: [{ id: "manual-item", providerId: "manual-provider", name: "Current record", description: "", roles: ["other"], models: [], adoptionStatus: "active" }],
  };
}

async function withGateway(run) {
  const gateway = createGateway({ host: "127.0.0.1", port: 0, dbPath: ":memory:", webInternalToken: "test-token", maxBodyBytes: 100_000 });
  const address = await gateway.listen();
  try { await run(`http://127.0.0.1:${address.port}`, gateway); }
  finally { await gateway.close(); }
}

const ownerHeaders = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

test("gateway protects owner routes, validates full restores, and never trusts audit summaries", async () => {
  await withGateway(async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/v1/web/state`)).status, 401);

    const imported = await fetch(`${base}/v1/web/import`, {
      method: "POST", headers: ownerHeaders,
      body: JSON.stringify({ backup: { product: "subHUB", schemaVersion: 1, workspace: emptyWorkspace }, expectedRevision: 0 }),
    });
    assert.equal(imported.status, 200);

    const incomplete = await fetch(`${base}/v1/web/state`, {
      method: "PUT", headers: ownerHeaders, body: JSON.stringify({ workspace: {}, expectedRevision: 1 }),
    });
    assert.equal(incomplete.status, 400);

    const rejected = await fetch(`${base}/v1/web/import`, {
      method: "POST", headers: ownerHeaders,
      body: JSON.stringify({ backup: { product: "subHUB", schemaVersion: 1, workspace: { ...emptyWorkspace, providers: [{ id: "p", name: "x", apiKey: "should-never-be-here" }] } }, expectedRevision: 1 }),
    });
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json()).error, "likely_secret_detected");

    const saved = await fetch(`${base}/v1/web/state`, {
      method: "PUT", headers: ownerHeaders,
      body: JSON.stringify({ workspace: manualWorkspace(), expectedRevision: 1, summary: "password: this-should-never-be-logged" }),
    });
    assert.equal(saved.status, 200);
    const audit = await (await fetch(`${base}/v1/web/audit`, { headers: ownerHeaders })).json();
    assert.equal(audit.auditLogs.some((entry) => entry.summary.includes("this-should-never-be-logged")), false);
    const state = await (await fetch(`${base}/v1/web/state`, { headers: ownerHeaders })).json();
    assert.equal(state.revision, 2);
    assert.equal(state.workspace.catalog.length, 1);
  });
});
test("migration preview is bound to source content and revision and preserves existing data", async () => {
  await withGateway(async (base) => {
    const initial = await fetch(`${base}/v1/web/state`, { method: "PUT", headers: ownerHeaders, body: JSON.stringify({ workspace: manualWorkspace(), expectedRevision: 0 }) });
    assert.equal(initial.status, 200);
    const apiHub = { subscriptions: [{ id: "legacy", name: "Legacy record", provider: "Legacy vendor", plan: "API", price: 10, currency: "USD", billingCycle: "monthly", autoRenew: false }] };
    const previewResponse = await fetch(`${base}/v1/web/migration/preview`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ apiHub }) });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.workspace.catalog.some((entry) => entry.id === "manual-item"), true);
    assert.equal(preview.targetRevision, 1);

    const mismatch = await fetch(`${base}/v1/web/migration/commit`, {
      method: "POST", headers: ownerHeaders,
      body: JSON.stringify({ apiHub: { subscriptions: [] }, expectedRevision: 1, previewToken: preview.previewToken, conflictResolutions: {} }),
    });
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).error, "migration_preview_mismatch");

    const committed = await fetch(`${base}/v1/web/migration/commit`, {
      method: "POST", headers: ownerHeaders,
      body: JSON.stringify({ apiHub, expectedRevision: 1, previewToken: preview.previewToken, conflictResolutions: {} }),
    });
    assert.equal(committed.status, 200);
    const result = await committed.json();
    assert.equal(result.workspace.catalog.some((entry) => entry.id === "manual-item"), true);
    assert.equal(result.workspace.catalog.some((entry) => entry.name === "Legacy record"), true);
  });
});

test("business backup restore requires a matching preview", async () => {
  await withGateway(async (base) => {
    await fetch(`${base}/v1/web/state`, { method: "PUT", headers: ownerHeaders, body: JSON.stringify({ workspace: manualWorkspace(), expectedRevision: 0 }) });
    const backup = await (await fetch(`${base}/v1/web/backup`, { headers: ownerHeaders })).json();
    await fetch(`${base}/v1/web/state`, { method: "PUT", headers: ownerHeaders, body: JSON.stringify({ workspace: emptyWorkspace, expectedRevision: 1 }) });

    const preview = await (await fetch(`${base}/v1/web/restore/preview`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ backup }) })).json();
    const mismatch = await fetch(`${base}/v1/web/restore/commit`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ backup, expectedRevision: 2, restoreToken: "wrong" }) });
    assert.equal(mismatch.status, 409);
    const restored = await fetch(`${base}/v1/web/restore/commit`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ backup, expectedRevision: preview.targetRevision, restoreToken: preview.restoreToken }) });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).workspace.catalog[0].name, "Current record");
  });
});

test("internal login reservations cap concurrent attempts", async () => {
  await withGateway(async (base) => {
    const responses = await Promise.all(Array.from({ length: 11 }, () => fetch(`${base}/v1/internal/login-attempts/reserve`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({ clientKey: "owner" }),
    }).then((response) => response.json())));
    assert.equal(responses.filter((entry) => entry.allowed).length, 10);
    assert.equal(responses.filter((entry) => entry.allowed === false).length, 1);
  });
});

test("gateway rejects structurally excessive JSON with a stable error", async () => {
  await withGateway(async (base) => {
    let nested = {};
    for (let depth = 0; depth < 42; depth += 1) nested = { child: nested };
    const response = await fetch(`${base}/v1/web/state`, {
      method: "PUT", headers: ownerHeaders, body: JSON.stringify(nested),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "request_too_complex");
  });
});
