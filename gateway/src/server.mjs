import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { SubHubDatabase } from "./database.mjs";
import { loadConfig, validateRuntimeConfig } from "./config.mjs";
import { fetchEcbRates } from "./exchange-rates.mjs";
import { parseIntakeWithModel } from "./intake-llm.mjs";
import { evaluateIntakeResult } from "./intake-policy.mjs";
import { addIntakeSubscription, applyIntakeSubscriptionUpdate } from "./intake-workspace.mjs";
import { mergeMigrationWorkspace, previewLegacyMigration, resolveMigrationConflicts } from "./migration.mjs";
import { findLikelySecretPaths, sha256, verifyBearer } from "./security.mjs";
import { assertExpectedRevision, assertWorkspaceState } from "./validation.mjs";

const adoptionStatuses = new Set(["active", "trial", "considering", "unused", "paused", "retired"]);

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...(body?.requestId ? { "X-Request-ID": body.requestId } : {}),
  });
  response.end(JSON.stringify(body));
}

async function readBody(request, maxBodyBytes) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > maxBodyBytes) throw new Error("request_too_large");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return { raw: "", json: {} };
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    const json = JSON.parse(raw);
    const stack = [{ value: json, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
      const current = stack.pop();
      nodes += 1;
      if (current.depth > 40 || nodes > 50_000) throw new Error("request_too_complex");
      if (current.value && typeof current.value === "object") {
        for (const child of Object.values(current.value)) stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return { raw, json };
  } catch (error) {
    if (error instanceof Error && error.message === "request_too_complex") throw error;
    throw new Error("invalid_json");
  }
}

async function readJson(request, maxBodyBytes) {
  return (await readBody(request, maxBodyBytes)).json;
}

function requireFields(body, fields) {
  if (!body || typeof body !== "object" || fields.some((field) => body[field] === undefined || body[field] === "")) {
    throw new Error("missing_required_fields");
  }
}

function safeImportedData(value) {
  const paths = findLikelySecretPaths(value);
  if (paths.length) {
    const error = new Error("likely_secret_detected");
    error.paths = paths;
    throw error;
  }
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function normalizeModelSettings(input = {}, config) {
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim().replace(/\/$/, "") : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const issues = [];
  if (!baseUrl || baseUrl.length > 500) issues.push({ code: "invalid_base_url", message: "模型接口地址不能为空且不能超过 500 个字符" });
  if (!model || model.length > 200) issues.push({ code: "invalid_model", message: "模型 ID 不能为空且不能超过 200 个字符" });
  if (apiKey && (apiKey.length < 8 || apiKey.length > 512)) issues.push({ code: "invalid_api_key", message: "API Key 长度应在 8 到 512 个字符之间" });
  try {
    const parsed = new URL(baseUrl);
    if (parsed.username || parsed.password) issues.push({ code: "credentials_in_url", message: "接口地址不能包含用户名或密码" });
    if (parsed.search || parsed.hash) issues.push({ code: "query_in_url", message: "接口地址不能包含查询参数或片段" });
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    const localHttpAllowed = parsed.protocol === "http:" && loopback && (!config.isProduction || config.allowPrivateModelEndpoints);
    if (parsed.protocol !== "https:" && !localHttpAllowed) {
      issues.push({ code: "https_required", message: "模型接口必须使用 HTTPS；仅本机回环地址允许 HTTP" });
    }
    const privateHost = isPrivateIpv4(parsed.hostname) || parsed.hostname === "[::1]" || parsed.hostname === "localhost";
    if (privateHost && !loopback && !config.allowPrivateModelEndpoints) {
      issues.push({ code: "private_endpoint_blocked", message: "默认不允许私网模型地址；如确有需要，请在服务器显式启用私网端点" });
    }
  } catch {
    issues.push({ code: "invalid_base_url", message: "模型接口地址格式无效" });
  }
  return { value: { baseUrl, model, apiKey }, issues };
}

function statusForError(error) {
  if (["invalid_json", "request_too_complex", "invalid_workspace_state", "invalid_backup", "invalid_apihub_export", "invalid_agenthub_export", "invalid_buddyhub_export", "missing_required_fields", "expected_revision_required"].includes(error.message)) return 400;
  if (["revision_conflict", "migration_preview_mismatch", "restore_preview_mismatch", "intake_draft_not_pending"].includes(error.message)) return 409;
  if (error.message === "intake_draft_expired") return 410;
  if (error.message === "migration_conflicts_unresolved") return 422;
  if (error.message === "likely_secret_detected") return 422;
  if (error.message === "request_too_large") return 413;
  if (error.message.endsWith("_not_found")) return 404;
  return 500;
}

export function createGateway(config = loadConfig(), database, { fetchExchangeRates = fetchEcbRates, parseIntake = parseIntakeWithModel, now = () => new Date() } = {}) {
  const db = database || new SubHubDatabase(config.dbPath, { secretsMasterKey: config.secretsMasterKey });
  let exchangeRateRefresh = null;

  async function getMonthlyExchangeRates() {
    const today = now().toISOString().slice(0, 10);
    const cached = db.getExchangeRates();
    if (cached.lastAttemptDate?.slice(0, 7) === today.slice(0, 7)) return cached;
    if (!exchangeRateRefresh) {
      exchangeRateRefresh = (async () => {
        try {
          return db.saveExchangeRates(await fetchExchangeRates(config.exchangeRateUrl), today);
        } catch (error) {
          return db.markExchangeRateAttemptFailed(String(error.message || error).split(":")[0], today);
        } finally {
          exchangeRateRefresh = null;
        }
      })();
    }
    return exchangeRateRefresh;
  }

  function migrationToken(sources, revision) {
    return sha256(`${revision}\u0000${JSON.stringify(sources)}`);
  }

  function migrationPreview(sources) {
    const revision = db.getRevision();
    const imported = previewLegacyMigration(sources);
    const merged = mergeMigrationWorkspace(db.getWorkspace(), imported.workspace);
    const conflicts = [...imported.conflicts, ...merged.conflicts];
    return {
      workspace: merged.workspace,
      warnings: [...imported.warnings, ...merged.warnings],
      conflicts,
      stats: imported.stats,
      canCommit: conflicts.every((entry) => entry.severity !== "blocking"),
      targetRevision: revision,
      previewToken: migrationToken(sources, revision),
    };
  }

  function requireConflictResolutions(preview, resolutions) {
    const allowed = new Set(["keep_both", "keep_existing", "use_incoming"]);
    const missing = preview.conflicts.filter((entry) => entry.severity === "blocking" && !allowed.has(resolutions?.[entry.id]));
    if (missing.length) throw new Error("migration_conflicts_unresolved");
  }

  const server = http.createServer(async (request, response) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let errorCode;
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    response.once("finish", () => console.log(JSON.stringify({
      timestamp: new Date().toISOString(), service: "subhub-gateway", requestId,
      method: request.method, path: url.pathname, status: response.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      ...(errorCode ? { errorCode } : {}),
    })));
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const intake = db.getModelSettingsStatus(config);
        return sendJson(response, 200, { ok: true, service: "subhub-gateway", catalogItems: db.countCatalogItems(), revision: db.getRevision(), intakeConfigured: intake.configured && (intake.source !== "byok" || intake.storageAvailable), requestId });
      }

      if (url.pathname.startsWith("/v1/internal/") && verifyBearer(request.headers.authorization, config.webInternalToken)) {
        if (request.method === "POST" && url.pathname === "/v1/internal/login-attempts/reserve") {
          const body = await readJson(request, config.maxBodyBytes);
          requireFields(body, ["clientKey"]);
          return sendJson(response, 200, { ...db.reserveLoginAttempt(body.clientKey), requestId });
        }
        if (request.method === "POST" && url.pathname === "/v1/internal/login-attempts/clear") {
          const body = await readJson(request, config.maxBodyBytes);
          requireFields(body, ["clientKey"]);
          db.clearLoginAttempts(body.clientKey);
          return sendJson(response, 200, { ok: true, requestId });
        }
        return sendJson(response, 404, { error: "not_found", requestId });
      }

      if (!url.pathname.startsWith("/v1/web/") || !verifyBearer(request.headers.authorization, config.webInternalToken)) {
        return sendJson(response, 401, { error: "unauthorized", requestId });
      }

      if (request.method === "GET" && url.pathname === "/v1/web/state") {
        const state = db.getState();
        state.exchangeRates = await getMonthlyExchangeRates();
        const modelSettings = db.getModelSettingsStatus(config);
        return sendJson(response, 200, { ...state, intake: { configured: modelSettings.configured && (modelSettings.source !== "byok" || modelSettings.storageAvailable) }, requestId });
      }

      if (request.method === "GET" && url.pathname === "/v1/web/model-settings") {
        return sendJson(response, 200, { settings: db.getModelSettingsStatus(config), requestId });
      }

      if (request.method === "PUT" && url.pathname === "/v1/web/model-settings") {
        const body = await readJson(request, Math.min(config.maxBodyBytes, 16 * 1024));
        const { value, issues } = normalizeModelSettings(body.settings, config);
        if (issues.length) return sendJson(response, 400, { error: "invalid_model_settings", issues, requestId });
        try {
          return sendJson(response, 200, { settings: db.saveModelSettings(value), requestId });
        } catch (error) {
          if (error instanceof Error && error.message === "secrets_master_key_unavailable") {
            return sendJson(response, 503, { error: error.message, message: "服务器尚未配置独立加密主密钥，无法安全保存 API Key。", requestId });
          }
          if (error instanceof Error && error.message === "api_key_required") {
            return sendJson(response, 400, { error: error.message, message: "首次配置必须填写 API Key。", requestId });
          }
          throw error;
        }
      }

      if (request.method === "DELETE" && url.pathname === "/v1/web/model-settings") {
        return sendJson(response, 200, { deleted: db.deleteModelSettings(), settings: db.getModelSettingsStatus(config), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/intake") {
        const body = await readJson(request, Math.min(config.maxBodyBytes, 64 * 1024));
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message || message.length > 12_000) return sendJson(response, 400, { error: "invalid_message", requestId });
        if (findLikelySecretPaths(message).length) return sendJson(response, 422, { status: "rejected", error: "likely_secret_detected", message: "内容疑似包含密钥、Token、密码或完整凭据，原文未保存。", requestId });
        const modelConfig = db.getModelSettingsStatus(config);
        if (!modelConfig.configured) return sendJson(response, 503, { status: "unavailable", error: "model_not_configured", message: "自然语言录入模型尚未配置。", requestId });
        const tagNamesAtSubmission = db.getWorkspace().tagDefinitions.map((tag) => tag.name);
        let parsed;
        try {
          parsed = await parseIntake(message, db.getEffectiveModelConfig({ ...config, allowedTags: tagNamesAtSubmission }));
          safeImportedData(parsed.subscription);
          safeImportedData(parsed.changes);
        } catch (error) {
          if (error instanceof Error && error.message === "likely_secret_detected") throw error;
          return sendJson(response, 503, { status: "parse_failed", error: "semantic_gate_unavailable", message: "语义整理暂时不可用，未写入任何数据。", requestId });
        }
        const current = db.getWorkspace();
        const revision = db.getRevision();
        const decision = evaluateIntakeResult(parsed, current, { confidenceThreshold: config.confidenceThreshold, allowedTags: current.tagDefinitions.map((tag) => tag.name) });
        if (["rejected", "needs_clarification"].includes(decision.status)) {
          return sendJson(response, decision.status === "rejected" ? 422 : 200, { status: decision.status, issues: decision.issues, requestId });
        }
        const expiresAt = new Date(now().getTime() + config.intakeTtlMinutes * 60_000).toISOString();
        const draft = db.createIntakeDraft({ messageHash: sha256(message), payload: decision.payload, summary: decision.summary, expectedRevision: revision, expiresAt });
        return sendJson(response, 201, { status: "pending_confirmation", draft: { id: draft.id, payload: draft.payload, summary: draft.summary, expiresAt: draft.expiresAt, expectedRevision: draft.expectedRevision }, requestId });
      }

      const intakeDraftMatch = url.pathname.match(/^\/v1\/web\/intake\/drafts\/([0-9a-f-]+)\/(commit|cancel)$/i);
      if (intakeDraftMatch && request.method === "POST") {
        const draft = db.getIntakeDraft(intakeDraftMatch[1]);
        if (!draft) throw new Error("intake_draft_not_found");
        if (intakeDraftMatch[2] === "cancel") {
          if (!db.cancelIntakeDraft(draft.id)) throw new Error("intake_draft_not_pending");
          return sendJson(response, 200, { status: "cancelled", requestId });
        }
        if (draft.status !== "pending_confirmation") throw new Error("intake_draft_not_pending");
        if (Date.parse(draft.expiresAt) <= now().getTime()) throw new Error("intake_draft_expired");
        if (draft.expectedRevision !== db.getRevision()) throw new Error("revision_conflict");
        const isUpdate = draft.payload?.op === "update";
        const next = isUpdate
          ? applyIntakeSubscriptionUpdate(db.getWorkspace(), draft.payload)
          : addIntakeSubscription(db.getWorkspace(), draft.payload);
        assertWorkspaceState(next);
        const label = String(draft.payload.serviceName || draft.payload.planLabel || "").slice(0, 200);
        const workspace = db.replaceWorkspace(next, {
          actor: "intake:owner", summary: `${isUpdate ? "Owner-confirmed subscription update" : "Owner-confirmed subscription intake"}: ${label}`,
          expectedRevision: draft.expectedRevision, intakeDraftId: draft.id,
        });
        return sendJson(response, 200, { status: "committed", op: isUpdate ? "update" : "create", workspace, revision: db.getRevision(), requestId });
      }

      if (request.method === "PUT" && url.pathname === "/v1/web/state") {
        const body = await readJson(request, config.maxBodyBytes);
        requireFields(body, ["workspace"]);
        safeImportedData(body.workspace);
        assertExpectedRevision(body.expectedRevision);
        assertWorkspaceState(body.workspace);
        const workspace = db.replaceWorkspace(body.workspace, {
          actor: "web:owner", summary: "Owner workspace update", expectedRevision: body.expectedRevision,
        });
        return sendJson(response, 200, { workspace, revision: db.getRevision(), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/import") {
        const body = await readJson(request, config.maxBodyBytes);
        requireFields(body, ["backup"]);
        const workspaceState = body.backup?.workspace;
        if (body.backup?.product !== "subHUB" || body.backup?.schemaVersion !== 1 || !workspaceState) throw new Error("invalid_backup");
        safeImportedData(workspaceState);
        assertExpectedRevision(body.expectedRevision);
        assertWorkspaceState(workspaceState);
        const workspace = db.replaceWorkspace(workspaceState, {
          actor: "web:owner", summary: "Owner-confirmed subHUB backup import", expectedRevision: body.expectedRevision,
        });
        return sendJson(response, 200, { workspace, revision: db.getRevision(), requestId });
      }

      if (request.method === "GET" && url.pathname === "/v1/web/backup") {
        return sendJson(response, 200, {
          product: "subHUB", schemaVersion: 1, exportedAt: new Date().toISOString(),
          revision: db.getRevision(), workspace: db.getWorkspace(), exchangeRates: db.getExchangeRates(), requestId,
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/web/audit") {
        return sendJson(response, 200, { auditLogs: db.getAuditLogs(Number(url.searchParams.get("limit") || 100)), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/restore/preview") {
        const body = await readJson(request, config.maxBodyBytes);
        const backup = body.backup;
        if (backup?.product !== "subHUB" || backup?.schemaVersion !== 1 || !backup.workspace) throw new Error("invalid_backup");
        safeImportedData(backup.workspace);
        assertWorkspaceState(backup.workspace);
        const revision = db.getRevision();
        const restoreToken = sha256(`${revision}\u0000${JSON.stringify(backup.workspace)}`);
        return sendJson(response, 200, {
          restoreToken, targetRevision: revision,
          stats: Object.fromEntries(Object.entries(backup.workspace).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])),
          requestId,
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/restore/commit") {
        const body = await readJson(request, config.maxBodyBytes);
        const backup = body.backup;
        if (backup?.product !== "subHUB" || backup?.schemaVersion !== 1 || !backup.workspace) throw new Error("invalid_backup");
        safeImportedData(backup.workspace);
        assertWorkspaceState(backup.workspace);
        const revision = assertExpectedRevision(body.expectedRevision);
        if (body.restoreToken !== sha256(`${revision}\u0000${JSON.stringify(backup.workspace)}`)) throw new Error("restore_preview_mismatch");
        const workspace = db.replaceWorkspace(backup.workspace, { actor: "restore:owner", summary: "Owner-confirmed JSON restore", expectedRevision: revision });
        return sendJson(response, 200, { workspace, revision: db.getRevision(), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/migration/preview") {
        const body = await readJson(request, config.maxBodyBytes);
        if (body.apiHub === undefined && body.agentHub === undefined && body.buddyHub === undefined) throw new Error("missing_required_fields");
        safeImportedData(body);
        const sources = { apiHub: body.apiHub, agentHub: body.agentHub, buddyHub: body.buddyHub };
        return sendJson(response, 200, { ...migrationPreview(sources), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/migration/commit") {
        const body = await readJson(request, config.maxBodyBytes);
        if (body.apiHub === undefined && body.agentHub === undefined && body.buddyHub === undefined) throw new Error("missing_required_fields");
        safeImportedData(body);
        const revision = assertExpectedRevision(body.expectedRevision);
        const sources = { apiHub: body.apiHub, agentHub: body.agentHub, buddyHub: body.buddyHub };
        if (body.previewToken !== migrationToken(sources, revision)) throw new Error("migration_preview_mismatch");
        const preview = migrationPreview(sources);
        requireConflictResolutions(preview, body.conflictResolutions);
        const resolvedWorkspace = resolveMigrationConflicts(preview.workspace, preview.conflicts, body.conflictResolutions);
        assertWorkspaceState(resolvedWorkspace);
        const workspace = db.replaceWorkspace(resolvedWorkspace, {
          actor: "migration:owner", summary: `Legacy migration: ${preview.stats.catalogItems} items, ${preview.stats.entitlements} entitlements`, expectedRevision: revision,
        });
        return sendJson(response, 200, { workspace, revision: db.getRevision(), stats: preview.stats, warnings: preview.warnings, conflicts: preview.conflicts, requestId });
      }

      const statusMatch = url.pathname.match(/^\/v1\/web\/catalog\/items\/([^/]+)\/status$/);
      if (request.method === "PATCH" && statusMatch) {
        const body = await readJson(request, config.maxBodyBytes);
        if (!adoptionStatuses.has(body.adoptionStatus)) throw new Error("missing_required_fields");
        const item = db.updateAdoptionStatus(decodeURIComponent(statusMatch[1]), body.adoptionStatus, assertExpectedRevision(body.expectedRevision));
        return sendJson(response, 200, { item, revision: db.getRevision(), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/snapshots") {
        const body = await readJson(request, config.maxBodyBytes);
        requireFields(body, ["entitlementId", "observedAt", "sourceLabel"]);
        safeImportedData(body);
        const { expectedRevision, ...snapshot } = body;
        const candidate = db.getWorkspace(); candidate.snapshots.push(snapshot);
        assertWorkspaceState(candidate);
        return sendJson(response, 201, { snapshot: db.addSnapshot(snapshot, assertExpectedRevision(expectedRevision)), revision: db.getRevision(), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/evaluations") {
        const body = await readJson(request, config.maxBodyBytes);
        requireFields(body, ["itemId", "evaluatedAt", "utilization", "outputValue", "quotaPressure", "trend", "recommendation", "confidence"]);
        safeImportedData(body);
        const { expectedRevision, ...evaluation } = body;
        const candidate = db.getWorkspace(); candidate.evaluations.push({ evidenceCount: 0, observationDays: 0, ...evaluation });
        assertWorkspaceState(candidate);
        return sendJson(response, 201, { evaluation: db.addEvaluation(evaluation, assertExpectedRevision(expectedRevision)), revision: db.getRevision(), requestId });
      }

      return sendJson(response, 404, { error: "not_found", requestId });
    } catch (error) {
      const status = statusForError(error);
      errorCode = status === 500 ? "internal_error" : error.message;
      return sendJson(response, status, {
        error: errorCode,
        ...(Array.isArray(error.paths) ? { paths: error.paths } : {}),
        ...(Array.isArray(error.details) ? { details: error.details } : {}), requestId,
      });
    }
  });

  return {
    server,
    db,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => resolve(server.address()));
      });
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => {
        if (error) reject(error);
        else { db.close(); resolve(); }
      }));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const missing = validateRuntimeConfig(config);
  if (missing.length) {
    console.error(`Missing required configuration: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else {
    const gateway = createGateway(config);
    gateway.listen().then(() => console.log(`subHUB Gateway listening on http://${config.host}:${config.port}`));
    let closing = false;
    const shutdown = async (signal) => {
      if (closing) return;
      closing = true;
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: "subhub-gateway", event: "shutdown", signal }));
      const force = setTimeout(() => process.exit(1), 10_000).unref();
      try { await gateway.close(); clearTimeout(force); process.exit(0); }
      catch (error) { console.error(error); process.exit(1); }
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  }
}
