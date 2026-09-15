import assert from "node:assert/strict";
import test from "node:test";
import { containsLikelySecret, findLikelySecretPaths, verifyBearer } from "../src/security.mjs";

test("likely secrets are rejected while credential labels stay safe", () => {
  assert.equal(containsLikelySecret("sk-test_abcdefghijklmnopqrstuvwxyz"), true);
  assert.equal(containsLikelySecret("MiniMax 主力 API（不保存 Key）"), false);
  assert.deepEqual(findLikelySecretPaths({ notes: "normal", apiKey: "real-value" }), ["$.apiKey"]);
  assert.deepEqual(findLikelySecretPaths({ token: "value", cookie: "value", privateKey: "value" }), ["$.token", "$.cookie", "$.privateKey"]);
  assert.equal(containsLikelySecret("password: this-should-never-be-logged"), true);
  assert.equal(verifyBearer("Bearer internal-token", "internal-token"), true);
  assert.equal(verifyBearer("Bearer wrong", "internal-token"), false);
});
