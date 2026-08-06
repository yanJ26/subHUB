export const DEFAULT_EXCHANGE_RATES = Object.freeze({
  rates: Object.freeze({ CNY: 1, USD: 6.7714, EUR: 7.6969 }),
  rateDate: "2026-07-28",
  source: "built_in",
});

function attribute(xml, currency) {
  const tag = xml.match(new RegExp(`<Cube\\b[^>]*\\bcurrency=["']${currency}["'][^>]*>`, "i"))?.[0];
  return tag?.match(/\brate=["']([^"']+)["']/i)?.[1] || null;
}

export function parseEcbRates(xml) {
  if (typeof xml !== "string" || xml.length > 1_000_000) throw new Error("exchange_rate_payload_invalid");
  const rateDate = xml.match(/<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']/i)?.[1];
  const usdPerEur = Number(attribute(xml, "USD"));
  const cnyPerEur = Number(attribute(xml, "CNY"));
  if (!rateDate || !Number.isFinite(usdPerEur) || !Number.isFinite(cnyPerEur)
    || usdPerEur < 0.5 || usdPerEur > 2 || cnyPerEur < 4 || cnyPerEur > 12) {
    throw new Error("exchange_rate_payload_invalid");
  }
  return {
    rates: { CNY: 1, USD: Number((cnyPerEur / usdPerEur).toFixed(4)), EUR: Number(cnyPerEur.toFixed(4)) },
    rateDate,
    source: "ecb",
  };
}

export async function fetchEcbRates(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { "Accept": "application/xml,text/xml;q=0.9" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`exchange_rate_http_${response.status}`);
  return parseEcbRates(await response.text());
}
