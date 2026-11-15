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
 *   LiDAR            = half day / full day / hourly capture (with floors) + processing hours
 *   Hire             = (hire / jobs sharing) x recovery %, averaged over on-site hours and
 *                      folded into the main service line (never shown as its own line)
 *   Set-up events    = whole number of set up / pack up / clean up events x flat fee per event
 *                      (on top of the minimum, like travel; omitted when 0)
 *   Time & margin    = costs (labour hours x rate + crew + overheads + product cost + hire)
 *                      / (1 - margin %); if that is higher than the rate card, the difference
 *                      is added as "Job time & overheads"
 *   Rounding         = subtotal rounded UP to the nearest $1 / $10 / $50 / $100
 *   Subtotal, GST (10%, optional), Total inc GST, price per hectare.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DWPricing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_HECTARES = 100000;
  var MAX_KM = 5000;
  var MAX_SETUP_EVENTS = 100;

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

  function empty(v) { return v === null || v === undefined || v === '' || (typeof v === 'number' && isNaN(v)); }
  function n0(v) { return isNum(v) ? v : 0; }
  function isLidar(job) { return !!job && job.kind === 'lidar'; }
  function lidarCfg(pricing) { return pricing.lidar || {}; }
  function hireCfg(pricing) { return pricing.hire || {}; }

  var ROUND_STEPS = [0, 1, 10, 50, 100];

  /** Round up to the next multiple of step (0 / missing = no rounding). */
  function roundUp(amount, step) {
    if (!step || step <= 0) return round2(amount);
    return round2(Math.ceil(round2(amount) / step - 1e-9) * step);
  }

  /** Price needed so that margin% of the pre-GST selling price is profit: price = cost / (1 - margin). */
  function priceForMargin(cost, marginPct) {
    var m = n0(marginPct) / 100;
    if (m <= 0) return round2(cost);
    return round2(cost / (1 - m));
  }

  /**
   * Validate a quote input. Returns an object of { field: message }; empty object = valid.
   * Empty optional numbers should be passed as null / undefined / NaN.
   */
  function validateInput(input, pricing) {
    var e = {};
    if (!input || typeof input !== 'object') return { form: 'No input' };

    var job = findJobType(pricing, input.jobType);
    if (!job) e.jobType = 'Choose a job type.';
    var lidar = isLidar(job);

    var ha = input.hectares;
    if (empty(ha)) { if (!lidar) e.hectares = 'Enter the area in hectares.'; }
    else if (!isNum(ha)) e.hectares = 'Hectares must be a number.';
    else if (ha < 0 || (!lidar && ha === 0)) e.hectares = 'Hectares must be more than 0.';
    else if (ha > MAX_HECTARES) e.hectares = 'That looks too large — check the hectares.';

    var supplied = !lidar && input.supply === 'droneworks';
    var rate = input.appRate;
    if (!lidar) {
      if (!empty(rate) && !isNum(rate)) e.appRate = 'Rate must be a number.';
      else if (!empty(rate) && rate < 0) e.appRate = 'Rate cannot be negative.';
      else if (supplied && (empty(rate) || rate <= 0)) e.appRate = 'Enter the product rate per hectare.';
      if (supplied && !findProduct(pricing, input.productId)) {
        e.productId = 'Choose a product from the list (or set product to client supplied).';
      }
    }

    var km = input.distanceKm;
    if (!empty(km) && !isNum(km)) e.distanceKm = 'Distance must be a number.';
    else if (!empty(km) && km < 0) e.distanceKm = 'Distance cannot be negative.';
    else if (!empty(km) && km > MAX_KM) e.distanceKm = 'That looks too far — check the distance.';

    if (input.distanceMode !== 'oneway' && input.distanceMode !== 'return') e.distanceMode = 'Choose one-way or return.';

    var events = input.setupEvents;
    var eventsEmpty = events === null || events === undefined;
    if (typeof events === 'number' && isNaN(events)) e.setupEvents = 'Number of events must be a whole number.';
    else if (!eventsEmpty && !isNum(events)) e.setupEvents = 'Number of events must be a whole number.';
    else if (!eventsEmpty && events < 0) e.setupEvents = 'Number of events cannot be negative.';
    else if (!eventsEmpty && events % 1 !== 0) e.setupEvents = 'Number of events must be a whole number.';
    else if (!eventsEmpty && events > MAX_SETUP_EVENTS) e.setupEvents = 'That looks too many — check the number of events.';

    if (lidar) {
      var mode = input.lidarMode || 'half';
      if (['half', 'full', 'hourly'].indexOf(mode) === -1) e.lidarMode = 'Choose half day, full day or hourly.';
      if (mode === 'hourly' && (!isNum(input.lidarHours) || input.lidarHours <= 0)) e.lidarHours = 'Enter the on-site hours.';
      if (!empty(input.lidarRate) && (!isNum(input.lidarRate) || input.lidarRate < 0)) e.lidarRate = 'Rate must be 0 or more.';
      if (!empty(input.processingHours) && (!isNum(input.processingHours) || input.processingHours < 0)) e.processingHours = 'Processing hours must be 0 or more.';
    }

    ['hoursPlanning', 'hoursTravel', 'hoursOnsite', 'hoursProcessing', 'labourRate', 'crewCost', 'overhead'].forEach(function (f) {
      var v = input[f];
      if (!empty(v) && (!isNum(v) || v < 0)) e[f] = 'Must be 0 or more.';
    });
    if (!empty(input.marginPct) && (!isNum(input.marginPct) || input.marginPct < 0 || input.marginPct >= 95)) e.marginPct = 'Margin must be between 0% and 94%.';
    if (!empty(input.roundTo) && ROUND_STEPS.indexOf(input.roundTo) === -1) e.roundTo = 'Round to $1, $10, $50 or $100.';
    if (!empty(input.validDays) && (!isNum(input.validDays) || input.validDays < 0)) e.validDays = 'Days must be 0 or more.';

    var h = input.hire;
    if (h && h.on) {
      if (empty(h.cost)) e.hireCost = 'Enter the hire cost (ex GST).';
      else if (!isNum(h.cost) || h.cost < 0) e.hireCost = 'Hire cost must be 0 or more.';
      if (!empty(h.recoveryPct) && (!isNum(h.recoveryPct) || h.recoveryPct < 0 || h.recoveryPct > 100)) e.hireRecovery = 'Recovery must be 0–100%.';
      if (!empty(h.jobsSharing) && [1, 2, 3].indexOf(h.jobsSharing) === -1) e.hireJobs = 'Jobs sharing the hire must be 1, 2 or 3.';
    }
    return e;
  }

  /**
   * Calculate a quote. Returns { ok:false, errors } or
   * { ok:true, lines:[{key,label,detail,amount,note}], subtotal, gst, total, perHaEx, perHaInc, warnings, meta }.
   *
   * Client-facing lines never include hire as its own line: recovered hire is folded into the main
   * service line (application / capture) as a higher effective rate.
   */
  function calculateQuote(input, pricing) {
    var errors = validateInput(input, pricing);
    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var job = findJobType(pricing, input.jobType);
    var lidar = isLidar(job);
    var L = lidarCfg(pricing);
    var H = hireCfg(pricing);
    var ha = isNum(input.hectares) ? input.hectares : 0;
    var lines = [];
    var warnings = [];
    var money = function (n) { return '$' + n.toFixed(2); };

    // 1. Main service line (before any hire is folded in)
    var mainLine, floor, base, modeHours = null, lidarInfo = null;
    if (!lidar) {
      base = round2(ha * job.ratePerHa);
      mainLine = { key: 'application', label: job.label + ' — application', detail: fmtQty(ha) + ' ha @ ' + money(job.ratePerHa) + '/ha', amount: base };
      floor = pricing.minimumCharge || 0;
    } else {
      var mode = input.lidarMode || 'half';
      var hireBooked = !!(input.hire && input.hire.on && !input.hire.covered);
      var rateIn = isNum(input.lidarRate) && input.lidarRate > 0 ? input.lidarRate : null;
      var notes = [];
      if (mode === 'half') {
        modeHours = L.halfDayHours || 4;
        base = Math.max(rateIn || L.halfDayPrice || 0, L.halfDayFloor || 0);
        floor = L.halfDayFloor || 0;
        if (rateIn && rateIn < floor) notes.push('Raised to the half-day floor ' + money(floor));
        mainLine = { key: 'capture', label: job.label + ' — capture (half day)', detail: 'Up to ' + fmtQty(modeHours) + ' h on site: setup, safety checks & flying', amount: round2(base) };
      } else if (mode === 'full') {
        modeHours = L.fullDayHours || 8;
        base = Math.max(rateIn || L.fullDayTarget || 0, L.fullDayFloor || 0);
        floor = L.fullDayFloor || 0;
        if (rateIn && rateIn < floor) notes.push('Raised to the full-day floor ' + money(floor));
        mainLine = { key: 'capture', label: job.label + ' — capture (full day)', detail: 'Up to ' + fmtQty(modeHours) + ' h on site: setup, safety checks & flying', amount: round2(base) };
      } else {
        var hrs = input.lidarHours;
        var hr = Math.max(rateIn || L.hourlyRate || 0, L.hourlyFloor || 0);
        if (rateIn && rateIn < (L.hourlyFloor || 0)) notes.push('Hourly rate raised to the floor ' + money(L.hourlyFloor));
        var billH = hrs;
        var minApplied = false;
        if (!hireBooked && L.minBillableHoursEnabled && L.minBillableHours > 0 && hrs < L.minBillableHours) { billH = L.minBillableHours; minApplied = true; }
        modeHours = billH;
        base = round2(billH * hr);
        floor = hireBooked ? (L.halfDayFloor || 0) : round2(billH * (L.hourlyFloor || 0));
        var det = fmtQty(billH) + ' h on site @ ' + money(hr) + '/h (setup, safety checks & flying)';
        if (minApplied) det += ' — minimum ' + fmtQty(L.minBillableHours) + ' h';
        if (hireBooked && base < floor) {
          notes.push('Hired unit: capture lifted to the half-day floor ' + money(floor));
          base = floor;
          det = fmtQty(hrs) + ' h on site (setup, safety checks & flying) — half-day minimum';
        }
        mainLine = { key: 'capture', label: job.label + ' — capture (hourly)', detail: det, amount: round2(base), _hourly: hr, _hours: billH };
        if (L.suggestFullDayAboveHours && hrs > L.suggestFullDayAboveHours) {
          warnings.push({ level: 'info', text: 'Over ' + fmtQty(L.suggestFullDayAboveHours) + ' hours on site — consider quoting a full day (target ' + money(L.fullDayTarget || 0) + ', never below ' + money(L.fullDayFloor || 0) + ').' });
        }
      }
      if (notes.length) mainLine.note = notes.join('; ');
      lidarInfo = { mode: mode, hours: modeHours, base: round2(base), floor: floor, example: !!L.example };
    }
    lines.push(mainLine);

    // 2. Surcharges (on the service base)
    var surchargeTotal = 0;
    var ofWhat = lidar ? 'capture' : 'application';
    if (input.rush && pricing.surcharges.rushPct > 0) {
      var r = round2(base * pricing.surcharges.rushPct / 100);
      surchargeTotal += r;
      lines.push({ key: 'rush', label: 'Rush / time-critical surcharge', detail: pricing.surcharges.rushPct + '% of ' + ofWhat, amount: r });
    }
    if (input.terrain && pricing.surcharges.terrainPct > 0) {
      var t = round2(base * pricing.surcharges.terrainPct / 100);
      surchargeTotal += t;
      lines.push({ key: 'terrain', label: 'Difficult terrain surcharge', detail: pricing.surcharges.terrainPct + '% of ' + ofWhat, amount: t });
    }

    // 3. Minimum job charge top-up (spray / spread / seed only; LiDAR uses its own floors)
    var minTopUp = 0;
    if (!lidar) {
      var service = round2(base + surchargeTotal);
      if (pricing.minimumCharge > 0 && service < pricing.minimumCharge) {
        minTopUp = round2(pricing.minimumCharge - service);
        lines.push({ key: 'minimum', label: 'Minimum job charge adjustment', detail: 'Minimum job charge ' + money(pricing.minimumCharge), amount: minTopUp });
      }
    }
    var serviceNoHire = round2(base + surchargeTotal + minTopUp);

    // 4. Hire — averaged over the on-site hours and folded into the operator's rate (never its own line)
    var onsite = isNum(input.hoursOnsite) && input.hoursOnsite > 0 ? input.hoursOnsite
      : (lidar ? modeHours : (job.haPerHour > 0 && ha > 0 ? round2(ha / job.haPerHour) : null));
    var hireInfo = null;
    var hin = input.hire;
    if (hin && hin.on) {
      var jobs = isNum(hin.jobsSharing) && hin.jobsSharing >= 1 ? hin.jobsSharing : 1;
      var pct = isNum(hin.recoveryPct) ? hin.recoveryPct : 100;
      var covered = !!hin.covered;
      var cost = covered ? 0 : n0(hin.cost);
      var share = round2(cost / jobs);
      var recovered = round2(share * pct / 100);
      var extras = covered ? 0 : round2((n0(H.insurance) + n0(H.consumables) + n0(H.fuel)) / jobs);
      var breakEven = covered ? 0 : round2((n0(hin.cost) + n0(H.insurance) + n0(H.consumables) + n0(H.fuel)) / jobs);
      var perHour = onsite ? round2(recovered / onsite) : null;
      if (recovered > 0) {
        mainLine.amount = round2(mainLine.amount + recovered);
        if (!lidar && ha > 0) mainLine.detail = fmtQty(ha) + ' ha @ ' + money(round2(mainLine.amount / ha)) + '/ha';
        if (lidar && mainLine._hourly && mainLine.detail.indexOf('half-day minimum') === -1) {
          mainLine.detail = fmtQty(mainLine._hours) + ' h on site @ ' + money(round2(mainLine.amount / mainLine._hours)) + '/h (setup, safety checks & flying)';
        }
      }
      var shortfall = round2(share - recovered);
      hireInfo = {
        supplier: hin.supplier || '', period: hin.period || '', cost: covered ? 0 : n0(hin.cost), covered: covered,
        jobsSharing: jobs, share: share, recoveryPct: pct, recovered: recovered, shortfall: shortfall,
        onsiteHours: onsite, perHour: perHour, extras: extras, breakEven: breakEven,
        recoversFull: true, belowBreakEven: false
      };
      if (!covered) {
        // Hire must be recovered ON TOP of the job price (which is never below the job floor).
        if (shortfall > 0.004 || serviceNoHire < floor - 0.004) {
          hireInfo.recoversFull = false;
          warnings.push({ level: 'warn', text: 'WARNING: this quote does not recover the full hire (' + money(share) + ') on top of the job floor (' + money(floor) + '). Hire shortfall you absorb: ' + money(shortfall) + '. The quote is not blocked.' });
        }
        if (round2(serviceNoHire + recovered) < breakEven) {
          hireInfo.belowBreakEven = true;
          warnings.push({ level: 'danger', text: 'STRONG WARNING: capture + hire recovered (' + money(round2(serviceNoHire + recovered)) + ') is below the hire-week cash break-even (' + money(breakEven) + ' = hire + insurance + consumables + fuel' + (jobs > 1 ? ', split over ' + jobs + ' jobs' : '') + '). This job loses cash.' });
        }
        if (!onsite) warnings.push({ level: 'info', text: 'Enter on-site hours to see the hire cost per hour.' });
      }
    }
    delete mainLine._hourly; delete mainLine._hours;

    // 5. LiDAR processing (separate line)
    var procHours = lidar && isNum(input.processingHours) ? input.processingHours : 0;
    if (procHours > 0) {
      lines.push({ key: 'processing', label: 'LiDAR processing', detail: fmtQty(procHours) + ' h @ ' + money(L.processingPerHour || 0) + '/h', amount: round2(procHours * (L.processingPerHour || 0)) });
    }

    // 6. Travel
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

    // 7. Product / chemical
    var product = lidar ? null : findProduct(pricing, input.productId);
    var productInfo = null;
    var productCost = 0;
    if (!lidar && input.supply === 'droneworks' && product) {
      var qty = round2(input.appRate * ha);
      var markup = pricing.chemicalMarkupPct || 0;
      var sellUnit = product.unitPrice * (1 + markup / 100);
      var chem = round2(input.appRate * ha * product.unitPrice * (1 + markup / 100));
      productCost = round2(input.appRate * ha * product.unitPrice);
      productInfo = { name: product.name, unit: product.unit, qty: qty, rate: input.appRate, sellUnit: round2(sellUnit), costUnit: product.unitPrice, markupPct: markup, suppliedBy: 'droneworks' };
      lines.push({
        key: 'product',
        label: 'Product supply — ' + product.name,
        detail: fmtQty(qty) + ' ' + product.unit + ' (' + fmtQty(input.appRate) + ' ' + product.unit + '/ha) @ ' + money(round2(sellUnit)) + '/' + product.unit,
        amount: chem,
        note: 'Cost ' + money(product.unitPrice) + '/' + product.unit + ' + ' + markup + '% markup'
      });
    } else if (!lidar) {
      var hasRate = isNum(input.appRate) && input.appRate > 0;
      productInfo = {
        name: product ? product.name : (input.productName || 'Client supplied product'),
        unit: product ? product.unit : (input.appUnit || job.unit),
        rate: hasRate ? input.appRate : null,
        qty: hasRate ? round2(input.appRate * ha) : null,
        suppliedBy: 'client'
      };
    }

    // 8. Set up / pack up / clean up — flat fee per event, on top of the minimum (like travel)
    var events = isNum(input.setupEvents) ? input.setupEvents : 0;
    var setupFee = isNum(pricing.setupFee) ? pricing.setupFee : 0;
    if (events > 0 && setupFee > 0) {
      lines.push({ key: 'setup', label: 'Set up / pack up / clean up', detail: events + ' \u00d7 ' + money(setupFee), amount: round2(events * setupFee) });
    }

    var rateCard = 0;
    for (var i = 0; i < lines.length; i++) rateCard += lines[i].amount;
    rateCard = round2(rateCard);

    // 9. Time breakdown, overheads and target margin (price = cost / (1 - margin))
    var labourRate = isNum(input.labourRate) ? input.labourRate : n0(pricing.labourRatePerHour);
    var hoursPlan = n0(input.hoursPlanning), hoursTrav = n0(input.hoursTravel), hoursOn = n0(input.hoursOnsite), hoursProc = n0(input.hoursProcessing);
    var labourHours = round2(hoursPlan + hoursTrav + hoursOn + hoursProc);
    var labourCost = round2(labourHours * labourRate);
    var crew = n0(input.crewCost);
    var overhead = isNum(input.overhead) ? input.overhead : n0(pricing.overheadPerJob);
    var marginPct = isNum(input.marginPct) ? input.marginPct : n0(pricing.targetMarginPct);
    var hireRecovered = hireInfo ? hireInfo.recovered : 0;
    var hireExtras = hireInfo ? hireInfo.extras : 0;
    var costsForTarget = round2(labourCost + crew + overhead + productCost + hireRecovered + hireExtras);
    var targetPrice = priceForMargin(costsForTarget, marginPct);
    if (targetPrice > rateCard + 0.004) {
      lines.push({ key: 'time', label: 'Job time & overheads', detail: 'Planning, travel time, on-site work and processing/reporting', amount: round2(targetPrice - rateCard),
        note: 'Tops the quote up to the ' + marginPct + '% target margin' });
    }

    // 10. Rounding (pre-GST, always up)
    var pre = 0;
    for (var k = 0; k < lines.length; k++) pre += lines[k].amount;
    pre = round2(pre);
    var roundTo = isNum(input.roundTo) ? input.roundTo : 0;
    var subtotal = roundUp(pre, roundTo);
    if (subtotal - pre > 0.004) lines.push({ key: 'rounding', label: 'Rounding', detail: 'Rounded up to the nearest $' + roundTo, amount: round2(subtotal - pre) });

    // 11. GST (10% on the whole total, optional)
    var gstOn = input.gst !== false;
    var gstRate = gstOn ? pricing.gstRate : 0;
    var gst = round2(subtotal * gstRate);
    var total = round2(subtotal + gst);

    // 12. Costs & profit (full hire share counts as a cost even when Max absorbs part of it)
    var totalCosts = round2(labourCost + crew + overhead + productCost + (hireInfo ? hireInfo.share + hireExtras : 0));
    var profit = round2(subtotal - totalCosts);

    return {
      ok: true,
      lines: lines,
      subtotal: subtotal,
      gst: gst,
      total: total,
      perHaEx: ha > 0 ? round2(subtotal / ha) : null,
      perHaInc: ha > 0 ? round2(total / ha) : null,
      warnings: warnings,
      meta: {
        jobType: job, hectares: ha, product: productInfo, isLidar: lidar, lidar: lidarInfo,
        chargedKm: chargedKm, billableKm: billableKm, minimumApplied: minTopUp > 0,
        gstRate: gstRate, gstOn: gstOn, roundTo: roundTo, preRounding: pre,
        hire: hireInfo,
        time: {
          hours: { planning: hoursPlan, travel: hoursTrav, onsite: hoursOn, processing: hoursProc, total: labourHours },
          labourRate: labourRate, labourCost: labourCost, crew: crew, labourSubtotal: round2(labourCost + crew),
          overhead: overhead, productCost: productCost, marginPct: marginPct,
          costsForTarget: costsForTarget, targetPrice: targetPrice, rateCard: rateCard,
          totalCosts: totalCosts, profit: profit, marginAchievedPct: subtotal > 0 ? round2(profit / subtotal * 100) : 0
        },
        rateSheet: pricing.rateSheet || null
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
    round2: round2,
    roundUp: roundUp,
    priceForMargin: priceForMargin,
    ROUND_STEPS: ROUND_STEPS
  };
});
