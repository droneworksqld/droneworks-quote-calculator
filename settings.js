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
  var APPROVED_KEY = 'dwq.approvedRateSheet.v1'; // kept separate so importing a sheet can't approve itself
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
    // Missing newer fields are allowed so settings saved before they existed still load.
    if (p.setupFee !== undefined && p.setupFee !== null && !isNonNeg(p.setupFee)) e.push('Set up / pack up / clean up fee must be 0 or more.');
    ['labourRatePerHour', 'overheadPerJob', 'defaultRoundTo'].forEach(function (k) {
      if (p[k] !== undefined && !isNonNeg(p[k])) e.push(k + ' must be 0 or more.');
    });
    if (p.defaultRoundTo !== undefined && [0, 1, 10, 50, 100].indexOf(p.defaultRoundTo) === -1) e.push('Default rounding must be $1, $10, $50 or $100.');
    if (p.targetMarginPct !== undefined && (!isNonNeg(p.targetMarginPct) || p.targetMarginPct >= 95)) e.push('Target margin must be between 0% and 94%.');
    if (p.rateSheet !== undefined && (!p.rateSheet || typeof p.rateSheet.version !== 'string')) e.push('Rate sheet needs a version.');
    if (p.lidar !== undefined) {
      if (!p.lidar || typeof p.lidar !== 'object') e.push('LiDAR rates are not valid.');
      else ['halfDayPrice', 'halfDayFloor', 'halfDayHours', 'fullDayTarget', 'fullDayFloor', 'fullDayHours', 'hourlyRate', 'hourlyFloor', 'processingPerHour', 'minBillableHours', 'suggestFullDayAboveHours'].forEach(function (k) {
        if (p.lidar[k] !== undefined && !isNonNeg(p.lidar[k])) e.push('LiDAR ' + k + ' must be 0 or more.');
      });
    }
    if (p.hire !== undefined) {
      if (!p.hire || typeof p.hire !== 'object') e.push('Hire settings are not valid.');
      else {
        ['insurance', 'consumables', 'fuel'].forEach(function (k) { if (p.hire[k] !== undefined && !isNonNeg(p.hire[k])) e.push('Hire ' + k + ' must be 0 or more.'); });
        if (p.hire.suppliers !== undefined && !Array.isArray(p.hire.suppliers)) e.push('Hire suppliers must be a list.');
      }
    }

    if (!Array.isArray(p.jobTypes) || p.jobTypes.length === 0) e.push('Add at least one job type.');
    else {
      var ids = {};
      p.jobTypes.forEach(function (j, i) {
        var n = 'Job type ' + (i + 1);
        if (!j || typeof j.id !== 'string' || !j.id) e.push(n + ': missing id.');
        else if (ids[j.id]) e.push(n + ': duplicate id "' + j.id + '".');
        else ids[j.id] = true;
        if (!j || typeof j.label !== 'string' || !j.label.trim()) e.push(n + ': needs a name.');
        var isL = j && j.kind === 'lidar';
        if (!j || (!isL && !isNonNeg(j.ratePerHa))) e.push(n + ': $/ha must be 0 or more.');
        if (!j || (!isL && j.unit !== 'L' && j.unit !== 'kg')) e.push(n + ': unit must be L or kg.');
        if (j && j.haPerHour !== undefined && j.haPerHour !== null && !isNonNeg(j.haPerHour)) e.push(n + ': ha per hour must be 0 or more.');
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
      var filled = withDefaults(p, example);
      return { pricing: filled, isCustom: true, isExample: samePricing(filled, example), error: null };
    } catch (err2) {
      return { pricing: clone(example), isCustom: false, isExample: true, error: 'Saved settings could not be read.' };
    }
  }

  /**
   * Older saved settings (schema 1) don't have the newer sections. Fill anything missing from the
   * example so the app keeps working. Filled-in LiDAR / hire sections stay marked as example.
   */
  function withDefaults(p, example) {
    var out = clone(p);
    Object.keys(example).forEach(function (k) {
      if (out[k] === undefined || out[k] === null) out[k] = clone(example[k]);
    });
    if (!out.jobTypes.some(function (j) { return j.kind === 'lidar'; })) {
      example.jobTypes.forEach(function (j) { if (j.kind === 'lidar') out.jobTypes.push(clone(j)); });
    }
    if (!out.rateSheet) out.rateSheet = { version: 'UNVERSIONED', date: '' };
    return out;
  }

  /** Kept for compatibility with v1 callers: fill fields added after a settings file was saved. */
  function applyDefaults(p, example) { return example ? withDefaults(p, example) : clone(p); }

  function getApprovedVersion(storage) {
    try { return storage.getItem(APPROVED_KEY) || ''; } catch (e) { return ''; }
  }
  function setApprovedVersion(storage, v) {
    v = (v || '').trim();
    if (v) storage.setItem(APPROVED_KEY, v); else storage.removeItem(APPROVED_KEY);
  }

  /**
   * Compare the loaded rate sheet with the approved version recorded in Settings.
   * Returns { ok, version, date, approved, message }. ok=false means: warn and disable Copy quote.
   * If no approved version has been recorded yet, ok is true (nothing to compare against).
   */
  function checkRateSheet(pricing, approved) {
    var rs = (pricing && pricing.rateSheet) || {};
    var version = rs.version || 'UNVERSIONED';
    var res = { ok: true, version: version, date: rs.date || '', approved: approved || '', message: '' };
    if (approved && approved !== version) {
      res.ok = false;
      res.message = 'Rate sheet mismatch: loaded "' + version + '" but the approved version is "' + approved + '". Copy quote is disabled until you import the approved sheet or update the approved version in Settings.';
    }
    return res;
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
      version: 2,
      rateSheetVersion: pricing && pricing.rateSheet ? pricing.rateSheet.version : undefined,
      exportedAt: (now || new Date()).toISOString(),
      pricing: pricing
    }, null, 2);
  }

  /** Parse an exported settings file (or a bare pricing object). Returns { ok, pricing, errors }.
   *  Pass example to fill defaults (such as setupFee) on older files. */
  function parseImport(text, example) {
    var data;
    try { data = JSON.parse(text); } catch (err) { return { ok: false, errors: ['That file is not valid JSON.'] }; }
    var p = data && data.pricing && typeof data.pricing === 'object' ? data.pricing : data;
    var errs = validatePricing(p);
    if (errs.length) return { ok: false, errors: errs };
    if (example) p = applyDefaults(p, example);
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
    APPROVED_KEY: APPROVED_KEY,
    withDefaults: withDefaults,
    applyDefaults: applyDefaults,
    getApprovedVersion: getApprovedVersion,
    setApprovedVersion: setApprovedVersion,
    checkRateSheet: checkRateSheet,
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
