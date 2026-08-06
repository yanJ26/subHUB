import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:api[_ -]?key|access[_ -]?token|secret[_ -]?key)\s*[:=]\s*\S{8,}/i,
  /\bAuthorization\s*:\s*Bearer\s+\S+/i,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}/i,
];

export function containsLikelySecret(value) {
  return typeof value === "string" && secretPatterns.some((pattern) => pattern.test(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyBearer(header, expectedToken) {
  if (!expectedToken || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), expectedToken);
}

export function verifyHmac(rawBody, signature, secret) {
  if (!secret) return true;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(signature, expected);
}

export function createApprovalCode() {
  return String(Number.parseInt(randomBytes(4).toString("hex"), 16) % 1_000_000).padStart(6, "0");
}

export function hashApprovalCode(draftId, code) {
  return sha256(`${draftId}:${code}`);
}

export function redactForLog(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[REDACTED]");
}
