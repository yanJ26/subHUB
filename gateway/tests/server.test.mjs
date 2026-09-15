import assert from "node:assert/strict";
import test from "node:test";
import { createGateway } from "../src/server.mjs";

const emptyWorkspace = { providers: [], catalog: [], entitlements: [], accessSurfaces: [], usageLinks: [], quotaPolicies: [], snapshots: [], evaluations: [] };

test("gateway protects owner routes and rejects secrets in imports", async () => {
  const gateway = createGateway({ host: "127.0.0.1", port: 0, dbPath: ":memory:", webInternalToken: "test-token", maxBodyBytes: 100_000 });
  const address = await gateway.listen();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/v1/web/state`)).status, 401);

    const headers = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
    const imported = await fetch(`${base}/v1/web/import`, { method: "POST", headers, body: JSON.stringify({ workspace: emptyWorkspace }) });
    assert.equal(imported.status, 200);

    const rejected = await fetch(`${base}/v1/web/import`, {
      method: "POST", headers,
      body: JSON.stringify({ workspace: { ...emptyWorkspace, providers: [{ id: "p", name: "x", apiKey: "should-never-be-here" }] } }),
    });
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json()).error, "likely_secret_detected");
  } finally { await gateway.close(); }
});
