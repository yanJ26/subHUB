import assert from "node:assert/strict";
import test from "node:test";
import { createSessionCookie, hasOwnerSession, isCrossSiteMutation } from "../app/api/_lib/owner-session.ts";
import { PUT as proxyPut } from "../app/api/web/[...path]/route.ts";

function configure() {
  process.env.SUBHUB_WEB_PASSWORD = "test-owner-password";
  process.env.SUBHUB_WEB_SESSION_SECRET = "test-session-secret-at-least-32-characters";
  process.env.SUBHUB_WEB_INTERNAL_TOKEN = "test-internal-token";
  process.env.SUBHUB_GATEWAY_INTERNAL_URL = "http://127.0.0.1:8790/v1/web";
  process.env.SUBHUB_PUBLIC_ORIGIN = "https://subhub.example";
  process.env.SUBHUB_MAX_BODY_BYTES = "10";
}

test("owner session cookies are signed and origin checks reject cross-site mutations", async () => {
  configure();
  const cookie = (await createSessionCookie()).split(";")[0];
  assert.equal(await hasOwnerSession(new Request("https://subhub.example", { headers: { cookie } })), true);
  assert.equal(await hasOwnerSession(new Request("https://subhub.example", { headers: { cookie: cookie + "tampered" } })), false);
  assert.equal(isCrossSiteMutation(new Request("https://subhub.example", { method: "POST", headers: { origin: "https://subhub.example", "sec-fetch-site": "same-origin" } })), false);
  assert.equal(isCrossSiteMutation(new Request("https://subhub.example", { method: "POST", headers: { origin: "https://evil.example" } })), true);
  assert.equal(isCrossSiteMutation(new Request("https://subhub.example", { method: "POST" })), true);
});

test("web proxy rejects an oversized chunked body before calling Gateway", async () => {
  configure();
  const cookie = (await createSessionCookie()).split(";")[0];
  let upstreamCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { upstreamCalled = true; return new Response("{}"); };
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123456"));
        controller.enqueue(new TextEncoder().encode("789012"));
        controller.close();
      },
    });
    const request = new Request("https://subhub.example/api/web/state", {
      method: "PUT",
      headers: { cookie, origin: "https://subhub.example", "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await proxyPut(request, { params: Promise.resolve({ path: ["state"] }) });
    assert.equal(response.status, 413);
    assert.equal(upstreamCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
