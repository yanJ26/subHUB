import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders API Hub metadata and application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>API Hub｜订阅管理台<\/title>/i);
  assert.match(html, /正在整理订阅台账/);
  assert.match(html, /不会保存任何 API 密钥/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("keeps API secret fields out of the subscription model", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const subscriptionType = page.match(/type Subscription = \{[\s\S]*?\n\};/)?.[0] ?? "";
  const subscriptionForm = page.match(/const emptyForm:[\s\S]*?\n\};/)?.[0] ?? "";
  assert.doesNotMatch(subscriptionType, /apiKey|token|secret/i);
  assert.doesNotMatch(subscriptionForm, /apiKey|token|secret/i);
  assert.match(page, /type="password"/);
  assert.match(page, /STORAGE_KEY/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
