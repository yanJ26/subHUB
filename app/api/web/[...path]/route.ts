import { hasOwnerSession, isCrossSiteMutation } from "../../_lib/owner-session";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: RouteContext) {
  if (!await hasOwnerSession(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (isCrossSiteMutation(request)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const internalToken = process.env.APIHUB_WEB_INTERNAL_TOKEN?.trim();
  const gatewayBase = (process.env.APIHUB_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8787/v1/web").replace(/\/$/, "");
  if (!internalToken) {
    return Response.json({ error: "gateway_not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = `${gatewayBase}/${path.map(encodeURIComponent).join("/")}${incoming.search}`;
  const headers = new Headers({
    Authorization: `Bearer ${internalToken}`,
    Accept: "application/json",
  });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: "manual",
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "gateway_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
