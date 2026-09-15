import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { SubHubDatabase } from "./database.mjs";
import { loadConfig, validateRuntimeConfig } from "./config.mjs";
import { fetchEcbRates } from "./exchange-rates.mjs";
import { previewLegacyMigration } from "./migration.mjs";
import { findLikelySecretPaths, verifyBearer } from "./security.mjs";

const adoptionStatuses = new Set(["active", "trial", "considering", "unused", "paused", "retired"]);

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
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
    return { raw, json: JSON.parse(raw) };
  } catch {
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
  if (["invalid_json", "invalid_workspace_state", "invalid_apihub_export", "invalid_agenthub_export", "invalid_buddyhub_export", "missing_required_fields"].includes(error.message)) return 400;
  if (error.message === "revision_conflict") return 409;
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

  const server = http.createServer(async (request, response) => {
    const requestId = randomUUID();
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true, service: "subhub-gateway", catalogItems: db.countCatalogItems(), revision: db.getRevision(), requestId });
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
        const workspace = db.replaceWorkspace(body.workspace, {
          actor: "web:owner", summary: textSummary(body.summary, "Owner workspace update"), expectedRevision: body.expectedRevision,
        });
        return sendJson(response, 200, { workspace, revision: db.getRevision(), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/import") {
        const body = await readJson(request, config.maxBodyBytes);
        requireFields(body, ["workspace"]);
        safeImportedData(body.workspace);
        const workspace = db.replaceWorkspace(body.workspace, {
          actor: "web:owner", summary: "Owner-confirmed subHUB backup import", expectedRevision: body.expectedRevision,
        });
        return sendJson(response, 200, { workspace, revision: db.getRevision(), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/migration/preview") {
        const body = await readJson(request, config.maxBodyBytes);
        if (body.apiHub === undefined && body.agentHub === undefined && body.buddyHub === undefined) throw new Error("missing_required_fields");
        safeImportedData(body);
        return sendJson(response, 200, { ...previewLegacyMigration(body), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/migration/commit") {
        const body = await readJson(request, config.maxBodyBytes);
        if (body.apiHub === undefined && body.agentHub === undefined && body.buddyHub === undefined) throw new Error("missing_required_fields");
        safeImportedData(body);
        const preview = previewLegacyMigration(body);
        if (!preview.canCommit && body.confirmConflicts !== true) throw new Error("migration_conflicts_unresolved");
        const workspace = db.replaceWorkspace(preview.workspace, {
          actor: "migration:owner", summary: `Legacy migration: ${preview.stats.catalogItems} items, ${preview.stats.entitlements} entitlements`, expectedRevision: body.expectedRevision,
        });
        return sendJson(response, 200, { workspace, revision: db.getRevision(), stats: preview.stats, warnings: preview.warnings, conflicts: preview.conflicts, requestId });
      }

      const statusMatch = url.pathname.match(/^\/v1\/web\/catalog\/items\/([^/]+)\/status$/);
      if (request.method === "PATCH" && statusMatch) {
        const body = await readJson(request, config.maxBodyBytes);
        if (!adoptionStatuses.has(body.adoptionStatus)) throw new Error("missing_required_fields");
        const item = db.updateAdoptionStatus(decodeURIComponent(statusMatch[1]), body.adoptionStatus);
        return sendJson(response, 200, { item, revision: db.getRevision(), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/snapshots") {
        const body = await readJson(request, config.maxBodyBytes);
        requireFields(body, ["entitlementId", "observedAt", "sourceLabel"]);
        safeImportedData(body);
        return sendJson(response, 201, { snapshot: db.addSnapshot(body), revision: db.getRevision(), requestId });
      }

      if (request.method === "POST" && url.pathname === "/v1/web/evaluations") {
        const body = await readJson(request, config.maxBodyBytes);
        requireFields(body, ["itemId", "evaluatedAt", "utilization", "outputValue", "quotaPressure", "trend", "recommendation", "confidence"]);
        safeImportedData(body);
        return sendJson(response, 201, { evaluation: db.addEvaluation(body), revision: db.getRevision(), requestId });
      }

      return sendJson(response, 404, { error: "not_found", requestId });
    } catch (error) {
      const status = statusForError(error);
      return sendJson(response, status, {
        error: status === 500 ? "internal_error" : error.message,
        ...(Array.isArray(error.paths) ? { paths: error.paths } : {}), requestId,
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

function textSummary(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : fallback;
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
  }
}
