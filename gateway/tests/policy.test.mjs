import assert from "node:assert/strict";
import test from "node:test";
import { containsLikelySecret } from "../src/security.mjs";
import { evaluateParsedIntent } from "../src/policy.mjs";

const fakeDb = {
  findExactActiveSubscriptions: () => [],
  searchSubscriptions: () => [],
};
const config = { confidenceThreshold: 0.85, allowedTags: ["主力", "常用", "弃用"] };

test("detects common API credential shapes", () => {
  assert.equal(containsLikelySecret("sk-abcdefghijklmnopqrstuvwxyz123456"), true);
  assert.equal(containsLikelySecret("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(containsLikelySecret("Visa 尾号 2048"), false);
});

test("does not let low-confidence model output become a draft", () => {
  const decision = evaluateParsedIntent({
    intent: "create_subscription",
    target: { name: null },
    subscription: { name: "未知服务" },
    changes: {},
    confidence: 0.4,
    missingFields: ["price", "renewalDate"],
    riskFlags: [],
  }, fakeDb, config);
  assert.equal(decision.status, "needs_clarification");
});

test("rejects labels that are not in API Hub's configured catalog", () => {
  const decision = evaluateParsedIntent({
    intent: "create_subscription",
    target: { name: null },
    subscription: { name: "Test", price: 10, currency: "CNY", billingCycle: "monthly", renewalDate: "2026-09-01", tags: ["模型自创标签"] },
    changes: {},
    confidence: 0.99,
    missingFields: [],
    riskFlags: [],
  }, fakeDb, config);
  assert.equal(decision.status, "needs_clarification");
  assert.equal(decision.issues.some((item) => item.code === "unknown_tags"), true);
});
