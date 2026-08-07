import http from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { ApiHubDatabase } from "./db.mjs";
import { loadConfig, validateRuntimeConfig } from "./config.mjs";
import { parseWithModel } from "./llm.mjs";
import { fetchEcbRates } from "./exchange-rates.mjs";
import { evaluateParsedIntent, validateCommonFields } from "./policy.mjs";
import { normalizeFields } from "./schema.mjs";
import {
  containsLikelySecret,
  createApprovalCode,
  hashApprovalCode,
  safeEqual,
  sha256,
  verifyBearer,
  verifyHmac,
} from "./security.mjs";

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return { raw, json: raw ? JSON.parse(raw) : {} };
}

function validateEnvelope(body) {
  const errors = [];
  for (const field of ["sourceMessageId", "senderId", "channel", "message", "timestamp"]) {
    if (typeof body[field] !== "string" || !body[field].trim()) errors.push(field);
  }
  if (body.message?.length > 12_000) errors.push("message_too_long");
  if (body.sourceMessageId?.length > 200 || body.senderId?.length > 200 || body.channel?.length > 80) errors.push("metadata_too_long");
  const sentAt = Date.parse(body.timestamp);
  if (Number.isNaN(sentAt) || Math.abs(Date.now() - sentAt) > 15 * 60_000) errors.push("timestamp_out_of_range");
  return errors;
}

function publicDraft(draft, includePayload = false) {
  if (!draft) return null;
  const result = {
    id: draft.id,
    intent: draft.intent,
    targetName: draft.target_name,
    summary: draft.summary,
    status: draft.status,
    expiresAt: draft.expires_at,
    createdAt: draft.created_at,
  };
  if (includePayload) result.payload = draft.payload;
  return result;
}

function normalizeManualSubscription(input = {}) {
  const fields = normalizeFields(input);
  return {
    name: fields.name || "",
    provider: fields.provider || "",
    plan: fields.plan || "",
    price: fields.price ?? 0,
    currency: fields.currency || "CNY",
    billingCycle: fields.billingCycle || "monthly",
    renewalDate: fields.renewalDate || null,
    channel: fields.channel || "",
    loginDevice: fields.loginDevice || "",
    tags: fields.tags || [],
    autoRenew: Boolean(fields.autoRenew),
    invoiceStatus: fields.invoiceStatus || "pending",
    invoiceNumber: fields.invoiceNumber || "",
    invoiceUrl: fields.invoiceUrl || "",
    reminderDays: fields.reminderDays ?? 7,
    notes: fields.notes || "",
    archived: Boolean(input.archived),
  };
}

function validateManualSubscription(value, allowedTags) {
  const issues = validateCommonFields(value, allowedTags);
  if (!value.name) issues.push({ code: "missing_name", message: "订阅名称不能为空" });
  if (!["CNY", "USD", "EUR"].includes(value.currency)) issues.push({ code: "invalid_currency", message: "不支持的币种" });
  if (!["monthly", "yearly"].includes(value.billingCycle)) issues.push({ code: "invalid_billing_cycle", message: "不支持的订阅周期" });
  if (!["issued", "pending", "none"].includes(value.invoiceStatus)) issues.push({ code: "invalid_invoice_status", message: "不支持的发票状态" });
  return issues;
}

function normalizeTags(input) {
  if (!Array.isArray(input) || input.length > 24) return null;
  const tags = input.map((tag, index) => ({
    id: typeof tag?.id === "string" ? tag.id.trim().slice(0, 80) : "",
    name: typeof tag?.name === "string" ? tag.name.trim().slice(0, 32) : "",
    bg: typeof tag?.bg === "string" ? tag.bg.trim() : "",
    color: typeof tag?.color === "string" ? tag.color.trim() : "",
    sortOrder: index,
  }));
  const validColor = (value) => /^#[0-9a-f]{6}$/i.test(value);
  if (tags.some((tag) => !tag.id || !tag.name || !validColor(tag.bg) || !validColor(tag.color))) return null;
  if (new Set(tags.map((tag) => tag.id)).size !== tags.length) return null;
  if (new Set(tags.map((tag) => tag.name.toLowerCase())).size !== tags.length) return null;
  return tags;
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
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    const localHttpAllowed = parsed.protocol === "http:" && loopback && (!config.isProduction || config.allowPrivateModelEndpoints);
    if (parsed.protocol !== "https:" && !localHttpAllowed) {
      issues.push({ code: "https_required", message: "模型接口必须使用 HTTPS；仅本机回环地址允许 HTTP" });
    }
    const privateHost = isPrivateIpv4(parsed.hostname) || parsed.hostname === "[::1]" || parsed.hostname === "localhost";
    if (privateHost && !loopback && !config.allowPrivateModelEndpoints) {
      issues.push({ code: "private_endpoint_blocked", message: "默认不允许私网模型地址；如确有需要，请在 VPS 显式启用私网端点" });
    }
  } catch {
    issues.push({ code: "invalid_base_url", message: "模型接口地址格式无效" });
  }
  return { value: { baseUrl, model, apiKey }, issues };
}

function effectiveModelConfig(db, config) {
  return db.getEffectiveModelConfig({ ...config, allowedTags: db.listTagNames() });
}

function runtimeMissing(config, db) {
  if (db.getModelSettingsStatus(config).source !== "byok") return validateRuntimeConfig(config);
  const missing = validateRuntimeConfig(config).filter((name) => !name.startsWith("APIHUB_GATE_MODEL"));
  if (!config.secretsMasterKey) missing.push("APIHUB_SECRETS_MASTER_KEY");
  return missing;
}

const faviconCache = new Map();
const FAVICON_SOURCES = [
  (domain) => `https://logo.clearbit.com/${domain}`,
  (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  (domain) => `https://${domain}/favicon.ico`,
];

async function fetchFavicon(domain) {
  const cached = faviconCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached;
  for (const buildUrl of FAVICON_SOURCES) {
    try {
      const res = await fetch(buildUrl(domain), { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") || "image/png";
      if (!contentType.startsWith("image/")) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 50) continue;
      const entry = { buffer, contentType, expiresAt: Date.now() + 86_400_000 };
      faviconCache.set(domain, entry);
      return entry;
    } catch { /* try next source */ }
  }
  throw new Error("all_sources_failed");
}

export function createGatewayServer({ config, db, parseModel = parseWithModel, fetchExchangeRates = fetchEcbRates, now = () => new Date() }) {
  let exchangeRateRefresh = null;

  async function getMonthlyExchangeRates() {
    const today = now().toISOString().slice(0, 10);
    const currentMonth = today.slice(0, 7);
    const cached = db.getExchangeRates();
    if (cached.lastAttemptDate?.slice(0, 7) === currentMonth) return cached;
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

  return http.createServer(async (request, response) => {
    const requestId = randomUUID();
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const missing = runtimeMissing(config, db);
        return sendJson(response, missing.length ? 503 : 200, {
          status: missing.length ? "degraded" : "ok",
          missingConfiguration: missing,
          requestId,
        });
      }

      if (request.method === "GET" && url.pathname === "/favicon") {
        const domain = url.searchParams.get("domain");
        if (!domain || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) return sendJson(response, 400, { error: "invalid_domain", requestId });
        try {
          const { buffer, contentType } = await fetchFavicon(domain);
          response.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
            "Content-Length": buffer.length,
          });
          response.end(buffer);
        } catch {
          return sendJson(response, 404, { error: "favicon_not_found", requestId });
        }
        return;
      }

      if (url.pathname.startsWith("/v1/web/")) {
        if (!verifyBearer(request.headers.authorization, config.webInternalToken)) {
          return sendJson(response, 401, { error: "unauthorized", requestId });
        }

        if (request.method === "GET" && url.pathname === "/v1/web/state") {
          return sendJson(response, 200, {
            subscriptions: db.listSubscriptions(true),
            tags: db.listTags(),
            exchangeRates: await getMonthlyExchangeRates(),
            requestId,
          });
        }

        if (request.method === "GET" && url.pathname === "/v1/web/model-settings") {
          return sendJson(response, 200, { settings: db.getModelSettingsStatus(config), requestId });
        }

        if (request.method === "PUT" && url.pathname === "/v1/web/model-settings") {
          const { json: body } = await readBody(request, config.maxBodyBytes);
          const { value, issues } = normalizeModelSettings(body.settings, config);
          if (issues.length) return sendJson(response, 400, { error: "invalid_model_settings", issues, requestId });
          try {
            const settings = db.saveModelSettings(value);
            return sendJson(response, 200, { settings, requestId });
          } catch (error) {
            if (error.message === "secrets_master_key_unavailable") {
              return sendJson(response, 503, { error: error.message, message: "VPS 尚未配置独立的加密主密钥，无法安全保存 API Key。", requestId });
            }
            if (error.message === "api_key_required") {
              return sendJson(response, 400, { error: error.message, message: "首次配置必须填写 API Key。", requestId });
            }
            throw error;
          }
        }

        if (request.method === "DELETE" && url.pathname === "/v1/web/model-settings") {
          return sendJson(response, 200, {
            deleted: db.deleteModelSettings(),
            settings: db.getModelSettingsStatus(config),
            requestId,
          });
        }

        if (request.method === "PUT" && url.pathname === "/v1/web/tags") {
          const { json: body } = await readBody(request, config.maxBodyBytes);
          const tags = normalizeTags(body.tags);
          if (!tags) return sendJson(response, 400, { error: "invalid_tags", requestId });
          return sendJson(response, 200, {
            tags: db.replaceTags(tags),
            subscriptions: db.listSubscriptions(true),
            requestId,
          });
        }

        if (request.method === "POST" && url.pathname === "/v1/web/import") {
          const { raw, json: body } = await readBody(request, Math.max(config.maxBodyBytes, 1024 * 1024));
          if (containsLikelySecret(raw)) return sendJson(response, 422, { error: "likely_secret", message: "导入内容疑似包含 API Key、Token 或 Secret，未保存。", requestId });
          if (!Array.isArray(body.subscriptions) || body.subscriptions.length > 1000) {
            return sendJson(response, 400, { error: "invalid_subscriptions", requestId });
          }
          const tags = normalizeTags(body.tags);
          if (!tags) return sendJson(response, 400, { error: "invalid_tags", requestId });
          const allowedTags = tags.map((tag) => tag.name);
          const subscriptions = body.subscriptions.map(normalizeManualSubscription);
          const issues = subscriptions.flatMap((value, index) => validateManualSubscription(value, allowedTags).map((entry) => ({ ...entry, index })));
          if (issues.length) return sendJson(response, 400, { error: "invalid_import", issues: issues.slice(0, 20), requestId });
          return sendJson(response, 200, { ...db.replaceAllData(subscriptions, tags), requestId });
        }

        if (request.method === "POST" && url.pathname === "/v1/web/intake") {
          const { json: body } = await readBody(request, config.maxBodyBytes);
          const message = typeof body.message === "string" ? body.message.trim() : "";
          if (!message || message.length > 12_000) return sendJson(response, 400, { error: "invalid_message", requestId });
          const sourceMessageId = `web:${randomUUID()}`;
          if (containsLikelySecret(message)) {
            db.createInbox({ sourceMessageId, senderId: "owner", channel: "web", messageHash: sha256(message), status: "rejected_secret", errorCode: "likely_secret" });
            return sendJson(response, 422, { status: "rejected", error: "likely_secret", message: "内容疑似包含 API Key、Token 或 Secret，原文未保存。", requestId });
          }
          const inbox = db.createInbox({ sourceMessageId, senderId: "owner", channel: "web", messageHash: sha256(message) });
          let parsed;
          try {
            parsed = await parseModel(message, effectiveModelConfig(db, config));
          } catch (error) {
            db.updateInbox(inbox.id, { status: "parse_failed", errorCode: String(error.message).split(":")[0] });
            return sendJson(response, 503, { status: "parse_failed", error: "semantic_gate_unavailable", message: "语义闸机暂时不可用，未写入任何订阅数据。", requestId });
          }
          const decision = evaluateParsedIntent(parsed, db, { ...config, allowedTags: db.listTagNames() });
          if (decision.status === "query_ready") {
            db.updateInbox(inbox.id, { status: "query_completed" });
            return sendJson(response, 200, { status: "query_completed", results: decision.results, requestId });
          }
          if (["rejected", "needs_clarification"].includes(decision.status)) {
            db.updateInbox(inbox.id, { status: decision.status, errorCode: decision.issues[0]?.code || null });
            return sendJson(response, decision.status === "rejected" ? 422 : 200, { status: decision.status, issues: decision.issues, requestId });
          }
          const expiresAt = new Date(Date.now() + config.approvalTtlMinutes * 60_000).toISOString();
          const draft = db.createDraft({
            inboxId: inbox.id,
            intent: parsed.intent,
            targetId: decision.target?.id || null,
            targetName: parsed.target.name,
            payload: decision.payload,
            summary: decision.summary,
            approvalHash: sha256(randomUUID()),
            expiresAt,
          });
          db.updateInbox(inbox.id, { status: "pending_confirmation", draftId: draft.id });
          return sendJson(response, 201, { status: "pending_confirmation", draft: publicDraft(draft, true), requestId });
        }

        const subscriptionMatch = url.pathname.match(/^\/v1\/web\/subscriptions(?:\/([0-9a-z_-]+))?$/i);
        if (subscriptionMatch) {
          if (request.method === "POST" && !subscriptionMatch[1]) {
            const { raw, json: body } = await readBody(request, config.maxBodyBytes);
            if (containsLikelySecret(raw)) return sendJson(response, 422, { error: "likely_secret", requestId });
            const value = normalizeManualSubscription(body.subscription);
            const issues = validateManualSubscription(value, db.listTagNames());
            if (issues.length) return sendJson(response, 400, { error: "invalid_subscription", issues, requestId });
            return sendJson(response, 201, { subscription: db.createSubscription(value), requestId });
          }
          if (request.method === "PUT" && subscriptionMatch[1]) {
            const { raw, json: body } = await readBody(request, config.maxBodyBytes);
            if (containsLikelySecret(raw)) return sendJson(response, 422, { error: "likely_secret", requestId });
            const value = normalizeManualSubscription(body.subscription);
            const issues = validateManualSubscription(value, db.listTagNames());
            if (issues.length) return sendJson(response, 400, { error: "invalid_subscription", issues, requestId });
            const subscription = db.updateSubscription(subscriptionMatch[1], value);
            return subscription ? sendJson(response, 200, { subscription, requestId }) : sendJson(response, 404, { error: "subscription_not_found", requestId });
          }
          if (request.method === "DELETE" && subscriptionMatch[1]) {
            return db.deleteSubscription(subscriptionMatch[1])
              ? sendJson(response, 200, { status: "deleted", requestId })
              : sendJson(response, 404, { error: "subscription_not_found", requestId });
          }
        }

        const webDraftMatch = url.pathname.match(/^\/v1\/web\/drafts\/([0-9a-f-]+)\/(commit|cancel)$/i);
        if (webDraftMatch && request.method === "POST") {
          const draft = db.getDraft(webDraftMatch[1]);
          if (!draft) return sendJson(response, 404, { error: "draft_not_found", requestId });
          if (webDraftMatch[2] === "cancel") {
            return sendJson(response, db.cancelDraft(draft.id) ? 200 : 409, { status: "cancelled", requestId });
          }
          if (draft.status !== "pending_confirmation") return sendJson(response, 409, { error: "draft_not_pending", status: draft.status, requestId });
          if (Date.parse(draft.expires_at) <= Date.now()) return sendJson(response, 410, { error: "draft_expired", requestId });
          const inbox = db.getInbox(draft.inbox_id);
          const result = db.commitDraft(draft, "web:owner", inbox.source_message_id);
          return sendJson(response, 200, { status: "committed", ...result, requestId });
        }

        return sendJson(response, 404, { error: "not_found", requestId });
      }

      if (!url.pathname.startsWith("/v1/openclaw/")) return sendJson(response, 404, { error: "not_found", requestId });
      if (!verifyBearer(request.headers.authorization, config.integrationToken)) return sendJson(response, 401, { error: "unauthorized", requestId });

      if (request.method === "POST" && url.pathname === "/v1/openclaw/intake") {
        const { raw, json: body } = await readBody(request, config.maxBodyBytes);
        if (!verifyHmac(raw, request.headers["x-apihub-signature"], config.hmacSecret)) return sendJson(response, 401, { error: "invalid_signature", requestId });
        const envelopeErrors = validateEnvelope(body);
        if (envelopeErrors.length) return sendJson(response, 400, { error: "invalid_envelope", fields: envelopeErrors, requestId });

        const existing = db.findInboxBySourceMessageId(body.sourceMessageId);
        if (existing) {
          const draft = existing.draft_id ? db.getDraft(existing.draft_id) : db.getDraftByInboxId(existing.id);
          return sendJson(response, 200, { status: existing.status, duplicate: true, draft: publicDraft(draft), requestId });
        }

        if (containsLikelySecret(body.message)) {
          db.createInbox({ sourceMessageId: body.sourceMessageId, senderId: body.senderId, channel: body.channel, messageHash: sha256(body.message), status: "rejected_secret", errorCode: "likely_secret" });
          return sendJson(response, 422, { status: "rejected", error: "likely_secret", message: "消息疑似包含 API Key、Token 或 Secret，原文未保存。", requestId });
        }

        const inbox = db.createInbox({ sourceMessageId: body.sourceMessageId, senderId: body.senderId, channel: body.channel, messageHash: sha256(body.message) });
        let parsed;
        try {
          parsed = await parseModel(body.message, effectiveModelConfig(db, config));
        } catch (error) {
          db.updateInbox(inbox.id, { status: "parse_failed", errorCode: String(error.message).split(":")[0] });
          return sendJson(response, 503, { status: "parse_failed", error: "semantic_gate_unavailable", message: "消息已登记但未写入任何订阅数据。", requestId });
        }

        const decision = evaluateParsedIntent(parsed, db, { ...config, allowedTags: db.listTagNames() });
        if (decision.status === "query_ready") {
          db.updateInbox(inbox.id, { status: "query_completed" });
          return sendJson(response, 200, { status: "query_completed", results: decision.results, requestId });
        }
        if (["rejected", "needs_clarification"].includes(decision.status)) {
          db.updateInbox(inbox.id, { status: decision.status, errorCode: decision.issues[0]?.code || null });
          return sendJson(response, decision.status === "rejected" ? 422 : 200, { status: decision.status, issues: decision.issues, requestId });
        }

        const draftId = randomUUID();
        const approvalCode = createApprovalCode();
        const expiresAt = new Date(Date.now() + config.approvalTtlMinutes * 60_000).toISOString();
        const draft = db.createDraft({
          id: draftId,
          inboxId: inbox.id,
          intent: parsed.intent,
          targetId: decision.target?.id || null,
          targetName: parsed.target.name,
          payload: decision.payload,
          summary: decision.summary,
          approvalHash: hashApprovalCode(draftId, approvalCode),
          expiresAt,
        });
        db.updateInbox(inbox.id, { status: "pending_confirmation", draftId: draft.id });
        return sendJson(response, 201, {
          status: "pending_confirmation",
          draft: publicDraft(draft),
          approval: {
            code: approvalCode,
            command: `/apihub-confirm ${draft.id} ${approvalCode}`,
            expiresAt,
          },
          requestId,
        });
      }

      const draftMatch = url.pathname.match(/^\/v1\/openclaw\/drafts\/([0-9a-f-]+)(?:\/(commit|cancel))?$/i);
      if (draftMatch) {
        const draft = db.getDraft(draftMatch[1]);
        if (!draft) return sendJson(response, 404, { error: "draft_not_found", requestId });
        if (request.method === "GET" && !draftMatch[2]) return sendJson(response, 200, { draft: publicDraft(draft), requestId });
        if (request.method === "POST" && draftMatch[2] === "cancel") {
          const { raw } = await readBody(request, config.maxBodyBytes);
          if (!verifyHmac(raw, request.headers["x-apihub-signature"], config.hmacSecret)) return sendJson(response, 401, { error: "invalid_signature", requestId });
          return sendJson(response, db.cancelDraft(draft.id) ? 200 : 409, { status: "cancelled", requestId });
        }
        if (request.method === "POST" && draftMatch[2] === "commit") {
          const { raw, json: body } = await readBody(request, config.maxBodyBytes);
          if (!verifyHmac(raw, request.headers["x-apihub-signature"], config.hmacSecret)) return sendJson(response, 401, { error: "invalid_signature", requestId });
          if (draft.status !== "pending_confirmation") return sendJson(response, 409, { error: "draft_not_pending", status: draft.status, requestId });
          if (Date.parse(draft.expires_at) <= Date.now()) return sendJson(response, 410, { error: "draft_expired", requestId });
          const suppliedHash = hashApprovalCode(draft.id, String(body.approvalCode || ""));
          if (!safeEqual(suppliedHash, draft.approval_hash)) return sendJson(response, 403, { error: "invalid_approval_code", requestId });
          const inbox = db.getInbox(draft.inbox_id);
          const result = db.commitDraft(draft, `openclaw:${inbox.sender_id}`, inbox.source_message_id);
          return sendJson(response, 200, { status: "committed", ...result, requestId });
        }
      }

      if (request.method === "GET" && url.pathname === "/v1/openclaw/subscriptions/search") {
        return sendJson(response, 200, { results: db.searchSubscriptions(url.searchParams.get("q") || ""), requestId });
      }
      if (request.method === "GET" && url.pathname === "/v1/openclaw/reports/upcoming") {
        const requestedDays = Number(url.searchParams.get("days") || 30);
        const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(365, Math.floor(requestedDays))) : 30;
        return sendJson(response, 200, { days, results: db.listUpcoming(days), requestId });
      }

      return sendJson(response, 404, { error: "not_found", requestId });
    } catch (error) {
      const status = error.message === "body_too_large" ? 413 : error instanceof SyntaxError ? 400 : 500;
      if (status === 500) console.error(`[${requestId}] gateway_error`, error.message);
      return sendJson(response, status, { error: status === 500 ? "internal_error" : error.message, requestId });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  if (!config.integrationToken || !config.webInternalToken) {
    console.error("APIHUB_OPENCLAW_TOKEN and APIHUB_WEB_INTERNAL_TOKEN are required; refusing to start without authentication.");
    process.exit(1);
  }
  const db = new ApiHubDatabase(config.dbPath, { secretsMasterKey: config.secretsMasterKey });
  const server = createGatewayServer({ config, db });
  server.listen(config.port, config.host, () => {
    const missing = runtimeMissing(config, db);
    console.log(`API Hub gateway listening on http://${config.host}:${config.port}`);
    if (missing.length) console.warn(`Gateway is degraded until configured: ${missing.join(", ")}`);
  });
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
