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

async function withGateway(run, { config: configOverrides = {}, parseIntake } = {}) {
  const gateway = createGateway({
    host: "127.0.0.1", port: 0, dbPath: ":memory:", webInternalToken: "test-token", maxBodyBytes: 100_000,
    modelBaseUrl: "https://models.example/v1", modelApiKey: "", model: "", confidenceThreshold: 0.85, intakeTtlMinutes: 15,
    ...configOverrides,
  }, undefined, { ...(parseIntake ? { parseIntake } : {}) });
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

test("natural-language intake previews and atomically commits a complete subscription", async () => {
  const parsed = {
    intent: "create_subscription",
    subscription: {
      serviceName: "Qoder", providerName: "Alibaba", role: "developer_tool", planName: "Pro",
      billingMode: "subscription", amount: 20, currency: "USD", billingCycle: "monthly",
      renewsAt: "2026-10-18", expiresAt: "2026-11-18", autoRenew: true, reminderDays: 7,
      channel: "官网信用卡", tags: [], invoiceStatus: "none",
    },
    confidence: 0.98, missingFields: [], riskFlags: [],
  };
  await withGateway(async (base, gateway) => {
    const message = "新增 Qoder Pro，每月 20 美元，10 月 18 日续费，11 月 18 日到期";
    const previewResponse = await fetch(`${base}/v1/web/intake`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ message }) });
    assert.equal(previewResponse.status, 201);
    const preview = await previewResponse.json();
    assert.equal(preview.status, "pending_confirmation");
    assert.match(preview.draft.summary, /Qoder/);
    assert.equal(gateway.db.getWorkspace().entitlements.length, 0);
    const stored = gateway.db.db.prepare("SELECT message_hash, payload_json FROM intake_drafts WHERE id = ?").get(preview.draft.id);
    assert.equal(JSON.stringify(stored).includes(message), false);

    const commitResponse = await fetch(`${base}/v1/web/intake/drafts/${preview.draft.id}/commit`, { method: "POST", headers: ownerHeaders, body: "{}" });
    assert.equal(commitResponse.status, 200);
    const committed = await commitResponse.json();
    assert.equal(committed.workspace.catalog[0].name, "Qoder");
    assert.equal(committed.workspace.entitlements[0].renewsAt, "2026-10-18");
    assert.equal(committed.workspace.entitlements[0].expiresAt, "2026-11-18");
    assert.equal(gateway.db.getIntakeDraft(preview.draft.id).status, "committed");
    assert.equal(gateway.db.getAuditLogs(10)[0].actor, "intake:owner");
  }, { config: { modelApiKey: "test-key", model: "test-model" }, parseIntake: async () => parsed });
});

test("natural-language intake records an unsubscribed service without creating an entitlement", async () => {
  const parsed = {
    intent: "create_service", target: null,
    subscription: { serviceName: "Kimi", providerName: "Moonshot AI", role: "chat", adoptionStatus: "active", notes: "偶尔使用" },
    changes: {}, confidence: 0.98, missingFields: [], riskFlags: [],
  };
  await withGateway(async (base) => {
    const previewResponse = await fetch(`${base}/v1/web/intake`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ message: "把 Kimi 列进来，我没有订阅，只是偶尔使用" }) });
    assert.equal(previewResponse.status, 201);
    const preview = await previewResponse.json();
    assert.equal(preview.draft.payload.op, "create_service");
    assert.match(preview.draft.summary, /未订阅/);

    const commitResponse = await fetch(`${base}/v1/web/intake/drafts/${preview.draft.id}/commit`, { method: "POST", headers: ownerHeaders, body: "{}" });
    assert.equal(commitResponse.status, 200);
    const committed = await commitResponse.json();
    assert.equal(committed.op, "create_service");
    assert.equal(committed.workspace.catalog[0].name, "Kimi");
    assert.equal(committed.workspace.catalog[0].adoptionStatus, "active");
    assert.equal(committed.workspace.entitlements.length, 0);
  }, { config: { modelApiKey: "test-key", model: "test-model" }, parseIntake: async () => parsed });
});

test("natural-language intake updates an existing subscription in place", async () => {
  const seed = {
    providers: [{ id: "p1", name: "OpenAI" }],
    catalog: [{ id: "i1", providerId: "p1", name: "Codex", description: "", roles: ["agent"], models: [], adoptionStatus: "active" }],
    entitlements: [{ id: "e1", itemId: "i1", label: "Plus", billingMode: "subscription", amount: 20, currency: "USD", billingCycle: "monthly", status: "active", expiresAt: "2026-09-08", autoRenew: true, reminderDays: 7, tags: [] }],
    tagDefinitions: [], invoices: [], assets: [], deployments: [], accessSurfaces: [], usageLinks: [], quotaPolicies: [], snapshots: [], evaluations: [], workRecords: [], legacyRefs: [],
  };
  const updateParsed = { intent: "update_subscription", target: "Codex", subscription: {}, changes: { expiresAt: "2026-10-17" }, confidence: 0.95, missingFields: [], riskFlags: [] };
  await withGateway(async (base) => {
    await fetch(`${base}/v1/web/state`, { method: "PUT", headers: ownerHeaders, body: JSON.stringify({ workspace: seed, expectedRevision: 0 }) });
    const previewResponse = await fetch(`${base}/v1/web/intake`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ message: "Codex 的到期时间改为 10 月 17 日" }) });
    assert.equal(previewResponse.status, 201);
    const preview = await previewResponse.json();
    assert.equal(preview.status, "pending_confirmation");
    assert.match(preview.draft.summary, /修改订阅：Codex/);
    const commitResponse = await fetch(`${base}/v1/web/intake/drafts/${preview.draft.id}/commit`, { method: "POST", headers: ownerHeaders, body: "{}" });
    assert.equal(commitResponse.status, 200);
    const committed = await commitResponse.json();
    assert.equal(committed.op, "update");
    assert.equal(committed.workspace.entitlements.length, 1);
    assert.equal(committed.workspace.entitlements[0].id, "e1");
    assert.equal(committed.workspace.entitlements[0].expiresAt, "2026-10-17");
    assert.equal(committed.workspace.entitlements[0].label, "Plus");
  }, { config: { modelApiKey: "test-key", model: "test-model" }, parseIntake: async () => updateParsed });
});

test("natural-language intake rejects likely secrets before the model is called", async () => {
  let called = false;
  await withGateway(async (base) => {
    const response = await fetch(`${base}/v1/web/intake`, {
      method: "POST", headers: ownerHeaders,
      body: JSON.stringify({ message: "新增订阅，api_key=sk-abcdefghijklmnopqrstuvwxyz123456" }),
    });
    assert.equal(response.status, 422);
    assert.equal(called, false);
  }, { config: { modelApiKey: "test-key", model: "test-model" }, parseIntake: async () => { called = true; return {}; } });
});

test("natural-language policy rechecks the latest workspace after the model call", async () => {
  let gatewayRef;
  const parsed = {
    intent: "create_subscription",
    subscription: { serviceName: "Codex", providerName: "OpenAI", planName: "Pro" },
    confidence: 0.99, missingFields: [], riskFlags: [],
  };
  await withGateway(async (base, gateway) => {
    gatewayRef = gateway;
    const response = await fetch(`${base}/v1/web/intake`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({ message: "新增 Codex Pro" }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, "needs_clarification");
    assert.equal(result.issues.some((entry) => entry.code === "possible_duplicate"), true);
    assert.equal(gateway.db.db.prepare("SELECT COUNT(*) AS count FROM intake_drafts").get().count, 0);
  }, {
    config: { modelApiKey: "test-key", model: "test-model" },
    parseIntake: async () => {
      const workspace = structuredClone(emptyWorkspace);
      workspace.providers.push({ id: "provider-openai", name: "OpenAI" });
      workspace.catalog.push({ id: "item-codex", providerId: "provider-openai", name: "Codex", description: "", roles: ["developer_tool"], models: [], adoptionStatus: "active" });
      workspace.entitlements.push({ id: "entitlement-codex", itemId: "item-codex", label: "Pro", billingMode: "subscription", amount: 20, currency: "USD", billingCycle: "monthly", autoRenew: true, tags: [] });
      gatewayRef.db.replaceWorkspace(workspace, { expectedRevision: 0, summary: "Concurrent write" });
      return parsed;
    },
  });
});

test("web BYOK settings encrypt the key, never return it, and drive natural-language intake", async () => {
  const apiKey = "sk-private-test-key-value-123456789";
  let receivedConfig;
  const parsed = {
    intent: "create_subscription",
    subscription: { serviceName: "Codex", providerName: "OpenAI", planName: "Pro" },
    confidence: 0.99, missingFields: [], riskFlags: [],
  };
  await withGateway(async (base, gateway) => {
    const saveResponse = await fetch(`${base}/v1/web/model-settings`, {
      method: "PUT", headers: ownerHeaders,
      body: JSON.stringify({ settings: { baseUrl: "https://models.example/v1", model: "example-model", apiKey } }),
    });
    assert.equal(saveResponse.status, 200);
    const saved = await saveResponse.json();
    assert.equal(saved.settings.source, "byok");
    assert.equal("apiKey" in saved.settings, false);
    assert.equal(JSON.stringify(saved).includes(apiKey), false);
    const raw = gateway.db.db.prepare("SELECT * FROM model_settings WHERE id = 'active'").get();
    assert.equal(JSON.stringify(raw).includes(apiKey), false);

    const intakeResponse = await fetch(`${base}/v1/web/intake`, {
      method: "POST", headers: ownerHeaders, body: JSON.stringify({ message: "我订阅了 Codex Pro" }),
    });
    assert.equal(intakeResponse.status, 201);
    assert.equal(receivedConfig.modelApiKey, apiKey);
    assert.equal(receivedConfig.modelBaseUrl, "https://models.example/v1");
    assert.equal(receivedConfig.model, "example-model");

    const statusResponse = await fetch(`${base}/v1/web/model-settings`, { headers: ownerHeaders });
    const status = await statusResponse.json();
    assert.equal(JSON.stringify(status).includes(apiKey), false);
    assert.equal(status.settings.keyConfigured, true);
  }, {
    config: { secretsMasterKey: Buffer.alloc(32, 7) },
    parseIntake: async (_message, config) => { receivedConfig = config; return parsed; },
  });
});

test("BYOK save fails closed when the independent master key is unavailable", async () => {
  await withGateway(async (base) => {
    const response = await fetch(`${base}/v1/web/model-settings`, {
      method: "PUT", headers: ownerHeaders,
      body: JSON.stringify({ settings: { baseUrl: "https://models.example/v1", model: "example-model", apiKey: "sk-private-test-key" } }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "secrets_master_key_unavailable");
  });
});
