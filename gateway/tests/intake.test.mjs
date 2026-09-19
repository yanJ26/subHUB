import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIntakeResult } from "../src/intake-policy.mjs";
import { normalizeIntakeResult } from "../src/intake-schema.mjs";

const emptyWorkspace = { providers: [], catalog: [], entitlements: [], tagDefinitions: [] };
const config = { confidenceThreshold: 0.85, allowedTags: ["主力"] };

test("intake normalization drops unknown fields and preserves explicit subscription data", () => {
  const parsed = normalizeIntakeResult({
    intent: "create_subscription",
    subscription: {
      serviceName: " Codex ", providerName: "OpenAI", planName: "Pro", amount: 20,
      currency: "USD", billingCycle: "monthly", renewsAt: "2026-10-01", expiresAt: null,
      tags: ["主力", "主力"], injected: "ignored",
    },
    confidence: 0.98, missingFields: [], riskFlags: [],
  });
  assert.equal(parsed.subscription.serviceName, "Codex");
  assert.deepEqual(parsed.subscription.tags, ["主力"]);
  assert.equal("injected" in parsed.subscription, false);
});

test("intake normalization parses update target and changes", () => {
  const parsed = normalizeIntakeResult({
    intent: "update_subscription", target: " Codex ", subscription: {},
    changes: { expiresAt: "2026-10-17", amount: null, tags: ["主力", "主力"], bogus: "x" },
    confidence: 0.95, missingFields: [], riskFlags: [],
  });
  assert.equal(parsed.intent, "update_subscription");
  assert.equal(parsed.target, "Codex");
  assert.deepEqual(parsed.changes, { expiresAt: "2026-10-17", tags: ["主力"] });
  assert.deepEqual(parsed.subscription, {});
});

function codexWorkspace(extra = {}) {
  return {
    providers: [{ id: "p1", name: "OpenAI" }],
    catalog: [{ id: "i1", providerId: "p1", name: "Codex", description: "", roles: ["agent"], models: [], adoptionStatus: "active" }],
    entitlements: [{ id: "e1", itemId: "i1", label: "Plus", billingMode: "subscription", amount: 20, currency: "USD", billingCycle: "monthly", status: "active", expiresAt: "2026-09-08", autoRenew: true, reminderDays: 7, tags: ["主力"], ...extra }],
    tagDefinitions: [{ id: "t1", name: "主力" }],
  };
}

const updateBase = { riskFlags: [], missingFields: [], confidence: 0.95, subscription: {} };

test("intake policy builds a before→after update draft for a unique target", () => {
  const result = evaluateIntakeResult({ ...updateBase, intent: "update_subscription", target: "Codex", changes: { expiresAt: "2026-10-17" } }, codexWorkspace(), config);
  assert.equal(result.status, "draft_ready");
  assert.equal(result.payload.op, "update");
  assert.equal(result.payload.entitlementId, "e1");
  assert.deepEqual(result.payload.changes, { expiresAt: "2026-10-17" });
  assert.match(result.summary, /权益到期：2026-09-08 → 2026-10-17/);
});

test("intake update reports missing, unknown, ambiguous target and empty changes", () => {
  const missing = evaluateIntakeResult({ ...updateBase, intent: "update_subscription", target: null, changes: { expiresAt: "2026-10-17" } }, codexWorkspace(), config);
  assert.equal(missing.issues[0].code, "missing_target");
  const notFound = evaluateIntakeResult({ ...updateBase, intent: "update_subscription", target: "Ghost", changes: { expiresAt: "2026-10-17" } }, codexWorkspace(), config);
  assert.equal(notFound.issues[0].code, "target_not_found");
  const noChanges = evaluateIntakeResult({ ...updateBase, intent: "update_subscription", target: "Codex", changes: {} }, codexWorkspace(), config);
  assert.equal(noChanges.issues[0].code, "no_changes");
  const ws = codexWorkspace();
  ws.entitlements.push({ id: "e2", itemId: "i1", label: "Pro", billingMode: "subscription", amount: 200, currency: "USD", billingCycle: "yearly", status: "active", autoRenew: false, reminderDays: 7, tags: [] });
  const ambiguous = evaluateIntakeResult({ ...updateBase, intent: "update_subscription", target: "Codex", changes: { expiresAt: "2026-10-17" } }, ws, config);
  assert.equal(ambiguous.issues[0].code, "ambiguous_target");
});

test("intake update rejects unsupported fields and invalid dates", () => {
  const unsupported = evaluateIntakeResult({ ...updateBase, intent: "update_subscription", target: "Codex", changes: { serviceName: "Renamed" } }, codexWorkspace(), config);
  assert.equal(unsupported.issues.some((entry) => entry.code === "unsupported_change"), true);
  const badDate = evaluateIntakeResult({ ...updateBase, intent: "update_subscription", target: "Codex", changes: { renewsAt: "2026-13-40" } }, codexWorkspace(), config);
  assert.equal(badDate.issues.some((entry) => entry.code === "invalid_date"), true);
});

test("intake policy fails closed on low confidence, fake dates, and unknown tags", () => {
  const base = { intent: "create_subscription", subscription: { serviceName: "Codex" }, confidence: 0.5, missingFields: [], riskFlags: [] };
  assert.equal(evaluateIntakeResult(base, emptyWorkspace, config).status, "needs_clarification");
  const invalid = evaluateIntakeResult({ ...base, confidence: 0.99, subscription: { serviceName: "Codex", expiresAt: "2026-02-30", tags: ["模型自创"] } }, emptyWorkspace, config);
  assert.equal(invalid.status, "needs_clarification");
  assert.equal(invalid.issues.some((entry) => entry.code === "invalid_date"), true);
  assert.equal(invalid.issues.some((entry) => entry.code === "unknown_tags"), true);
});
