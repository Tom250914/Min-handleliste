"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const pricing = require("../pricing.js");
const { validateSources, normalizeProduct, fetchProduct, updatePrices } = require("../scripts/update-prices.cjs");
const now = new Date("2026-11-03T12:00:00Z");
const source = {
  id: "p1", productId: 123, name: "Test kylling 400g", store: "Testbutikk",
  packageSize: { amount: 400, unit: "g" }
};
const rawProduct = () => ({
  id: 123, name: source.name,
  store: [{ name: "Annen butikk" }, { name: source.store }],
  weight: 400, weight_unit: "g", current_price: 60, current_unit_price: 150,
  price_history: [{ price: 60, date: "2026-11-03T06:00:00Z" }]
});
const config = { version: 1, products: [source] };
const quote = () => normalizeProduct(rawProduct(), source, now.toISOString());

test("converts meat, dry pasta, rice, oil and package fractions", () => {
  assert.equal(pricing.quantityFor(150, "g", "kg"), .15);
  assert.equal(pricing.quantityFor(75, "g", "kg"), .075);
  assert.equal(pricing.quantityFor(75, "g", "pakke", { amount: 500, unit: "g" }), .15);
  assert.equal(pricing.quantityFor(15, "ml", "l"), .015);
  assert.equal(pricing.quantityFor(2, "stk", "pakke", { amount: 12, unit: "stk" }), 1 / 6);
  assert.equal(pricing.quantityFor(200, "g", "stk", { amount: 400, unit: "g" }), .5);
  assert.throws(() => pricing.quantityFor(75, "g", "l"), /Uforenlige/);
  assert.throws(() => pricing.quantityFor(75, "g", "pakke"), /mangler/);
});

test("derives unit prices from exact package price and content", () => {
  assert.equal(pricing.priceForUnit(quote(), "kg"), 150);
  assert.equal(pricing.priceForUnit(quote(), "pakke"), 60);
  assert.equal(pricing.priceForUnit(quote(), "stk"), 60);
  assert.throws(() => pricing.priceForUnit(quote(), "l"), /Uforenlige/);
});

test("selects the exact store and keeps current, unit and historical prices independent", () => {
  const product = rawProduct();
  product.current_unit_price = 999;
  product.price_history = [{ price: 59, date: "2026-11-03T06:00:00Z" }];
  const normalized = normalizeProduct(product, source, now.toISOString());
  assert.equal(normalized.store, source.store);
  assert.equal(normalized.packagePrice, 60);
  assert.equal(normalized.observedAt, "2026-11-03T06:00:00Z");
  assert.throws(() => normalizeProduct({
    ...product, store: [{ name: "Annen butikk" }]
  }, source, now.toISOString()), /identitet/);
  assert.throws(() => normalizeProduct({
    ...product, store: [{ name: source.store }, { name: source.store }]
  }, source, now.toISOString()), /identitet/);
});

test("requires source identity, package size and a valid non-future price date", () => {
  assert.equal(quote().observedAt, "2026-11-03T06:00:00Z");
  for (const change of [
    { id: 124 }, { name: "Middag med kylling" }, { store: { name: "Annen butikk" } },
    { weight: 500 }, { weight: null }, { current_price: 0 }, { current_price: "60" },
    { current_unit_price: "150" }, { current_unit_price: 0 },
    { price_history: [] }, { price_history: [{ price: 0, date: "2026-11-03" }] },
    { price_history: [{ price: 60, date: "2026-11-04" }] }
  ]) {
    assert.throws(() => normalizeProduct({ ...rawProduct(), ...change }, source, now.toISOString()));
  }
  const unsorted = rawProduct();
  unsorted.price_history.push({ price: 50, date: "2026-10-01" });
  assert.equal(normalizeProduct(unsorted, source, now.toISOString()).packagePrice, 60);
});

test("rejects incomplete, stale, future or disabled snapshots", () => {
  const snapshot = { version: 1, status: "ok", generatedAt: now.toISOString() };
  assert.equal(pricing.verified(snapshot, quote(), +now), true);
  assert.equal(pricing.verified(snapshot, quote(), +now + 49 * 3600000), false);
  assert.equal(pricing.verified({ ...snapshot, status: "missing-key" }, quote(), +now), false);
  assert.equal(pricing.verified(snapshot, { ...quote(), store: "" }, +now), false);
  assert.equal(pricing.verified(snapshot, { ...quote(), observedAt: "2026-11-04" }, +now), false);
  assert.equal(pricing.verified(snapshot, { ...quote(), observedAt: "2026-10-30" }, +now), false);
  assert.equal(pricing.verified({ ...snapshot, generatedAt: "bad" }, quote(), +now), false);
});

test("source mappings reject duplicates, invalid IDs and missing package content", () => {
  assert.equal(validateSources(config).length, 1);
  assert.throws(() => validateSources({ version: 1, products: [source, source] }));
  assert.throws(() => validateSources({ version: 1, products: [{ ...source, productId: "../secrets" }] }));
  assert.throws(() => validateSources({ version: 1, products: [{ ...source, packageSize: null }] }));
});

test("missing secret disables verification without calling API or losing previous quotes", async () => {
  const previous = { products: { p1: quote() } };
  const result = await updatePrices({
    key: "", previous, config, now,
    fetchImpl: () => { throw new Error("Must not fetch"); }
  });
  assert.equal(result.status, "missing-key");
  assert.deepEqual(result.products, previous.products);
  assert.equal(pricing.verified(result, result.products.p1, +now), false);
});

test("authenticated update emits only allowlisted public fields", async () => {
  let requests = 0;
  const result = await updatePrices({
    key: "test-secret-never-publish", config, now, wait: async () => {},
    fetchImpl: async (url, options) => {
      requests++;
      assert.equal(url, "https://kassal.app/api/v1/products/id/123");
      assert.equal(options.headers.Authorization, "Bearer test-secret-never-publish");
      assert.equal(options.redirect, "error");
      return { ok: true, json: async () => ({ data: { ...rawProduct(), privateField: "not-public" } }) };
    }
  });
  assert.equal(requests, 1);
  assert.equal(result.status, "ok");
  assert.equal(result.products.p1.packagePrice, 60);
  assert.ok(!JSON.stringify(result).includes("test-secret"));
  assert.ok(!JSON.stringify(result).includes("privateField"));
});

test("rate limits and server errors retry, auth/schema failures fail closed", async () => {
  let count = 0;
  const waits = [];
  const result = await fetchProduct(123, "test-secret", async () => {
    count++;
    return count < 3 ? { ok: false, status: count === 1 ? 429 : 503 } :
      { ok: true, json: async () => ({ data: rawProduct() }) };
  }, async (ms) => waits.push(ms));
  assert.equal(result.id, 123);
  assert.deepEqual(waits, [60000, 60000]);
  await assert.rejects(() => fetchProduct(123, "test-secret",
    async () => ({ ok: false, status: 401 })), /HTTP 401/);
  await assert.rejects(() => updatePrices({
    key: "test-secret", config: { version: 1, products: [] }, now
  }), /Ingen godkjente/);
  await assert.rejects(() => updatePrices({
    key: "test-secret", config, now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: {} }) })
  }), /identitet/);
});
