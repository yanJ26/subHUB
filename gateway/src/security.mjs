import { createHash, timingSafeEqual } from "node:crypto";

const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\b(?:ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{16,}\b/,
  /\b(?:api[_ -]?key|access[_ -]?token|secret[_ -]?key|password)\s*[:=]\s*\S{8,}/i,
  /\bAuthorization\s*:\s*Bearer\s+\S+/i,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}/i,
];

export function containsLikelySecret(value) {
  return typeof value === "string" && secretPatterns.some((pattern) => pattern.test(value));
}

const sensitiveKey = /^(?:api[_-]?key|access[_-]?token|token|secret|secret[_-]?key|private[_-]?key|password|authorization|cookie|credential)$/i;

export function findLikelySecretPaths(value, path = "$", found = []) {
  if (found.length >= 20) return found;
  if (typeof value === "string") {
    if (containsLikelySecret(value)) found.push(path);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (sensitiveKey.test(key) && typeof child === "string" && child.trim()) found.push(childPath);
    else findLikelySecretPaths(child, childPath, found);
  }
  return found;
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
