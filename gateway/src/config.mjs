import path from "node:path";

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
    exchangeRateUrl: process.env.SUBHUB_EXCHANGE_RATE_URL || "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
    maxBodyBytes: numberFromEnv("SUBHUB_MAX_BODY_BYTES", 2 * 1024 * 1024),
  };
}

export function validateRuntimeConfig(config) {
  const missing = [];
  if (!config.webInternalToken) missing.push("SUBHUB_WEB_INTERNAL_TOKEN");
  return missing;
}
