const COOKIE_NAME = "subhub_session";
const SESSION_SECONDS = 12 * 60 * 60;

function configuredBasePath() {
  const value = process.env.NEXT_PUBLIC_BASE_PATH?.trim().replace(/\/$/, "") || "";
  return value || "/";
}

function getRequiredSecret(name: "SUBHUB_WEB_PASSWORD" | "SUBHUB_WEB_SESSION_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_not_configured`);
  return value;
}

export function isOwnerAuthConfigured() {
  return Boolean(process.env.SUBHUB_WEB_PASSWORD?.trim() && process.env.SUBHUB_WEB_SESSION_SECRET?.trim());
}

function encodeBase64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getRequiredSecret("SUBHUB_WEB_SESSION_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function passwordMatches(candidate: unknown) {
  if (typeof candidate !== "string" || candidate.length > 512) return false;
  const expected = getRequiredSecret("SUBHUB_WEB_PASSWORD");
  const [left, right] = await Promise.all([hmac(`password:${candidate}`), hmac(`password:${expected}`)]);
  return constantTimeEqual(left, right);
}

export async function createSessionCookie() {
  const payload = encodeBase64Url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }));
  const signature = encodeBase64Url(await hmac(payload));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${payload}.${signature}; Path=${configuredBasePath()}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=${configuredBasePath()}; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function hasOwnerSession(request: Request) {
  if (!isOwnerAuthConfigured()) return false;
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  try {
    const supplied = decodeBase64Url(signature);
    const expected = await hmac(payload);
    if (!constantTimeEqual(supplied, expected)) return false;
    const decoded = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as { exp?: number };
    return Number.isFinite(decoded.exp) && Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function isCrossSiteMutation(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const expectedOrigin = process.env.SUBHUB_PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
  if (!expectedOrigin) return false;
  return request.headers.get("origin")?.replace(/\/$/, "") !== expectedOrigin;
}
