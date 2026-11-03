"use strict";

const pricing = (() => {
  const maxAge = 48 * 60 * 60 * 1000;
  const units = {
    g: ["kg", .001], hg: ["kg", .1], kg: ["kg", 1],
    ml: ["l", .001], cl: ["l", .01], dl: ["l", .1], l: ["l", 1],
    stk: ["stk", 1], piece: ["stk", 1], m: ["m", 1]
  };
  const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  const recent = (date, now) => typeof date === "string" &&
    Number.isFinite(Date.parse(date)) && Date.parse(date) <= now && now - Date.parse(date) <= maxAge;

  function baseAmount(amount, unit) {
    if (!positive(amount) || !units[unit]) throw new Error("Ugyldig mengde eller enhet.");
    const [base, factor] = units[unit];
    return { amount: amount * factor, unit: base };
  }

  function quantityFor(amount, unit, productUnit, packageSize) {
    const needed = baseAmount(amount, unit);
    if (productUnit === "pakke" || (productUnit === "stk" && needed.unit !== "stk")) {
      if (!packageSize) throw new Error("Pakningsstørrelse mangler.");
      const pack = baseAmount(packageSize.amount, packageSize.unit);
      if (needed.unit !== pack.unit) throw new Error("Uforenlige pakningsenheter.");
      return needed.amount / pack.amount;
    }
    const target = baseAmount(1, productUnit);
    if (needed.unit !== target.unit) throw new Error("Uforenlige enheter.");
    return needed.amount / target.amount;
  }

  function validQuote(quote) {
    return Boolean(quote && Number.isSafeInteger(quote.productId) && quote.productId > 0 &&
      typeof quote.name === "string" && quote.name.trim() &&
      typeof quote.store === "string" && quote.store.trim() &&
      positive(quote.packagePrice) && positive(quote.packageSize?.amount) &&
      units[quote.packageSize?.unit] &&
      typeof quote.observedAt === "string" && Number.isFinite(Date.parse(quote.observedAt)) &&
      typeof quote.fetchedAt === "string" && Number.isFinite(Date.parse(quote.fetchedAt)));
  }

  function verified(snapshot, quote, now = Date.now()) {
    return snapshot?.version === 1 && snapshot.status === "ok" && validQuote(quote) &&
      recent(snapshot.generatedAt, now) && recent(quote.observedAt, now) && recent(quote.fetchedAt, now);
  }

  function priceForUnit(quote, unit) {
    if (!validQuote(quote)) throw new Error("Ugyldige prisdata.");
    if (unit === "pakke" || unit === "stk") return quote.packagePrice;
    return quote.packagePrice * quantityFor(1, unit, "pakke", quote.packageSize);
  }

  return { baseAmount, quantityFor, validQuote, verified, priceForUnit };
})();

if (typeof module !== "undefined" && module.exports) module.exports = pricing;
else globalThis.HandlelistePricing = pricing;
