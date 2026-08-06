import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ApiHubDatabase } from "../src/db.mjs";
import { createGatewayServer } from "../src/server.mjs";

const validParsedCreate = {
  intent: "create_subscription",
  target: { name: null },
  subscription: {
    name: "Cursor Pro",
    provider: "Cursor",
    plan: "Pro",
    price: 20,
    currency: "USD",
    billingCycle: "monthly",
    renewalDate: "2026-09-08",
    channel: "官网信用卡",
    loginDevice: "Windows 台式机、安卓手机",
    tags: ["主力"],
    autoRenew: true,
    invoiceStatus: "pending",
    invoiceNumber: null,
    invoiceUrl: null,
    reminderDays: 7,
    notes: null,
  },
  changes: {},
  confidence: 0.98,
  missingFields: [],
  riskFlags: [],
};

const TEST_MASTER_KEY = Buffer.alloc(32, 7);
const TEST_EXCHANGE_RATES = { rates: { CNY: 1, USD: 7.01, EUR: 7.91 }, rateDate: "2026-08-05", source: "ecb" };

async function withServer(parseModel, callback, {
  secretsMasterKey = TEST_MASTER_KEY,
  fetchExchangeRates = async () => TEST_EXCHANGE_RATES,
  now = () => new Date(),
} = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "apihub-gateway-test-"));
  const db = new ApiHubDatabase(path.join(directory, "test.sqlite"), { secretsMasterKey });
  const config = {
    integrationToken: "test-token",
    webInternalToken: "test-web-token",
    hmacSecret: "",
    maxBodyBytes: 32768,
    approvalTtlMinutes: 15,
    confidenceThreshold: 0.85,
    allowedTags: ["主力", "常用", "弃用"],
    modelApiKey: "test",
    model: "test",
    modelBaseUrl: "https://fallback.example/v1",
    secretsMasterKey,
    allowPrivateModelEndpoints: false,
    exchangeRateUrl: "https://rates.example/daily.xml",
  };
  const server = createGatewayServer({ config, db, parseModel, fetchExchangeRates, now });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback({ baseUrl: `http://127.0.0.1:${address.port}`, db });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function intakeBody(overrides = {}) {
  return {
    sourceMessageId: "telegram:message-1001",
    senderId: "owner-1",
    channel: "telegram",
    message: "记录 Cursor Pro，每月 20 美元，9 月 8 日到期，主力",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

async function post(baseUrl, pathName, body, token = "test-token") {
  return fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("creates a draft, requires its one-time code, commits once and deduplicates intake", async () => {
  await withServer(async () => validParsedCreate, async ({ baseUrl }) => {
    const intakeResponse = await post(baseUrl, "/v1/openclaw/intake", intakeBody());
    assert.equal(intakeResponse.status, 201);
    const intake = await intakeResponse.json();
    assert.equal(intake.status, "pending_confirmation");
    assert.match(intake.approval.code, /^\d{6}$/);
    assert.match(intake.draft.summary, /Cursor Pro/);

    const wrongCode = await post(baseUrl, `/v1/openclaw/drafts/${intake.draft.id}/commit`, { approvalCode: "000000" });
    assert.equal(wrongCode.status, 403);

    const commitResponse = await post(baseUrl, `/v1/openclaw/drafts/${intake.draft.id}/commit`, { approvalCode: intake.approval.code });
    assert.equal(commitResponse.status, 200);
    const committed = await commitResponse.json();
    assert.equal(committed.subscription.name, "Cursor Pro");

    const repeatCommit = await post(baseUrl, `/v1/openclaw/drafts/${intake.draft.id}/commit`, { approvalCode: intake.approval.code });
    assert.equal(repeatCommit.status, 409);

    const duplicateResponse = await post(baseUrl, "/v1/openclaw/intake", intakeBody());
    assert.equal(duplicateResponse.status, 200);
    assert.equal((await duplicateResponse.json()).duplicate, true);

    const searchResponse = await fetch(`${baseUrl}/v1/openclaw/subscriptions/search?q=Cursor`, { headers: { Authorization: "Bearer test-token" } });
    const search = await searchResponse.json();
    assert.equal(search.results.length, 1);
    assert.equal(search.results[0].billingCycle, "monthly");
    assert.equal(search.results[0].loginDevice, "Windows 台式机、安卓手机");
  });
});

test("rejects likely secrets before calling the model or storing message text", async () => {
  let modelCalled = false;
  await withServer(async () => { modelCalled = true; return validParsedCreate; }, async ({ baseUrl, db }) => {
    const response = await post(baseUrl, "/v1/openclaw/intake", intakeBody({ sourceMessageId: "secret-1", message: "请保存 api_key=sk-abcdefghijklmnopqrstuvwxyz123456" }));
    assert.equal(response.status, 422);
    assert.equal(modelCalled, false);
    const inbox = db.findInboxBySourceMessageId("secret-1");
    assert.equal(inbox.status, "rejected_secret");
    const columns = db.db.prepare("PRAGMA table_info(agent_inbox)").all().map((row) => row.name);
    assert.equal(columns.includes("raw_message"), false);
  });
});

test("fails closed on missing authentication", async () => {
  await withServer(async () => validParsedCreate, async ({ baseUrl }) => {
    const response = await post(baseUrl, "/v1/openclaw/intake", intakeBody(), "wrong-token");
    assert.equal(response.status, 401);
  });
});

test("web intake creates a preview draft and commits only after explicit confirmation", async () => {
  await withServer(async () => validParsedCreate, async ({ baseUrl }) => {
    const unauthorized = await fetch(`${baseUrl}/v1/web/state`);
    assert.equal(unauthorized.status, 401);

    const headers = { Authorization: "Bearer test-web-token", "Content-Type": "application/json" };
    const intakeResponse = await fetch(`${baseUrl}/v1/web/intake`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "新增 Cursor Pro，每月 20 美元，2026 年 9 月 8 日续费，标签主力" }),
    });
    assert.equal(intakeResponse.status, 201);
    const intake = await intakeResponse.json();
    assert.equal(intake.status, "pending_confirmation");
    assert.equal(intake.draft.payload.subscription.name, "Cursor Pro");

    const beforeCommit = await fetch(`${baseUrl}/v1/web/state`, { headers });
    assert.equal((await beforeCommit.json()).subscriptions.length, 0);

    const commitResponse = await fetch(`${baseUrl}/v1/web/drafts/${intake.draft.id}/commit`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(commitResponse.status, 200);
    const committed = await commitResponse.json();
    assert.equal(committed.subscription.name, "Cursor Pro");

    const afterCommit = await fetch(`${baseUrl}/v1/web/state`, { headers });
    assert.equal((await afterCommit.json()).subscriptions.length, 1);
  });
});

test("web manual records use SQLite tags and reject secrets", async () => {
  await withServer(async () => validParsedCreate, async ({ baseUrl }) => {
    const headers = { Authorization: "Bearer test-web-token", "Content-Type": "application/json" };
    const createResponse = await fetch(`${baseUrl}/v1/web/subscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ subscription: validParsedCreate.subscription }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).subscription;

    const renameResponse = await fetch(`${baseUrl}/v1/web/tags`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ tags: [
        { id: "tag_primary", name: "核心", bg: "#daf7e8", color: "#17734b" },
        { id: "tag_regular", name: "常用", bg: "#e7efff", color: "#315da8" },
        { id: "tag_retired", name: "弃用", bg: "#f0f1f2", color: "#6e7479" },
      ] }),
    });
    assert.equal(renameResponse.status, 200);
    const renamed = await renameResponse.json();
    assert.deepEqual(renamed.subscriptions.find((item) => item.id === created.id).tags, ["核心"]);

    const secretResponse = await fetch(`${baseUrl}/v1/web/subscriptions/${created.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ subscription: { ...created, notes: "api_key=sk-abcdefghijklmnopqrstuvwxyz123456" } }),
    });
    assert.equal(secretResponse.status, 422);
  });
});

test("web BYOK settings encrypt keys, never return them, and retain a key on blank update", async () => {
  let modelConfig;
  await withServer(async (_message, config) => { modelConfig = config; return validParsedCreate; }, async ({ baseUrl, db }) => {
    const headers = { Authorization: "Bearer test-web-token", "Content-Type": "application/json" };
    const apiKey = "sk-private-test-key-value-123456789";
    const saveResponse = await fetch(`${baseUrl}/v1/web/model-settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ settings: { baseUrl: "https://models.example/v1", model: "example-model", apiKey } }),
    });
    assert.equal(saveResponse.status, 200);
    const savedBody = await saveResponse.json();
    assert.equal(savedBody.settings.keyConfigured, true);
    assert.equal(JSON.stringify(savedBody).includes(apiKey), false);
    assert.equal("apiKey" in savedBody.settings, false);

    const rawRow = db.db.prepare("SELECT * FROM model_settings WHERE id = 'active'").get();
    assert.equal(JSON.stringify(rawRow).includes(apiKey), false);

    const updateResponse = await fetch(`${baseUrl}/v1/web/model-settings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ settings: { baseUrl: "https://models.example/v2", model: "example-model-2", apiKey: "" } }),
    });
    assert.equal(updateResponse.status, 200);

    const intakeResponse = await fetch(`${baseUrl}/v1/web/intake`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "新增 Cursor Pro，每月 20 美元，2026 年 9 月 8 日续费，标签主力" }),
    });
    assert.equal(intakeResponse.status, 201);
    assert.equal(modelConfig.modelApiKey, apiKey);
    assert.equal(modelConfig.modelBaseUrl, "https://models.example/v2");
    assert.equal(modelConfig.model, "example-model-2");

    const getResponse = await fetch(`${baseUrl}/v1/web/model-settings`, { headers });
    const getBody = await getResponse.json();
    assert.equal(JSON.stringify(getBody).includes(apiKey), false);
    assert.equal(getBody.settings.source, "byok");
  });
});

test("BYOK save fails closed when the independent master key is missing", async () => {
  await withServer(async () => validParsedCreate, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/v1/web/model-settings`, {
      method: "PUT",
      headers: { Authorization: "Bearer test-web-token", "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { baseUrl: "https://models.example/v1", model: "example-model", apiKey: "sk-private-test-key" } }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "secrets_master_key_unavailable");
  }, { secretsMasterKey: null });
});

test("existing SQLite databases gain the login device column without losing subscriptions", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "apihub-schema-migration-test-"));
  const filename = path.join(directory, "migration.sqlite");
  let db = new ApiHubDatabase(filename, { secretsMasterKey: TEST_MASTER_KEY });
  db.db.prepare("ALTER TABLE subscriptions DROP COLUMN login_device").run();
  db.close();
  db = new ApiHubDatabase(filename, { secretsMasterKey: TEST_MASTER_KEY });
  try {
    const columns = db.db.prepare("PRAGMA table_info(subscriptions)").all().map((column) => column.name);
    assert.equal(columns.includes("login_device"), true);
    const created = db.createSubscription(validParsedCreate.subscription);
    assert.equal(created.loginDevice, "Windows 台式机、安卓手机");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("web state refreshes official exchange rates at most once per UTC month", async () => {
  let fetchCount = 0;
  await withServer(async () => validParsedCreate, async ({ baseUrl }) => {
    const headers = { Authorization: "Bearer test-web-token" };
    const first = await (await fetch(`${baseUrl}/v1/web/state`, { headers })).json();
    const second = await (await fetch(`${baseUrl}/v1/web/state`, { headers })).json();
    assert.equal(fetchCount, 1);
    assert.deepEqual(first.exchangeRates.rates, TEST_EXCHANGE_RATES.rates);
    assert.deepEqual(second.exchangeRates.rates, TEST_EXCHANGE_RATES.rates);
    assert.equal(first.exchangeRates.source, "ecb");
  }, { fetchExchangeRates: async () => { fetchCount += 1; return TEST_EXCHANGE_RATES; } });
});

test("a cache attempt from an earlier day prevents another refresh in the same UTC month", async () => {
  let fetchCount = 0;
  await withServer(async () => validParsedCreate, async ({ baseUrl, db }) => {
    db.markExchangeRateAttemptFailed("earlier_failure", "2026-08-01");
    const state = await (await fetch(`${baseUrl}/v1/web/state`, {
      headers: { Authorization: "Bearer test-web-token" },
    })).json();
    assert.equal(fetchCount, 0);
    assert.equal(state.exchangeRates.lastAttemptDate, "2026-08-01");
  }, {
    fetchExchangeRates: async () => { fetchCount += 1; return TEST_EXCHANGE_RATES; },
    now: () => new Date("2026-08-20T12:00:00.000Z"),
  });
});

test("exchange rate refresh failure keeps the built-in fallback and is not retried that month", async () => {
  let fetchCount = 0;
  await withServer(async () => validParsedCreate, async ({ baseUrl }) => {
    const headers = { Authorization: "Bearer test-web-token" };
    const first = await (await fetch(`${baseUrl}/v1/web/state`, { headers })).json();
    const second = await (await fetch(`${baseUrl}/v1/web/state`, { headers })).json();
    assert.equal(fetchCount, 1);
    assert.equal(first.exchangeRates.source, "built_in");
    assert.equal(first.exchangeRates.lastError, "network_unavailable");
    assert.deepEqual(second.exchangeRates.rates, first.exchangeRates.rates);
  }, { fetchExchangeRates: async () => { fetchCount += 1; throw new Error("network_unavailable"); } });
});
