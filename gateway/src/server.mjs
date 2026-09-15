import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { SubHubDatabase } from "./database.mjs";
import { loadConfig, validateRuntimeConfig } from "./config.mjs";
import { fetchEcbRates } from "./exchange-rates.mjs";
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

function statusForError(error) {
  if (["invalid_json", "request_too_complex", "invalid_workspace_state", "invalid_backup", "invalid_apihub_export", "invalid_agenthub_export", "invalid_buddyhub_export", "missing_required_fields", "expected_revision_required"].includes(error.message)) return 400;
  if (["revision_conflict", "migration_preview_mismatch", "restore_preview_mismatch"].includes(error.message)) return 409;
  if (error.message === "migration_conflicts_unresolved") return 422;
  if (error.message === "likely_secret_detected") return 422;
  if (error.message === "request_too_large") return 413;
  if (error.message.endsWith("_not_found")) return 404;
  return 500;
}

export function createGateway(config = loadConfig(), database, { fetchExchangeRates = fetchEcbRates, now = () => new Date() } = {}) {
  const db = database || new SubHubDatabase(config.dbPath);
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
        return sendJson(response, 200, { ok: true, service: "subhub-gateway", catalogItems: db.countCatalogItems(), revision: db.getRevision(), requestId });
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
        return sendJson(response, 200, { ...state, requestId });
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
