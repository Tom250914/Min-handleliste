"use strict";

const { readFile, writeFile, rename } = require("node:fs/promises");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { validQuote, baseAmount } = require("../pricing.js");
const root = path.resolve(__dirname, "..");

function validateSources(config) {
  if (config?.version !== 1 || !Array.isArray(config.products)) throw new Error("Ugyldig kildefil.");
  const ids = new Set();
  for (const source of config.products) {
    if (!/^p([1-9]|[1-3][0-9]|4[0-3])$/.test(source.id) || ids.has(source.id) ||
        !Number.isSafeInteger(source.productId) || source.productId <= 0 ||
        typeof source.name !== "string" || !source.name.trim() ||
        typeof source.store !== "string" || !source.store.trim()) {
      throw new Error("Ugyldig eller duplisert produktkobling.");
    }
    baseAmount(source.packageSize?.amount, source.packageSize?.unit);
    ids.add(source.id);
  }
  return config.products;
}

function normalizeProduct(product, source, fetchedAt) {
  if (product?.id !== source.productId || product.name !== source.name ||
      product.store?.name !== source.store) throw new Error(`Produktidentitet endret for ${source.id}.`);
  const actual = baseAmount(product.weight, product.weight_unit);
  const expected = baseAmount(source.packageSize.amount, source.packageSize.unit);
  if (actual.unit !== expected.unit || Math.abs(actual.amount - expected.amount) > 1e-8) {
    throw new Error(`Pakningsstørrelse endret for ${source.id}.`);
  }
  if (!Array.isArray(product.price_history)) throw new Error(`Prisdato mangler for ${source.id}.`);
  const latest = product.price_history
    .filter((entry) => typeof entry.date === "string" && Number.isFinite(Date.parse(entry.date)))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!latest || latest.price !== product.current_price ||
      Date.parse(latest.date) > Date.parse(fetchedAt)) {
    throw new Error(`Pris og prisdato kan ikke verifiseres for ${source.id}.`);
  }
  const quote = {
    productId: product.id,
    name: product.name,
    store: product.store.name,
    packageSize: { amount: product.weight, unit: product.weight_unit },
    packagePrice: product.current_price,
    observedAt: latest.date,
    fetchedAt
  };
  if (!validQuote(quote)) throw new Error(`Ufullstendige prisdata for ${source.id}.`);
  return quote;
}

async function fetchProduct(productId, key, fetchImpl = fetch, wait = delay) {
  const url = `https://kassal.app/api/v1/products/id/${productId}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(20000)
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await wait(60000);
      continue;
    }
    // Never log upstream bodies, request headers or transport errors containing credentials.
    if (!response.ok) throw new Error(`Kassalapp svarte HTTP ${response.status}.`);
    const body = await response.json();
    return body.data;
  }
}

async function updatePrices({ key, config, previous, fetchImpl = fetch, wait = delay, now }) {
  const timestamp = () => (now || new Date()).toISOString();
  const generatedAt = timestamp();
  if (!key) {
    console.warn("KASSALAPP_API_KEY mangler. Prisene merkes som ikke verifisert.");
    return { version: 1, status: "missing-key", generatedAt, products: previous?.products || {} };
  }
  const sources = validateSources(config);
  if (!sources.length) throw new Error("Ingen godkjente produktkoblinger i data/product-sources.json.");
  const products = {};
  for (const [index, source] of sources.entries()) {
    if (index) await wait(1100);
    const product = await fetchProduct(source.productId, key, fetchImpl, wait);
    products[source.id] = normalizeProduct(product, source, timestamp());
  }
  return { version: 1, status: "ok", generatedAt: timestamp(), products };
}

async function main() {
  const config = JSON.parse(await readFile(path.join(root, "data/product-sources.json"), "utf8"));
  const target = path.join(root, "data/prices.json");
  const previous = JSON.parse(await readFile(target, "utf8"));
  const snapshot = await updatePrices({ key: process.env.KASSALAPP_API_KEY, config, previous });
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temp, target);
  console.log(`Prisdata skrevet: ${snapshot.status}, ${Object.keys(snapshot.products).length} produkter.`);
}

if (require.main === module) {
  main().catch(() => {
    console.error("Prisoppdatering feilet. Sjekk API-tilgang, produktkoblinger og responsformat. Forrige prisfil er beholdt.");
    process.exitCode = 1;
  });
}

module.exports = { validateSources, normalizeProduct, fetchProduct, updatePrices };
