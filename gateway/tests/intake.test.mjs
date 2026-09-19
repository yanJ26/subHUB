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

test("intake policy fails closed on low confidence, fake dates, and unknown tags", () => {
  const base = { intent: "create_subscription", subscription: { serviceName: "Codex" }, confidence: 0.5, missingFields: [], riskFlags: [] };
  assert.equal(evaluateIntakeResult(base, emptyWorkspace, config).status, "needs_clarification");
  const invalid = evaluateIntakeResult({ ...base, confidence: 0.99, subscription: { serviceName: "Codex", expiresAt: "2026-02-30", tags: ["模型自创"] } }, emptyWorkspace, config);
  assert.equal(invalid.status, "needs_clarification");
  assert.equal(invalid.issues.some((entry) => entry.code === "invalid_date"), true);
  assert.equal(invalid.issues.some((entry) => entry.code === "unknown_tags"), true);
});
