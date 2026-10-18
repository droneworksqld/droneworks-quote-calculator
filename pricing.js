/*
 * DroneWorks QLD quote calculator — pure pricing logic.
 * No DOM access here, so it can be unit-tested with Node (see tests/).
 *
 * Pricing model (all amounts ex GST until the GST line):
 *   Application fee  = hectares x job-type rate per ha
 *   Surcharges       = application fee x rush % and/or difficult-terrain %
 *   Minimum charge   = top-up so (application fee + surcharges) >= minimum job charge
 *   Travel           = max(0, charged km - free km) x $/km
 *                      charged km = one-way distance x 2, or the return distance as entered
 *   Product          = rate/ha x hectares x unit cost x (1 + markup %)   (only if DroneWorks supplies)
 *   Subtotal, GST (10%), Total inc GST, price per hectare.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DWPricing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_HECTARES = 100000;
  var MAX_KM = 5000;

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function findJobType(pricing, id) {
    for (var i = 0; i < pricing.jobTypes.length; i++) if (pricing.jobTypes[i].id === id) return pricing.jobTypes[i];
    return null;
  }

  function findProduct(pricing, id) {
    for (var i = 0; i < pricing.products.length; i++) if (pricing.products[i].id === id) return pricing.products[i];
    return null;
  }

  /**
   * Validate a quote input. Returns an object of { field: message }; empty object = valid.
   * Empty optional numbers should be passed as null / undefined / NaN.
   */
  function validateInput(input, pricing) {
    var e = {};
    if (!input || typeof input !== 'object') return { form: 'No input' };

    if (!findJobType(pricing, input.jobType)) e.jobType = 'Choose a job type.';

    var ha = input.hectares;
    if (ha === null || ha === undefined || (typeof ha === 'number' && isNaN(ha))) e.hectares = 'Enter the area in hectares.';
    else if (!isNum(ha)) e.hectares = 'Hectares must be a number.';
    else if (ha <= 0) e.hectares = 'Hectares must be more than 0.';
    else if (ha > MAX_HECTARES) e.hectares = 'That looks too large — check the hectares.';

    var supplied = input.supply === 'droneworks';
    var rate = input.appRate;
    var rateEmpty = rate === null || rate === undefined || (typeof rate === 'number' && isNaN(rate));
    if (!rateEmpty && !isNum(rate)) e.appRate = 'Rate must be a number.';
    else if (!rateEmpty && rate < 0) e.appRate = 'Rate cannot be negative.';
    else if (supplied && (rateEmpty || rate <= 0)) e.appRate = 'Enter the product rate per hectare.';

    if (supplied && !findProduct(pricing, input.productId)) {
      e.productId = 'Choose a product from the list (or set product to client supplied).';
    }

    var km = input.distanceKm;
    var kmEmpty = km === null || km === undefined || (typeof km === 'number' && isNaN(km));
    if (!kmEmpty && !isNum(km)) e.distanceKm = 'Distance must be a number.';
    else if (!kmEmpty && km < 0) e.distanceKm = 'Distance cannot be negative.';
    else if (!kmEmpty && km > MAX_KM) e.distanceKm = 'That looks too far — check the distance.';

    if (input.distanceMode !== 'oneway' && input.distanceMode !== 'return') e.distanceMode = 'Choose one-way or return.';
    return e;
  }

  /**
   * Calculate a quote. Returns { ok:false, errors } or
   * { ok:true, lines:[{key,label,detail,amount,note}], subtotal, gst, total, perHaEx, perHaInc, meta }.
   */
  function calculateQuote(input, pricing) {
    var errors = validateInput(input, pricing);
    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var job = findJobType(pricing, input.jobType);
    var ha = input.hectares;
    var lines = [];
    var money = function (n) { return '$' + n.toFixed(2); };

    // 1. Application fee
    var base = round2(ha * job.ratePerHa);
    lines.push({ key: 'application', label: job.label + ' — application', detail: fmtQty(ha) + ' ha @ ' + money(job.ratePerHa) + '/ha', amount: base });

    // 2. Surcharges (on the application fee)
    var surchargeTotal = 0;
    if (input.rush && pricing.surcharges.rushPct > 0) {
      var r = round2(base * pricing.surcharges.rushPct / 100);
      surchargeTotal += r;
      lines.push({ key: 'rush', label: 'Rush / time-critical surcharge', detail: pricing.surcharges.rushPct + '% of application', amount: r });
    }
    if (input.terrain && pricing.surcharges.terrainPct > 0) {
      var t = round2(base * pricing.surcharges.terrainPct / 100);
      surchargeTotal += t;
      lines.push({ key: 'terrain', label: 'Difficult terrain surcharge', detail: pricing.surcharges.terrainPct + '% of application', amount: t });
    }

    // 3. Minimum job charge top-up
    var service = round2(base + surchargeTotal);
    var minTopUp = 0;
    if (pricing.minimumCharge > 0 && service < pricing.minimumCharge) {
      minTopUp = round2(pricing.minimumCharge - service);
      lines.push({ key: 'minimum', label: 'Minimum job charge adjustment', detail: 'Minimum job charge ' + money(pricing.minimumCharge), amount: minTopUp });
    }

    // 4. Travel
    var km = isNum(input.distanceKm) ? input.distanceKm : 0;
    var chargedKm = input.distanceMode === 'oneway' ? km * 2 : km;
    var freeKm = pricing.travel.freeKm || 0;
    var billableKm = Math.max(0, chargedKm - freeKm);
    var travel = round2(billableKm * pricing.travel.perKm);
    if (chargedKm > 0) {
      var tDetail = fmtQty(chargedKm) + ' km return' + (input.distanceMode === 'oneway' ? ' (' + fmtQty(km) + ' km each way)' : '');
      if (freeKm > 0) tDetail += ', first ' + fmtQty(freeKm) + ' km free';
      if (billableKm > 0) tDetail += ' → ' + fmtQty(billableKm) + ' km @ ' + money(pricing.travel.perKm) + '/km';
      lines.push({ key: 'travel', label: 'Travel', detail: tDetail, amount: travel });
    }

    // 5. Product / chemical
    var product = findProduct(pricing, input.productId);
    var productInfo = null;
    if (input.supply === 'droneworks' && product) {
      var qty = round2(input.appRate * ha);
      var markup = pricing.chemicalMarkupPct || 0;
      var sellUnit = product.unitPrice * (1 + markup / 100);
      var chem = round2(input.appRate * ha * product.unitPrice * (1 + markup / 100));
      productInfo = { name: product.name, unit: product.unit, qty: qty, rate: input.appRate, sellUnit: round2(sellUnit), costUnit: product.unitPrice, markupPct: markup, suppliedBy: 'droneworks' };
      lines.push({
        key: 'product',
        label: 'Product supply — ' + product.name,
        detail: fmtQty(qty) + ' ' + product.unit + ' (' + fmtQty(input.appRate) + ' ' + product.unit + '/ha) @ ' + money(round2(sellUnit)) + '/' + product.unit,
        amount: chem,
        note: 'Cost ' + money(product.unitPrice) + '/' + product.unit + ' + ' + markup + '% markup'
      });
    } else {
      var hasRate = isNum(input.appRate) && input.appRate > 0;
      productInfo = {
        name: product ? product.name : (input.productName || 'Client supplied product'),
        unit: product ? product.unit : (input.appUnit || job.unit),
        rate: hasRate ? input.appRate : null,
        qty: hasRate ? round2(input.appRate * ha) : null,
        suppliedBy: 'client'
      };
    }

    var subtotal = 0;
    for (var i = 0; i < lines.length; i++) subtotal += lines[i].amount;
    subtotal = round2(subtotal);
    var gst = round2(subtotal * pricing.gstRate);
    var total = round2(subtotal + gst);

    return {
      ok: true,
      lines: lines,
      subtotal: subtotal,
      gst: gst,
      total: total,
      perHaEx: round2(subtotal / ha),
      perHaInc: round2(total / ha),
      meta: {
        jobType: job, hectares: ha, product: productInfo,
        chargedKm: chargedKm, billableKm: billableKm, minimumApplied: minTopUp > 0,
        gstRate: pricing.gstRate
      }
    };
  }

  function fmtQty(n) {
    return (Math.round(n * 100) / 100).toLocaleString('en-AU', { maximumFractionDigits: 2 });
  }

  return {
    calculateQuote: calculateQuote,
    validateInput: validateInput,
    findJobType: findJobType,
    findProduct: findProduct,
    round2: round2
  };
});
