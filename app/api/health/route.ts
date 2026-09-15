export async function GET() {
  const gatewayWeb = (process.env.SUBHUB_GATEWAY_INTERNAL_URL || "http://127.0.0.1:8790/v1/web").replace(/\/$/, "");
  const gatewayHealth = gatewayWeb.replace(/\/v1\/web$/, "/health");
  try {
    const upstream = await fetch(gatewayHealth, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
    if (!upstream.ok) throw new Error("gateway_unhealthy");
    return Response.json({ ok: true, service: "subhub-web" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, service: "subhub-web", error: "gateway_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
