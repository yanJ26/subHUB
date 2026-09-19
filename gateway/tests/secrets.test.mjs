import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, parseMasterKey } from "../src/secrets.mjs";

test("AES-256-GCM model key storage round-trips and authenticates ciphertext", () => {
  const key = Buffer.alloc(32, 11);
  const encrypted = encryptSecret("sk-sensitive-value", key);
  assert.equal(encrypted.ciphertext.includes("sk-sensitive-value"), false);
  assert.equal(decryptSecret(encrypted, key), "sk-sensitive-value");
  assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 12)));
});

test("master key parser accepts only an exact base64-encoded 32-byte key", () => {
  const encoded = Buffer.alloc(32, 3).toString("base64");
  assert.deepEqual(parseMasterKey(encoded), Buffer.alloc(32, 3));
  assert.throws(() => parseMasterKey("short"));
  assert.equal(parseMasterKey(""), null);
});
