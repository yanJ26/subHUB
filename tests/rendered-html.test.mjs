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
  const [domain, editor, app, smartIntake, services] = await Promise.all([
    readFile(new URL("../lib/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/workspace-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/subhub-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/smart-intake-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/services-view.tsx", import.meta.url), "utf8"),
  ]);
  const entitlementType = domain.match(/export type Entitlement = \{[\s\S]*?\n\};/)?.[0] ?? "";
  const assetType = domain.match(/export type Asset = \{[\s\S]*?\n\};/)?.[0] ?? "";
  assert.doesNotMatch(entitlementType, /apiKey|accessToken|secret/i);
  assert.doesNotMatch(assetType, /apiKey|accessToken|secret/i);
  assert.match(assetType, /domainName/);
  assert.match(editor, /手工添加订阅/);
  assert.match(editor, /添加订阅/);
  assert.match(editor, /添加数字资产/);
  assert.match(app, /quickSubscription/);
  assert.match(app, /一句话录入/);
  assert.match(smartIntake, /不会为未订阅工具虚构费用/);
  assert.match(smartIntake, /生成草稿/);
  assert.match(smartIntake, /确认写入/);
  assert.match(app, /label: "总览"/);
  assert.match(app, /label: "服务"/);
  assert.match(app, /label: "资产"/);
  assert.match(services, /未订阅/);
  assert.match(services, /只记录服务，不生成费用/);
  assert.doesNotMatch(app, /数据与连接|快照与效率|使用地图|完整目录/);
  assert.match(app, /type="password"/);
});
