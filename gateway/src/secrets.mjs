import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function parseMasterKey(value) {
  if (!value) return null;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new Error("SUBHUB_SECRETS_MASTER_KEY must be a base64-encoded 32-byte key");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("SUBHUB_SECRETS_MASTER_KEY must decode to exactly 32 bytes");
  return key;
}

export function encryptSecret(plaintext, masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new Error("secrets_master_key_unavailable");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}

export function decryptSecret(payload, masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new Error("secrets_master_key_unavailable");
  const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(payload.iv, "base64"), { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
