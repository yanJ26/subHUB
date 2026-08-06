import assert from "node:assert/strict";
import test from "node:test";
import { parseEcbRates } from "../src/exchange-rates.mjs";

test("derives CNY values for EUR and USD from the ECB EUR-base feed", () => {
  const parsed = parseEcbRates(`<?xml version="1.0"?><Cube><Cube time='2026-08-05'>
    <Cube currency='USD' rate='1.1389'/><Cube currency='CNY' rate='7.7059'/></Cube></Cube>`);
  assert.equal(parsed.rateDate, "2026-08-05");
  assert.equal(parsed.rates.EUR, 7.7059);
  assert.equal(parsed.rates.USD, Number((7.7059 / 1.1389).toFixed(4)));
  assert.equal(parsed.source, "ecb");
});

test("rejects incomplete or implausible exchange-rate payloads", () => {
  assert.throws(() => parseEcbRates("<Cube time='2026-08-05'><Cube currency='USD' rate='99'/></Cube>"));
});
