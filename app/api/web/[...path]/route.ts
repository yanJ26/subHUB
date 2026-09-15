import { hasOwnerSession, isCrossSiteMutation } from "../../_lib/owner-session.ts";

type RouteContext = { params: Promise<{ path: string[] }> };

async function readBoundedBody(request: Request, maxBodyBytes: number) {
  if (["GET", "HEAD"].includes(request.method) || !request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw new Error("request_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

async function proxy(request: Request, context: RouteContext) {
  if (!await hasOwnerSession(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (isCrossSiteMutation(request)) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const internalToken = process.env.SUBHUB_WEB_INTERNAL_TOKEN?.trim();
  const gatewayBase = (process.env.SUBHUB_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8790/v1/web").replace(/\/$/, "");
  const configuredLimit = Number(process.env.SUBHUB_MAX_BODY_BYTES || 2 * 1024 * 1024);
  const maxBodyBytes = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 2 * 1024 * 1024;
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
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > maxBodyBytes) return Response.json({ error: "request_too_large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
    const body = await readBoundedBody(request, maxBodyBytes);
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "request_too_large") return Response.json({ error: "request_too_large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
    return Response.json({ error: "gateway_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
