import path from "node:path";
import { parseMasterKey } from "./secrets.mjs";

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig() {
  return {
    host: process.env.APIHUB_GATEWAY_HOST || "127.0.0.1",
    port: numberFromEnv("APIHUB_GATEWAY_PORT", 8787),
    dbPath: path.resolve(process.env.APIHUB_DB_PATH || "./data/apihub.sqlite"),
    integrationToken: process.env.APIHUB_OPENCLAW_TOKEN || "",
    hmacSecret: process.env.APIHUB_OPENCLAW_HMAC_SECRET || "",
    webInternalToken: process.env.APIHUB_WEB_INTERNAL_TOKEN || "",
    modelBaseUrl: (process.env.APIHUB_GATE_MODEL_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    modelApiKey: process.env.APIHUB_GATE_MODEL_API_KEY || "",
    model: process.env.APIHUB_GATE_MODEL || "",
    secretsMasterKey: parseMasterKey(process.env.APIHUB_SECRETS_MASTER_KEY || ""),
    allowPrivateModelEndpoints: process.env.APIHUB_ALLOW_PRIVATE_MODEL_ENDPOINTS === "true",
    isProduction: process.env.NODE_ENV === "production",
    exchangeRateUrl: process.env.APIHUB_EXCHANGE_RATE_URL || "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    confidenceThreshold: numberFromEnv("APIHUB_GATE_CONFIDENCE_THRESHOLD", 0.85),
    approvalTtlMinutes: numberFromEnv("APIHUB_APPROVAL_TTL_MINUTES", 15),
    maxBodyBytes: numberFromEnv("APIHUB_MAX_BODY_BYTES", 32 * 1024),
  };
}

export function validateRuntimeConfig(config) {
  const missing = [];
  if (!config.integrationToken) missing.push("APIHUB_OPENCLAW_TOKEN");
  if (!config.webInternalToken) missing.push("APIHUB_WEB_INTERNAL_TOKEN");
  if (!config.modelApiKey) missing.push("APIHUB_GATE_MODEL_API_KEY or saved BYOK key");
  if (!config.model) missing.push("APIHUB_GATE_MODEL or saved BYOK model");
  return missing;
}
