import {
  clearSessionCookie,
  createSessionCookie,
  hasOwnerSession,
  isCrossSiteMutation,
  isOwnerAuthConfigured,
  passwordMatches,
} from "../_lib/owner-session";

const noStoreHeaders = { "Cache-Control": "no-store" };

function clientKey(request: Request) {
  if (process.env.SUBHUB_TRUST_PROXY_HEADERS !== "true") return "owner";
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function internalUrl(path: string) {
  const webBase = (process.env.SUBHUB_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8790/v1/web").replace(/\/$/, "");
  return `${webBase.replace(/\/v1\/web$/, "/v1/internal")}${path}`;
}

async function throttleRequest(path: "/login-attempts/reserve" | "/login-attempts/clear", key: string) {
  const token = process.env.SUBHUB_WEB_INTERNAL_TOKEN?.trim();
  if (!token) throw new Error("gateway_not_configured");
  const response = await fetch(internalUrl(path), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: key }),
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("login_throttle_unavailable");
  return response.json() as Promise<{ allowed?: boolean; retryAfter?: number }>;
}

export async function GET(request: Request) {
  const configured = isOwnerAuthConfigured();
  return Response.json({ configured, authenticated: configured && await hasOwnerSession(request) }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  if (isCrossSiteMutation(request)) return Response.json({ error: "forbidden" }, { status: 403, headers: noStoreHeaders });
  if (!isOwnerAuthConfigured()) return Response.json({ error: "owner_auth_not_configured" }, { status: 503, headers: noStoreHeaders });
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  try {
    const key = clientKey(request);
    const attempt = await throttleRequest("/login-attempts/reserve", key);
    if (!attempt.allowed) {
      return Response.json(
        { error: "too_many_attempts", retryAfter: attempt.retryAfter },
        { status: 429, headers: { ...noStoreHeaders, "Retry-After": String(attempt.retryAfter || 60) } },
      );
    }
    if (!await passwordMatches(body.password)) {
      return Response.json({ error: "invalid_password" }, { status: 401, headers: noStoreHeaders });
    }
    await throttleRequest("/login-attempts/clear", key);
    return Response.json(
      { authenticated: true },
      { headers: { ...noStoreHeaders, "Set-Cookie": await createSessionCookie() } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "session_unavailable";
    return Response.json({ error: code }, { status: 503, headers: noStoreHeaders });
  }
}

export async function DELETE(request: Request) {
  if (isCrossSiteMutation(request)) return Response.json({ error: "forbidden" }, { status: 403, headers: noStoreHeaders });
  return Response.json(
    { authenticated: false },
    { headers: { ...noStoreHeaders, "Set-Cookie": clearSessionCookie() } },
  );
}
