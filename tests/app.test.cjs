"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const pricing = require("../pricing.js");
const html = readFileSync(path.join(__dirname, "../index.html"), "utf8");
const script = html.match(/<script>([\s\S]+?)<\/script>/)[1];

function app(saved = null, snapshot = null, fetchError = false) {
  const elements = new Map();
  const listeners = new Map();
  const storage = new Map(saved ? [["min-handleliste-v1", JSON.stringify(saved)]] : []);
  const alerts = [];
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      value: selector === "#servings" ? "1" : "", innerHTML: "", textContent: "",
      style: {}, classList: { toggle() {} }, focus() {}, scrollIntoView() {}, reset() {},
      addEventListener(event, handler) { listeners.set(`${selector}:${event}`, handler); }
    });
    return elements.get(selector);
  };
  const context = vm.createContext({
    HandlelistePricing: pricing,
    document: { querySelector: element },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async () => {
      if (fetchError) throw new Error("Offline");
      return { ok: true, json: async () => snapshot || { version: 1, status: "unconfigured", products: {} } };
    },
    setInterval() {}, alert: (message) => alerts.push(message), confirm: () => true
  });
  vm.runInContext(script, context);
  const run = (code) => vm.runInContext(code, context);
  const clickRecipe = (index, servings = 1) => {
    element("#servings").value = String(servings);
    listeners.get("#recipe-list:click")({
      target: { closest: () => ({ dataset: { recipe: String(index) } }) }
    });
  };
  return { run, element, listeners, storage, alerts, clickRecipe };
}

function freshSnapshot() {
  const date = new Date().toISOString();
  return {
    version: 1, status: "ok", generatedAt: date,
    products: {
      p1: {
        productId: 123, name: "Test kylling 400g", store: "Testbutikk",
        packageSize: { amount: 400, unit: "g" }, packagePrice: 60, observedAt: date, fetchedAt: date
      },
      p21: {
        productId: 124, name: "Test pasta 1kg", store: "Testbutikk",
        packageSize: { amount: 1, unit: "kg" }, packagePrice: 30, observedAt: date, fetchedAt: date
      }
    }
  };
}

test("all 30 dinners add compatible portions for 1, 2 and 8 people", () => {
  for (const servings of [1, 2, 8]) {
    for (let recipe = 0; recipe < 30; recipe++) {
      const instance = app();
      instance.clickRecipe(recipe, servings);
      assert.deepEqual(instance.alerts, [], `recipe ${recipe}, servings ${servings}`);
      const items = JSON.parse(instance.run("JSON.stringify(state.items)"));
      assert.ok(items.length >= 3);
      for (const item of items) {
        assert.ok(item.quantity > 0);
        if (["p1", "p2", "p3", "p39"].includes(item.productId)) assert.equal(item.quantity, .15 * servings);
        if (item.productId === "p23") assert.equal(item.quantity, .075 * servings);
        if (item.productId === "p21") assert.equal(item.quantity, .15 * servings);
      }
    }
  }
});

test("repeated dinners accumulate without floating-point drift and retain small quantities", () => {
  const instance = app();
  instance.clickRecipe(0);
  instance.clickRecipe(0);
  assert.equal(instance.run("state.items.find(i => i.productId === 'p1').quantity"), .3);
  assert.equal(instance.run("state.items.find(i => i.productId === 'p25').quantity"), .03);
  const oil = instance.run("state.items.find(i => i.productId === 'p25').id");
  instance.listeners.get("#shopping-list:change")({
    target: { dataset: { id: oil, action: "quantity" }, value: ".015" }
  });
  assert.equal(instance.run("state.items.find(i => i.productId === 'p25').quantity"), .015);
});

test("legacy localStorage, custom products, checked items, budget and manual prices survive refresh", async () => {
  const baseline = app().run("JSON.stringify(defaultState())");
  const saved = JSON.parse(baseline);
  saved.products[0].price = 79;
  saved.products.push({ id: "custom-test", name: "Egen vare", price: 7, unit: "stk", category: "Basisvarer" });
  saved.items.push({ id: "legacy-item", productId: "p1", quantity: .25, checked: true });
  saved.budget = 800;
  const instance = app(saved, freshSnapshot());
  await instance.run("loadPrices()");
  assert.deepEqual(JSON.parse(instance.run("JSON.stringify(state)")), saved);
  assert.equal(instance.run("effectivePrice(productById('p1'))"), 79);
  assert.equal(instance.storage.get("min-handleliste-v1"), JSON.stringify(saved));
  assert.match(instance.element("#shopping-list").innerHTML, /Manuell pris/);
});

test("fresh source price converts units without overwriting stored product or shopping quantity", async () => {
  const instance = app(null, freshSnapshot());
  await instance.run("loadPrices()");
  assert.equal(instance.run("effectivePrice(productById('p1'))"), 150);
  assert.equal(instance.run("productById('p1').price"), 129);
  instance.clickRecipe(1);
  assert.equal(instance.run("state.items.find(i => i.productId === 'p21').quantity"), .15);
  assert.equal(instance.run("effectivePrice(productById('p21'))"), 15);
  assert.match(instance.element("#shopping-list").innerHTML, /Testbutikk/);
  assert.match(instance.element("#shopping-list").innerHTML, /400 g/);
  assert.match(instance.element("#shopping-list").innerHTML, /150 kr\/kg/);
  assert.match(instance.element("#shopping-list").innerHTML, /Sist prisoppdatert:/);
});

test("manual price input persists through subsequent source refresh and reload", async () => {
  const snapshot = freshSnapshot();
  const instance = app(null, snapshot);
  await instance.run("loadPrices()");
  instance.clickRecipe(0);
  const id = instance.run("state.items[0].id");
  instance.listeners.get("#shopping-list:change")({
    target: { dataset: { id, action: "price" }, value: "111" }
  });
  await instance.run("loadPrices()");
  assert.equal(instance.run("effectivePrice(productById('p1'))"), 111);
  const restored = app(JSON.parse(instance.storage.get("min-handleliste-v1")), snapshot);
  await restored.run("loadPrices()");
  assert.equal(restored.run("effectivePrice(productById('p1'))"), 111);
});

test("saving the edit form explicitly preserves even a price equal to the old default", async () => {
  const instance = app();
  instance.run("editProduct('p1')");
  instance.element("#product-name-input").value = "Kyllingfilet";
  instance.element("#product-category-input").value = "Kjøtt og fisk";
  instance.element("#product-price-input").value = "129";
  instance.element("#product-unit-input").value = "kg";
  instance.listeners.get("#product-form:submit")({ preventDefault() {} });
  instance.run(`priceSnapshot = ${JSON.stringify(freshSnapshot())}`);
  assert.equal(instance.run("effectivePrice(productById('p1'))"), 129);
  assert.equal(instance.run("productById('p1').priceOverride"), true);
});

test("a larger source package reprices the fixed calculation unit without changing saved quantities", async () => {
  const instance = app(null, freshSnapshot());
  instance.clickRecipe(1);
  const before = instance.storage.get("min-handleliste-v1");
  await instance.run("loadPrices()");
  assert.equal(instance.storage.get("min-handleliste-v1"), before);
  assert.equal(instance.run("state.items.find(i => i.productId === 'p21').quantity"), .15);
  assert.equal(instance.run("effectivePrice(productById('p21'))"), 15);
  assert.equal(instance.run("unitLabel(productById('p21'))"), "500 g");
});

test("offline, missing-key and stale source states show unverified estimates and keep list usable", async () => {
  const stale = freshSnapshot();
  stale.products.p1.observedAt = "2020-01-01";
  for (const [snapshot, offline] of [[null, true], [{ ...freshSnapshot(), status: "missing-key" }, false], [stale, false]]) {
    const instance = app(null, snapshot, offline);
    await instance.run("loadPrices()");
    assert.equal(instance.run("effectivePrice(productById('p1'))"), 129);
    assert.match(instance.element("#product-list").innerHTML, /Pris ikke verifisert/);
    instance.clickRecipe(0);
    assert.equal(instance.run("state.items.length"), 4);
  }
});

test("incompatible edited units fail explicitly without partial additions or losing existing data", () => {
  const instance = app();
  instance.run("productById('p23').unit = 'l'; addProduct('p1', .2)");
  instance.clickRecipe(0);
  assert.equal(instance.alerts.length, 1);
  assert.match(instance.alerts[0], /Middagen ble ikke lagt til/);
  assert.equal(instance.run("state.items.length"), 1);
  assert.equal(instance.run("state.items[0].quantity"), .2);
});

test("source content is escaped before it is rendered", async () => {
  const snapshot = freshSnapshot();
  snapshot.products.p1.store = '<img src=x onerror="bad()">';
  const instance = app(null, snapshot);
  await instance.run("loadPrices()");
  assert.ok(!instance.element("#product-list").innerHTML.includes("<img"));
  assert.match(instance.element("#product-list").innerHTML, /&lt;img/);
});
