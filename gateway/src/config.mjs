import path from "node:path";
import { parseMasterKey } from "./secrets.mjs";

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig() {
  return {
    host: process.env.SUBHUB_GATEWAY_HOST || "127.0.0.1",
    port: numberFromEnv("SUBHUB_GATEWAY_PORT", 8790),
    dbPath: path.resolve(process.env.SUBHUB_DB_PATH || "./data/subhub.sqlite"),
    webInternalToken: process.env.SUBHUB_WEB_INTERNAL_TOKEN || "",
    modelBaseUrl: (process.env.SUBHUB_GATE_MODEL_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    modelApiKey: process.env.SUBHUB_GATE_MODEL_API_KEY || "",
    model: process.env.SUBHUB_GATE_MODEL || "",
    secretsMasterKey: parseMasterKey(process.env.SUBHUB_SECRETS_MASTER_KEY || ""),
    allowPrivateModelEndpoints: process.env.SUBHUB_ALLOW_PRIVATE_MODEL_ENDPOINTS === "true",
    isProduction: process.env.NODE_ENV === "production",
    confidenceThreshold: numberFromEnv("SUBHUB_GATE_CONFIDENCE_THRESHOLD", 0.85),
    intakeTtlMinutes: numberFromEnv("SUBHUB_INTAKE_TTL_MINUTES", 15),
    exchangeRateUrl: process.env.SUBHUB_EXCHANGE_RATE_URL || "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    maxBodyBytes: numberFromEnv("SUBHUB_MAX_BODY_BYTES", 2 * 1024 * 1024),
  };
}

export function validateRuntimeConfig(config) {
  const missing = [];
  if (!config.webInternalToken) missing.push("SUBHUB_WEB_INTERNAL_TOKEN");
  return missing;
}
