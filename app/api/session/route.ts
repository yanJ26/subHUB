import {
  clearSessionCookie,
  createSessionCookie,
  hasOwnerSession,
  isCrossSiteMutation,
  passwordMatches,
} from "../_lib/owner-session";

const noStoreHeaders = { "Cache-Control": "no-store" };
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function currentAttempt(request: Request) {
  const key = clientKey(request);
  const existing = loginAttempts.get(key);
  if (!existing || existing.resetAt <= Date.now()) {
    const fresh = { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
    loginAttempts.set(key, fresh);
    return { key, attempt: fresh };
  }
  return { key, attempt: existing };
}

export async function GET(request: Request) {
  return Response.json({ authenticated: await hasOwnerSession(request) }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  if (isCrossSiteMutation(request)) return Response.json({ error: "forbidden" }, { status: 403, headers: noStoreHeaders });
  const { key, attempt } = currentAttempt(request);
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    return Response.json(
      { error: "too_many_attempts" },
      { status: 429, headers: { ...noStoreHeaders, "Retry-After": String(Math.ceil((attempt.resetAt - Date.now()) / 1000)) } },
    );
  }
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: noStoreHeaders });
  }
  try {
    if (!await passwordMatches(body.password)) {
      attempt.count += 1;
      return Response.json({ error: "invalid_password" }, { status: 401, headers: noStoreHeaders });
    }
    loginAttempts.delete(key);
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
