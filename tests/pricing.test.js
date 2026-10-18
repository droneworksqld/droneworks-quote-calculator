// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pricing.js');
const S = require('../settings.js');
const EXAMPLE = require('../pricing.example.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const base = (over) => Object.assign({
  jobType: 'spraying', hectares: 100, productId: null, supply: 'client', appRate: null,
  distanceKm: 0, distanceMode: 'oneway', rush: false, terrain: false
}, over);
const line = (r, key) => r.lines.find((l) => l.key === key);

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('example pricing is valid and clearly round placeholder numbers', () => {
  assert.deepEqual(S.validatePricing(EXAMPLE), []);
  EXAMPLE.products.forEach((p) => assert.match(p.name, /^Example /));
});

test('basic spraying job: per-ha rate, GST 10%, per-ha price', () => {
  const r = P.calculateQuote(base({ hectares: 100 }), EXAMPLE);
  assert.ok(r.ok);
  assert.equal(line(r, 'application').amount, 3000); // 100 ha x $30
  assert.equal(line(r, 'minimum'), undefined);
  assert.equal(r.subtotal, 3000);
  assert.equal(r.gst, 300);
  assert.equal(r.total, 3300);
  assert.equal(r.perHaEx, 30);
  assert.equal(r.perHaInc, 33);
});

test('minimum job charge tops up small jobs', () => {
  const r = P.calculateQuote(base({ hectares: 5 }), EXAMPLE); // 5 x 30 = 150 < 500
  assert.equal(line(r, 'application').amount, 150);
  assert.equal(line(r, 'minimum').amount, 350);
  assert.equal(r.subtotal, 500);
  assert.equal(r.total, 550);
  assert.ok(r.meta.minimumApplied);
});

test('minimum charge accounts for surcharges and excludes travel/product', () => {
  // 10 ha spreading = 200, +20% rush = 40, +15% terrain = 30 -> 270, top-up 230 -> 500
  const r = P.calculateQuote(base({ jobType: 'spreading', hectares: 10, rush: true, terrain: true, distanceKm: 60 }), EXAMPLE);
  assert.equal(line(r, 'rush').amount, 40);
  assert.equal(line(r, 'terrain').amount, 30);
  assert.equal(line(r, 'minimum').amount, 230);
  // travel: 60 one-way -> 120 return, minus 50 free = 70 km x $2 = 140
  assert.equal(line(r, 'travel').amount, 140);
  assert.equal(r.subtotal, 640);
  assert.equal(r.gst, 64);
  assert.equal(r.total, 704);
});

test('travel: one-way doubles, return used as entered, free km respected', () => {
  const one = P.calculateQuote(base({ distanceKm: 20, distanceMode: 'oneway' }), EXAMPLE); // 40 km <= 50 free
  assert.equal(line(one, 'travel').amount, 0);
  const ret = P.calculateQuote(base({ distanceKm: 150, distanceMode: 'return' }), EXAMPLE); // 100 km x 2
  assert.equal(line(ret, 'travel').amount, 200);
  assert.equal(ret.meta.chargedKm, 150);
  const none = P.calculateQuote(base({ distanceKm: null }), EXAMPLE);
  assert.equal(line(none, 'travel'), undefined);
});

test('DroneWorks-supplied chemical: rate x ha x unit price x (1 + markup)', () => {
  const r = P.calculateQuote(base({ hectares: 120, productId: 'ex-herbicide', supply: 'droneworks', appRate: 2 }), EXAMPLE);
  // 2 L/ha x 120 ha x $10 x 1.10 = 2640
  assert.equal(line(r, 'product').amount, 2640);
  assert.equal(line(r, 'application').amount, 3600);
  assert.equal(r.subtotal, 6240);
  assert.equal(r.gst, 624);
  assert.equal(r.total, 6864);
  assert.equal(r.perHaInc, 57.2);
});

test('client-supplied product adds no chemical cost', () => {
  const r = P.calculateQuote(base({ hectares: 120, productId: 'ex-herbicide', supply: 'client', appRate: 2 }), EXAMPLE);
  assert.equal(line(r, 'product'), undefined);
  assert.equal(r.subtotal, 3600);
  assert.equal(r.meta.product.suppliedBy, 'client');
  assert.equal(r.meta.product.qty, 240);
});

test('cents rounding stays exact', () => {
  const p = clone(EXAMPLE); p.jobTypes[0].ratePerHa = 27.35;
  const r = P.calculateQuote(base({ hectares: 33.3 }), p); // 910.755 -> 910.76
  assert.equal(line(r, 'application').amount, 910.76);
  assert.equal(r.gst, 91.08);
  assert.equal(r.total, 1001.84);
});

test('validation rejects empty / negative / missing inputs', () => {
  const v = (o) => P.validateInput(base(o), EXAMPLE);
  assert.ok(v({ hectares: null }).hectares);
  assert.ok(v({ hectares: NaN }).hectares);
  assert.ok(v({ hectares: 0 }).hectares);
  assert.ok(v({ hectares: -5 }).hectares);
  assert.ok(v({ distanceKm: -1 }).distanceKm);
  assert.ok(v({ appRate: -2 }).appRate);
  assert.ok(v({ jobType: 'nope' }).jobType);
  assert.ok(v({ distanceMode: 'x' }).distanceMode);
  assert.ok(v({ supply: 'droneworks', productId: 'ex-herbicide', appRate: null }).appRate);
  assert.ok(v({ supply: 'droneworks', productId: null, appRate: 2 }).productId);
  assert.deepEqual(v({}), {});
  assert.equal(P.calculateQuote(base({ hectares: -1 }), EXAMPLE).ok, false);
});

test('settings: defaults to example, save/load persists, banner flag logic', () => {
  const st = memStorage();
  let res = S.loadPricing(st, EXAMPLE);
  assert.equal(res.isCustom, false);
  assert.equal(res.isExample, true);

  // Saving unchanged example values keeps the example flag on
  assert.ok(S.savePricing(st, clone(EXAMPLE)).ok);
  assert.equal(S.loadPricing(st, EXAMPLE).isExample, true);

  const real = clone(EXAMPLE); real.minimumCharge = 777; real.products[0].unitPrice = 12.5;
  assert.ok(S.savePricing(st, real).ok);
  res = S.loadPricing(st, EXAMPLE);
  assert.equal(res.isCustom, true);
  assert.equal(res.isExample, false);
  assert.equal(res.pricing.minimumCharge, 777);
  assert.equal(P.calculateQuote(base({ hectares: 1 }), res.pricing).subtotal, 777);

  S.clearPricing(st);
  assert.equal(S.loadPricing(st, EXAMPLE).isExample, true);
});

test('settings: invalid values are refused and corrupt storage falls back', () => {
  const st = memStorage();
  const bad = clone(EXAMPLE); bad.travel.perKm = -1; bad.jobTypes = [];
  const r = S.savePricing(st, bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
  assert.equal(st.getItem(S.PRICING_KEY), null);
  st.setItem(S.PRICING_KEY, '{not json');
  const res = S.loadPricing(st, EXAMPLE);
  assert.equal(res.isExample, true);
  assert.ok(res.error);
});

test('settings: export -> import round trip, bare object accepted, junk rejected', () => {
  const real = clone(EXAMPLE); real.chemicalMarkupPct = 12;
  const text = S.exportPricing(real, new Date('2026-10-17T00:00:00Z'));
  const parsed = JSON.parse(text);
  assert.equal(parsed.app, 'droneworks-quote-calculator');
  const imp = S.parseImport(text);
  assert.ok(imp.ok);
  assert.deepEqual(imp.pricing, real);
  assert.ok(S.parseImport(JSON.stringify(real)).ok);
  assert.equal(S.parseImport('hello').ok, false);
  assert.equal(S.parseImport('{"pricing":{"gstRate":5}}').ok, false);
});

test('quote numbers: peek does not consume, commit increments', () => {
  const st = memStorage();
  const d = new Date(2026, 9, 17);
  assert.equal(S.peekQuoteNumber(st, d), 'DWQ-20261017-001');
  assert.equal(S.peekQuoteNumber(st, d), 'DWQ-20261017-001');
  assert.equal(S.commitQuoteNumber(st, d), 'DWQ-20261017-001');
  assert.equal(S.peekQuoteNumber(st, d), 'DWQ-20261017-002');
});
