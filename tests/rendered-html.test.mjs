import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(workerUrl.href);
  const request = new Request("http://localhost/", { headers: { accept: "text/html" } });
  const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  return typeof handler === "function" ? handler(request, env, context) : handler.fetch(request, env, context);
}

test("renders subHUB metadata and application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>subHUB｜数字服务与资产控制台<\/title>/i);
  assert.match(html, /正在检查本机连接/);
  assert.match(html, /SUBHUB/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("business models exclude raw credentials and include assets", async () => {
  const [domain, editor, app] = await Promise.all([
    readFile(new URL("../lib/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/workspace-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/subhub-app.tsx", import.meta.url), "utf8"),
  ]);
  const entitlementType = domain.match(/export type Entitlement = \{[\s\S]*?\n\};/)?.[0] ?? "";
  const assetType = domain.match(/export type Asset = \{[\s\S]*?\n\};/)?.[0] ?? "";
  assert.doesNotMatch(entitlementType, /apiKey|accessToken|secret/i);
  assert.doesNotMatch(assetType, /apiKey|accessToken|secret/i);
  assert.match(assetType, /domainName/);
  assert.match(editor, /添加订阅或使用权益/);
  assert.match(editor, /添加数字资产/);
  assert.match(app, /type="password"/);
});
