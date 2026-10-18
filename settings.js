/*
 * DroneWorks QLD quote calculator — settings storage.
 * Real pricing is saved ONLY in this browser's localStorage (never in the repo).
 * Functions take a Storage-like object ({getItem,setItem,removeItem}) so they can be tested in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DWSettings = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRICING_KEY = 'dwq.pricing.v1';
  var COUNTER_KEY = 'dwq.quoteCounter.v1';
  var EXPORT_APP = 'droneworks-quote-calculator';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function isNonNeg(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }

  /** Returns an array of error strings; empty = valid. */
  function validatePricing(p) {
    var e = [];
    if (!p || typeof p !== 'object') return ['Settings are empty or not an object.'];
    if (!isNonNeg(p.gstRate) || p.gstRate > 1) e.push('GST rate must be between 0% and 100%.');
    if (!isNonNeg(p.minimumCharge)) e.push('Minimum job charge must be 0 or more.');
    if (!isNonNeg(p.chemicalMarkupPct)) e.push('Product markup must be 0% or more.');
    if (p.quoteValidityDays !== undefined && !isNonNeg(p.quoteValidityDays)) e.push('Quote validity must be 0 or more days.');
    if (!p.travel || !isNonNeg(p.travel.perKm)) e.push('Travel $/km must be 0 or more.');
    if (!p.travel || !isNonNeg(p.travel.freeKm)) e.push('Free km must be 0 or more.');
    if (!p.surcharges || !isNonNeg(p.surcharges.rushPct)) e.push('Rush surcharge must be 0% or more.');
    if (!p.surcharges || !isNonNeg(p.surcharges.terrainPct)) e.push('Terrain surcharge must be 0% or more.');

    if (!Array.isArray(p.jobTypes) || p.jobTypes.length === 0) e.push('Add at least one job type.');
    else {
      var ids = {};
      p.jobTypes.forEach(function (j, i) {
        var n = 'Job type ' + (i + 1);
        if (!j || typeof j.id !== 'string' || !j.id) e.push(n + ': missing id.');
        else if (ids[j.id]) e.push(n + ': duplicate id "' + j.id + '".');
        else ids[j.id] = true;
        if (!j || typeof j.label !== 'string' || !j.label.trim()) e.push(n + ': needs a name.');
        if (!j || !isNonNeg(j.ratePerHa)) e.push(n + ': $/ha must be 0 or more.');
        if (!j || (j.unit !== 'L' && j.unit !== 'kg')) e.push(n + ': unit must be L or kg.');
      });
    }

    if (!Array.isArray(p.products)) e.push('Products list is missing.');
    else {
      var pids = {};
      p.products.forEach(function (pr, i) {
        var n = 'Product ' + (i + 1);
        if (!pr || typeof pr.id !== 'string' || !pr.id) e.push(n + ': missing id.');
        else if (pids[pr.id]) e.push(n + ': duplicate id "' + pr.id + '".');
        else pids[pr.id] = true;
        if (!pr || typeof pr.name !== 'string' || !pr.name.trim()) e.push(n + ': needs a name.');
        if (!pr || (pr.unit !== 'L' && pr.unit !== 'kg')) e.push(n + ': unit must be L or kg.');
        if (!pr || !isNonNeg(pr.unitPrice)) e.push(n + ': price must be 0 or more.');
        if (!pr || !isNonNeg(pr.defaultRate)) e.push(n + ': default rate must be 0 or more.');
        if (pr && pr.jobTypes !== undefined && !Array.isArray(pr.jobTypes)) e.push(n + ': jobTypes must be a list.');
      });
    }
    return e;
  }

  function samePricing(a, b) {
    return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
  }

  // Stable key order for comparison.
  function normalise(o) {
    if (Array.isArray(o)) return o.map(normalise);
    if (o && typeof o === 'object') {
      var out = {};
      Object.keys(o).sort().forEach(function (k) { out[k] = normalise(o[k]); });
      return out;
    }
    return o;
  }

  /**
   * Load pricing. Returns { pricing, isCustom, isExample, error }.
   * isExample is true when no valid custom pricing is saved, or saved pricing is identical to the example.
   */
  function loadPricing(storage, example) {
    var raw = null;
    try { raw = storage.getItem(PRICING_KEY); } catch (err) { raw = null; }
    if (!raw) return { pricing: clone(example), isCustom: false, isExample: true, error: null };
    try {
      var p = JSON.parse(raw);
      var errs = validatePricing(p);
      if (errs.length) return { pricing: clone(example), isCustom: false, isExample: true, error: 'Saved settings were invalid and were ignored: ' + errs[0] };
      return { pricing: p, isCustom: true, isExample: samePricing(p, example), error: null };
    } catch (err2) {
      return { pricing: clone(example), isCustom: false, isExample: true, error: 'Saved settings could not be read.' };
    }
  }

  function savePricing(storage, pricing) {
    var errs = validatePricing(pricing);
    if (errs.length) return { ok: false, errors: errs };
    storage.setItem(PRICING_KEY, JSON.stringify(pricing));
    return { ok: true, errors: [] };
  }

  function clearPricing(storage) { storage.removeItem(PRICING_KEY); }

  function exportPricing(pricing, now) {
    return JSON.stringify({
      app: EXPORT_APP,
      kind: 'pricing-settings',
      version: 1,
      exportedAt: (now || new Date()).toISOString(),
      pricing: pricing
    }, null, 2);
  }

  /** Parse an exported settings file (or a bare pricing object). Returns { ok, pricing, errors }. */
  function parseImport(text) {
    var data;
    try { data = JSON.parse(text); } catch (err) { return { ok: false, errors: ['That file is not valid JSON.'] }; }
    var p = data && data.pricing && typeof data.pricing === 'object' ? data.pricing : data;
    var errs = validatePricing(p);
    if (errs.length) return { ok: false, errors: errs };
    return { ok: true, pricing: p, errors: [] };
  }

  // ---- Quote numbers: DWQ-YYYYMMDD-NNN. A number is only "used up" when a quote is copied/printed.
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function dateKey(d) { return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2); }

  function readCounter(storage) {
    try { var c = JSON.parse(storage.getItem(COUNTER_KEY) || 'null'); if (c && typeof c.seq === 'number') return c; } catch (e) {}
    return { seq: 0 };
  }

  function peekQuoteNumber(storage, date) {
    return 'DWQ-' + dateKey(date) + '-' + pad(readCounter(storage).seq + 1, 3);
  }

  function commitQuoteNumber(storage, date) {
    var c = readCounter(storage);
    c.seq += 1;
    storage.setItem(COUNTER_KEY, JSON.stringify(c));
    return 'DWQ-' + dateKey(date) + '-' + pad(c.seq, 3);
  }

  return {
    PRICING_KEY: PRICING_KEY,
    COUNTER_KEY: COUNTER_KEY,
    validatePricing: validatePricing,
    samePricing: samePricing,
    loadPricing: loadPricing,
    savePricing: savePricing,
    clearPricing: clearPricing,
    exportPricing: exportPricing,
    parseImport: parseImport,
    peekQuoteNumber: peekQuoteNumber,
    commitQuoteNumber: commitQuoteNumber
  };
});
