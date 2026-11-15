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
// Legacy maths tests: same as the example but without the per-job setup fee.
const EX = Object.assign(clone(EXAMPLE), { setupFee: 0 });

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('example pricing is valid and clearly round placeholder numbers', () => {
  assert.deepEqual(S.validatePricing(EXAMPLE), []);
  EXAMPLE.products.forEach((p) => assert.match(p.name, /^Example /));
});

test('basic spraying job: per-ha rate, GST 10%, per-ha price', () => {
  const r = P.calculateQuote(base({ hectares: 100 }), EX);
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
  const r = P.calculateQuote(base({ hectares: 5 }), EX); // 5 x 30 = 150 < 500
  assert.equal(line(r, 'application').amount, 150);
  assert.equal(line(r, 'minimum').amount, 350);
  assert.equal(r.subtotal, 500);
  assert.equal(r.total, 550);
  assert.ok(r.meta.minimumApplied);
});

test('minimum charge accounts for surcharges and excludes travel/product', () => {
  // 10 ha spreading = 200, +20% rush = 40, +15% terrain = 30 -> 270, top-up 230 -> 500
  const r = P.calculateQuote(base({ jobType: 'spreading', hectares: 10, rush: true, terrain: true, distanceKm: 60 }), EX);
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
  const one = P.calculateQuote(base({ distanceKm: 20, distanceMode: 'oneway' }), EX); // 40 km <= 50 free
  assert.equal(line(one, 'travel').amount, 0);
  const ret = P.calculateQuote(base({ distanceKm: 150, distanceMode: 'return' }), EX); // 100 km x 2
  assert.equal(line(ret, 'travel').amount, 200);
  assert.equal(ret.meta.chargedKm, 150);
  const none = P.calculateQuote(base({ distanceKm: null }), EX);
  assert.equal(line(none, 'travel'), undefined);
});

test('DroneWorks-supplied chemical: rate x ha x unit price x (1 + markup)', () => {
  const r = P.calculateQuote(base({ hectares: 120, productId: 'ex-herbicide', supply: 'droneworks', appRate: 2 }), EX);
  // 2 L/ha x 120 ha x $10 x 1.10 = 2640
  assert.equal(line(r, 'product').amount, 2640);
  assert.equal(line(r, 'application').amount, 3600);
  assert.equal(r.subtotal, 6240);
  assert.equal(r.gst, 624);
  assert.equal(r.total, 6864);
  assert.equal(r.perHaInc, 57.2);
});

test('client-supplied product adds no chemical cost', () => {
  const r = P.calculateQuote(base({ hectares: 120, productId: 'ex-herbicide', supply: 'client', appRate: 2 }), EX);
  assert.equal(line(r, 'product'), undefined);
  assert.equal(r.subtotal, 3600);
  assert.equal(r.meta.product.suppliedBy, 'client');
  assert.equal(r.meta.product.qty, 240);
});

test('set up / pack up / clean up: flat fee per event, on top of the minimum, GST applies, omitted at 0', () => {
  // 5 ha spraying = 150, top-up 350 to the $500 minimum, plus 3 × $50 = 150 → 650 ex GST
  const r = P.calculateQuote(base({ hectares: 5, setupEvents: 3 }), EXAMPLE);
  assert.equal(line(r, 'application').amount, 150);
  assert.equal(line(r, 'minimum').amount, 350);
  assert.equal(line(r, 'setup').label, 'Set up / pack up / clean up');
  assert.equal(line(r, 'setup').detail, '3 × $50.00');
  assert.equal(line(r, 'setup').amount, 150);
  assert.equal(r.subtotal, 650);
  assert.equal(r.gst, 65);
  assert.equal(r.total, 715);

  const zero = P.calculateQuote(base({ hectares: 5, setupEvents: 0 }), EXAMPLE);
  assert.equal(line(zero, 'setup'), undefined);
  assert.equal(zero.subtotal, 500);
  assert.equal(line(P.calculateQuote(base({ hectares: 5 }), EXAMPLE), 'setup'), undefined);

  // Does not shrink the minimum top-up, and a custom fee is used
  const withTravel = P.calculateQuote(base({
    jobType: 'spreading', hectares: 10, rush: true, terrain: true, distanceKm: 60, setupEvents: 2
  }), EXAMPLE);
  assert.equal(line(withTravel, 'minimum').amount, 230);
  assert.equal(line(withTravel, 'travel').amount, 140);
  assert.equal(line(withTravel, 'setup').amount, 100);
  assert.equal(withTravel.subtotal, 740); // 500 minimum + 140 travel + 100 setup

  const custom = clone(EXAMPLE); custom.setupFee = 80;
  const priced = P.calculateQuote(base({ hectares: 100, setupEvents: 2 }), custom);
  assert.equal(line(priced, 'minimum'), undefined);
  assert.equal(line(priced, 'setup').detail, '2 × $80.00');
  assert.equal(line(priced, 'setup').amount, 160);
  assert.equal(priced.subtotal, 3160);
  assert.equal(priced.gst, 316);

  const free = clone(EXAMPLE); free.setupFee = 0;
  assert.equal(line(P.calculateQuote(base({ hectares: 100, setupEvents: 4 }), free), 'setup'), undefined);
});

test('set up events: whole numbers only, no negatives, max 100', () => {
  const v = (o) => P.validateInput(base(o), EXAMPLE);
  assert.equal(v({ setupEvents: 0 }).setupEvents, undefined);
  assert.equal(v({ setupEvents: null }).setupEvents, undefined);
  assert.equal(v({ setupEvents: 100 }).setupEvents, undefined);
  assert.equal(v({ setupEvents: 2 }).setupEvents, undefined);
  assert.match(v({ setupEvents: -1 }).setupEvents, /negative/);
  assert.match(v({ setupEvents: 1.5 }).setupEvents, /whole number/);
  assert.match(v({ setupEvents: 101 }).setupEvents, /too many/);
  assert.match(v({ setupEvents: NaN }).setupEvents, /whole number/);
  assert.equal(P.calculateQuote(base({ hectares: 10, setupEvents: 2.5 }), EXAMPLE).ok, false);
  assert.equal(P.calculateQuote(base({ hectares: 10, setupEvents: -3 }), EXAMPLE).ok, false);
});

test('settings: setup fee validates, survives export/import, and defaults when an older file omits it', () => {
  const bad = clone(EXAMPLE); bad.setupFee = -10;
  const refused = S.savePricing(memStorage(), bad);
  assert.equal(refused.ok, false);
  assert.ok(refused.errors.some((msg) => /pack up/.test(msg)));

  const legacy = clone(EXAMPLE);
  delete legacy.setupFee;
  assert.deepEqual(S.validatePricing(legacy), []);
  const st = memStorage();
  assert.ok(S.savePricing(st, legacy).ok);
  const loaded = S.loadPricing(st, EXAMPLE);
  assert.equal(loaded.pricing.setupFee, 50);
  assert.equal(loaded.isExample, true);

  const changed = clone(EXAMPLE); changed.setupFee = 75;
  const text = S.exportPricing(changed, new Date('2026-10-18T00:00:00Z'));
  assert.equal(JSON.parse(text).pricing.setupFee, 75);
  const imp = S.parseImport(text);
  assert.ok(imp.ok);
  assert.equal(imp.pricing.setupFee, 75);

  const oldFile = JSON.stringify({ pricing: legacy });
  const filled = S.parseImport(oldFile, EXAMPLE);
  assert.ok(filled.ok);
  assert.equal(filled.pricing.setupFee, 50);
  assert.equal(S.parseImport(oldFile).pricing.setupFee, undefined);
});

test('cents rounding stays exact', () => {
  const p = clone(EX); p.jobTypes[0].ratePerHa = 27.35;
  const r = P.calculateQuote(base({ hectares: 33.3 }), p); // 910.755 -> 910.76
  assert.equal(line(r, 'application').amount, 910.76);
  assert.equal(r.gst, 91.08);
  assert.equal(r.total, 1001.84);
});

test('validation rejects empty / negative / missing inputs', () => {
  const v = (o) => P.validateInput(base(o), EX);
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
  assert.equal(P.calculateQuote(base({ hectares: -1 }), EX).ok, false);
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

// ---------------- v0.2: setup fee, margin, rounding, GST, hire, LiDAR, rate-sheet version ----------------

const lidar = (over) => base(Object.assign({ jobType: 'lidar', hectares: null, lidarMode: 'half' }, over));
const NOMARGIN = Object.assign(clone(EXAMPLE), { overheadPerJob: 0, targetMarginPct: 0 });

test('margin: price = cost / (1 - margin)', () => {
  assert.equal(P.priceForMargin(300, 25), 400);
  assert.equal(P.priceForMargin(360, 40), 600);
  assert.equal(P.priceForMargin(500, 0), 500);
  // 10 h x $80 = 800 labour + 50 crew + 100 overhead = 950 cost -> 950 / 0.75 = 1266.67
  const r = P.calculateQuote(base({ hectares: 10, hoursPlanning: 2, hoursTravel: 2, hoursOnsite: 4, hoursProcessing: 2, crewCost: 50 }), EX);
  assert.equal(r.meta.time.labourCost, 800);
  assert.equal(r.meta.time.labourSubtotal, 850);
  assert.equal(r.meta.time.totalCosts, 950);
  assert.equal(r.meta.time.targetPrice, 1266.67);
  assert.equal(r.meta.time.rateCard, 500); // minimum charge
  assert.equal(line(r, 'time').amount, 766.67);
  assert.equal(r.subtotal, 1266.67);
  assert.equal(r.meta.time.profit, 316.67);
  assert.equal(r.meta.time.marginAchievedPct, 25);
});

test('margin: no top-up when the rate card already beats the target', () => {
  const r = P.calculateQuote(base({ hectares: 100, hoursOnsite: 5 }), EX); // cost 400+100=500 -> 666.67 < 3000
  assert.equal(line(r, 'time'), undefined);
  assert.equal(r.subtotal, 3000);
  assert.equal(r.meta.time.profit, 2500);
});

test('rounding up to $1 / $10 / $50 / $100', () => {
  assert.equal(P.roundUp(1001.84, 1), 1002);
  assert.equal(P.roundUp(1001.84, 10), 1010);
  assert.equal(P.roundUp(1001.84, 50), 1050);
  assert.equal(P.roundUp(1001.84, 100), 1100);
  assert.equal(P.roundUp(900, 100), 900); // already round: unchanged
  const p = clone(EX); p.jobTypes[0].ratePerHa = 27.35;
  const r = P.calculateQuote(base({ hectares: 33.3, roundTo: 50 }), p); // 910.76 -> 950
  assert.equal(line(r, 'rounding').amount, 39.24);
  assert.equal(r.subtotal, 950);
  assert.equal(r.gst, 95);
  assert.equal(r.total, 1045);
  assert.ok(P.validateInput(base({ roundTo: 7 }), EX).roundTo);
});

test('GST: 10% on the whole total, can be switched off', () => {
  const on = P.calculateQuote(base({ hectares: 100, distanceKm: 60 }), EX); // 3000 + 140 travel
  assert.equal(on.gst, 314);
  assert.equal(on.total, 3454);
  const off = P.calculateQuote(base({ hectares: 100, gst: false }), EX);
  assert.equal(off.gst, 0);
  assert.equal(off.total, 3000);
  assert.equal(off.meta.gstOn, false);
});

test('hire folds into the operator rate, never a separate line', () => {
  // Spraying 100 ha, example 10 ha/h -> 10 h on site. Hire 800 at 100% -> +80/h, +$8/ha
  const r = P.calculateQuote(base({ hectares: 100, hire: { on: true, cost: 800, recoveryPct: 100, jobsSharing: 1 } }), NOMARGIN);
  assert.equal(r.lines.some((l) => /hire/i.test(l.key + l.label + l.detail)), false);
  assert.equal(line(r, 'application').amount, 3800);
  assert.match(line(r, 'application').detail, /\$38\.00\/ha/);
  assert.equal(r.meta.hire.perHour, 80);
  assert.equal(r.meta.hire.onsiteHours, 10);
  assert.equal(r.meta.hire.recovered, 800);
  assert.equal(r.meta.hire.shortfall, 0);
  assert.equal(r.warnings.filter((w) => w.level !== 'info').length, 0);
  // explicit on-site hours override the estimate
  const r2 = P.calculateQuote(base({ hectares: 100, hoursOnsite: 4, hire: { on: true, cost: 800 } }), NOMARGIN);
  assert.equal(r2.meta.hire.perHour, 200);
});

test('hire: partial recovery warns but still quotes; jobs sharing splits the hire', () => {
  const r = P.calculateQuote(base({ hectares: 100, hire: { on: true, cost: 800, recoveryPct: 40 } }), NOMARGIN);
  assert.ok(r.ok);
  assert.equal(r.meta.hire.recovered, 320);
  assert.equal(r.meta.hire.shortfall, 480);
  assert.equal(r.meta.hire.recoversFull, false);
  assert.ok(r.warnings.some((w) => w.level === 'warn' && /WARNING/.test(w.text)));
  const shared = P.calculateQuote(base({ hectares: 100, hire: { on: true, cost: 900, jobsSharing: 3 } }), NOMARGIN);
  assert.equal(shared.meta.hire.share, 300);
  assert.equal(line(shared, 'application').amount, 3300);
  assert.equal(shared.meta.hire.recoversFull, true);
  // hire week already covered: nothing recovered, no warnings
  const cov = P.calculateQuote(base({ hectares: 100, hire: { on: true, cost: 800, covered: true } }), NOMARGIN);
  assert.equal(cov.meta.hire.recovered, 0);
  assert.equal(cov.warnings.length, 0);
});

test('LiDAR half day / full day floors and processing line', () => {
  const half = P.calculateQuote(lidar({ processingHours: 12 }), EX);
  assert.ok(half.ok);
  assert.equal(line(half, 'capture').amount, 2000);
  assert.equal(line(half, 'processing').amount, 1080); // 12 h x $90 (example)
  assert.equal(half.perHaEx, null);
  const fullLow = P.calculateQuote(lidar({ lidarMode: 'full', lidarRate: 900 }), EX);
  assert.equal(line(fullLow, 'capture').amount, 2500); // never below the full-day floor
  const full = P.calculateQuote(lidar({ lidarMode: 'full' }), EX);
  assert.equal(line(full, 'capture').amount, 3000);
  const withTravel = P.calculateQuote(lidar({ distanceKm: 100 }), EX); // 200 km - 50 free = 150 x 2
  assert.equal(line(withTravel, 'travel').amount, 300);
});

test('LiDAR hourly: min billable hours for owned kit, half-day floor when hire booked, full-day hint', () => {
  const owned = P.calculateQuote(lidar({ lidarMode: 'hourly', lidarHours: 1 }), EX);
  assert.equal(line(owned, 'capture').amount, 900); // min 2 h x $450 (example)
  const p = clone(EX); p.lidar.minBillableHoursEnabled = false;
  assert.equal(line(P.calculateQuote(lidar({ lidarMode: 'hourly', lidarHours: 1 }), p), 'capture').amount, 450);
  // hire booked: capture = max(hours x rate, half-day floor) ; hire 2000 folded over 3 h
  const hired = P.calculateQuote(lidar({ lidarMode: 'hourly', lidarHours: 3, hire: { on: true, cost: 2000 } }), EX);
  assert.equal(hired.meta.lidar.base, 2000);
  assert.equal(line(hired, 'capture').amount, 4000);
  assert.equal(hired.meta.hire.perHour, 666.67);
  const long = P.calculateQuote(lidar({ lidarMode: 'hourly', lidarHours: 5 }), EX);
  assert.ok(long.warnings.some((w) => /full day/.test(w.text)));
  assert.ok(P.validateInput(lidar({ lidarMode: 'hourly', lidarHours: null }), EX).lidarHours);
});

test('LiDAR hire: strong warning below hire-week cash break-even', () => {
  // break-even = 2000 hire + 80 + 40 + 40 = 2160 ; half-day floor 2000 + 0% recovered = 2000 < 2160
  const r = P.calculateQuote(lidar({ hire: { on: true, cost: 2000, recoveryPct: 0 } }), EX);
  assert.ok(r.ok, 'quote is not blocked');
  assert.equal(r.meta.hire.breakEven, 2160);
  assert.equal(r.meta.hire.shortfall, 2000);
  assert.equal(r.meta.hire.belowBreakEven, true);
  assert.ok(r.warnings.some((w) => w.level === 'danger' && /STRONG WARNING/.test(w.text)));
  assert.ok(r.warnings.some((w) => w.level === 'warn'));
  const ok = P.calculateQuote(lidar({ hire: { on: true, cost: 2000 } }), EX);
  assert.equal(ok.meta.hire.belowBreakEven, false);
  assert.equal(ok.warnings.filter((w) => w.level !== 'info').length, 0);
});

test('rate sheet version stamp and approved-version check', () => {
  const r = P.calculateQuote(base({ hectares: 10 }), EXAMPLE);
  assert.equal(r.meta.rateSheet.version, 'EXAMPLE');
  const sheet = clone(EXAMPLE); sheet.rateSheet = { version: 'v2099-01-01', date: '2099-01-01' };
  assert.equal(S.checkRateSheet(sheet, '').ok, true); // nothing approved yet
  assert.equal(S.checkRateSheet(sheet, 'v2099-01-01').ok, true);
  const bad = S.checkRateSheet(sheet, 'v2098-12-31');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /mismatch/);
  const st = memStorage();
  S.setApprovedVersion(st, ' v2099-01-01 ');
  assert.equal(S.getApprovedVersion(st), 'v2099-01-01');
  // importing a sheet must not change the approved version
  const text = S.exportPricing(sheet);
  assert.equal(JSON.parse(text).rateSheetVersion, 'v2099-01-01');
  assert.ok(S.parseImport(text).ok);
  assert.equal(S.getApprovedVersion(st), 'v2099-01-01');
});

test('old (schema 1) saved settings still load, with example LiDAR filled in', () => {
  const st = memStorage();
  const old = clone(EXAMPLE);
  ['rateSheet', 'lidar', 'hire', 'setupFee', 'labourRatePerHour', 'overheadPerJob', 'targetMarginPct', 'defaultRoundTo'].forEach((k) => delete old[k]);
  old.jobTypes = old.jobTypes.filter((j) => j.kind !== 'lidar').map((j) => { delete j.example; delete j.haPerHour; return j; });
  old.schemaVersion = 1; old.minimumCharge = 650;
  st.setItem(S.PRICING_KEY, JSON.stringify(old));
  const res = S.loadPricing(st, EXAMPLE);
  assert.equal(res.error, null);
  assert.equal(res.pricing.minimumCharge, 650);
  assert.ok(res.pricing.jobTypes.some((j) => j.kind === 'lidar'));
  assert.equal(res.pricing.lidar.example, true);
  assert.ok(P.calculateQuote(lidar({}), res.pricing).ok);
});

test('public repo files contain no real LiDAR / hire figures', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const files = ['pricing.example.js', 'pricing.js', 'settings.js', 'app.js', 'index.html', 'README.md', 'business.js'];
  const banned = [/\b4,?500\b/, /\b6,?750\b/, /\b6,?000\b/, /\b1,?200\b/, /\b3,?550\b/, /\b2,?400\b/, /Pure Environmental/i];
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    banned.forEach((re) => assert.equal(re.test(src), false, f + ' contains ' + re));
  });
  assert.equal(EXAMPLE.lidar.example, true);
  assert.equal(EXAMPLE.rateSheet.version, 'EXAMPLE');
});
