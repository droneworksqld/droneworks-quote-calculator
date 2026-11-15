/* DroneWorks QLD quote calculator — UI wiring. Pricing maths lives in pricing.js. */
(function () {
  'use strict';

  var P = window.DWPricing;
  var S = window.DWSettings;
  var B = window.DW_BUSINESS;
  var EXAMPLE = window.DW_EXAMPLE_PRICING;
  var CLIENT_PRODUCT = '__client__';

  var store = safeStorage();
  var state = { pricing: null, isExample: true, quoteNo: '', quoteCommitted: false, result: null, rateEdited: false, touched: {}, sheet: { ok: true } };

  function $(id) { return document.getElementById(id); }
  function money(n) { return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }); }
  function numOr(id) { return num($(id).value); }
  function qty(n) { return n.toLocaleString('en-AU', { maximumFractionDigits: 2 }); }
  function num(v) { if (v === '' || v === null || v === undefined) return null; var n = Number(v); return isFinite(n) ? n : NaN; }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function safeStorage() {
    try { var k = '__dwq_test'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch (e) {
      var mem = {};
      return { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; } };
    }
  }

  // ---------- Load settings ----------
  function loadSettings() {
    var res = S.loadPricing(store, EXAMPLE);
    state.pricing = res.pricing;
    state.isExample = res.isExample;
    $('exampleBanner').hidden = !res.isExample;
    document.body.classList.toggle('is-example', res.isExample);
    var w = $('loadWarning');
    w.hidden = !res.error;
    w.textContent = res.error || '';
    checkSheet();
    buildSupplierList();
  }

  function checkSheet() {
    state.sheet = S.checkRateSheet(state.pricing, S.getApprovedVersion(store));
    var w = $('rateSheetWarning');
    w.hidden = state.sheet.ok;
    w.textContent = state.sheet.ok ? '' : '⚠ ' + state.sheet.message;
  }

  function rateSheetStamp() {
    var rs = state.pricing.rateSheet || {};
    return 'Rate sheet ' + (rs.version || 'UNVERSIONED') + (rs.date ? ' (' + fmtIsoDate(rs.date) + ')' : '');
  }
  function fmtIsoDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : s;
  }

  function buildSupplierList() {
    var dl = $('hireSupplierList'); dl.innerHTML = '';
    ((state.pricing.hire && state.pricing.hire.suppliers) || []).forEach(function (s) { dl.appendChild(el('option', { value: s.name })); });
  }

  function currentJob() { return P.findJobType(state.pricing, getRadio('jobType')); }
  function isLidarJob() { var j = currentJob(); return !!j && j.kind === 'lidar'; }

  /** Fill per-quote defaults (labour rate, overhead, margin, rounding, validity) from settings. */
  function prefillDefaults() {
    var p = state.pricing;
    $('labourRate').value = p.labourRatePerHour !== undefined ? p.labourRatePerHour : '';
    $('overhead').value = p.overheadPerJob !== undefined ? p.overheadPerJob : '';
    $('marginPct').value = p.targetMarginPct !== undefined ? p.targetMarginPct : '';
    $('roundTo').value = String(p.defaultRoundTo || 1);
    $('validDays').value = p.quoteValidityDays !== undefined ? p.quoteValidityDays : 14;
  }

  // ---------- Build form options ----------
  function buildJobTypes() {
    var group = $('jobTypeGroup');
    var current = getRadio('jobType');
    group.innerHTML = '';
    group.classList.toggle('two', state.pricing.jobTypes.length === 2 || state.pricing.jobTypes.length === 4);
    state.pricing.jobTypes.forEach(function (j, i) {
      var lab = el('label', { 'class': 'seg' });
      var inp = el('input', { type: 'radio', name: 'jobType', value: j.id });
      if (current ? current === j.id : i === 0) inp.checked = true;
      lab.appendChild(inp);
      lab.appendChild(el('span', null, shortLabel(j.label)));
      group.appendChild(lab);
    });
    if (!getRadio('jobType')) group.querySelector('input').checked = true;
  }
  function shortLabel(label) { return label.replace(/\s*\(.*\)\s*$/, ''); }

  function buildProducts() {
    var sel = $('product');
    var prev = sel.value;
    var jobId = getRadio('jobType');
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: CLIENT_PRODUCT }, 'Client supplied product (not on list)'));
    var matching = [], others = [];
    state.pricing.products.forEach(function (p) {
      (!p.jobTypes || !p.jobTypes.length || p.jobTypes.indexOf(jobId) !== -1 ? matching : others).push(p);
    });
    function addGroup(label, list) {
      if (!list.length) return;
      var g = el('optgroup', { label: label });
      list.forEach(function (p) { g.appendChild(el('option', { value: p.id }, p.name + ' (' + p.unit + ')')); });
      sel.appendChild(g);
    }
    addGroup('Products for this job', matching);
    addGroup('Other products', others);
    sel.value = P.findProduct(state.pricing, prev) ? prev : CLIENT_PRODUCT;
  }

  function getRadio(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : null; }
  function setRadio(name, value) { var r = document.querySelector('input[name="' + name + '"][value="' + value + '"]'); if (r) r.checked = true; }

  // ---------- Read & render ----------
  function readInput() {
    var productId = $('product').value;
    var supply = getRadio('supply');
    return {
      client: $('client').value.trim(),
      jobType: getRadio('jobType'),
      hectares: num($('hectares').value),
      productId: productId === CLIENT_PRODUCT ? null : productId,
      productName: $('productName').value.trim(),
      supply: productId === CLIENT_PRODUCT ? 'client' : supply,
      appRate: num($('appRate').value),
      appUnit: $('appUnit').value,
      distanceKm: num($('distanceKm').value),
      distanceMode: getRadio('distanceMode'),
      rush: $('rush').checked,
      terrain: $('terrain').checked,
      setupEvents: num($('setupEvents').value),
      notes: $('notes').value.trim(),
      lidarMode: getRadio('lidarMode'),
      lidarHours: numOr('lidarHours'),
      lidarRate: numOr('lidarRate'),
      processingHours: numOr('processingHours'),
      hoursPlanning: numOr('hoursPlanning'),
      hoursTravel: numOr('hoursTravel'),
      hoursOnsite: numOr('hoursOnsite'),
      hoursProcessing: numOr('hoursProcessing'),
      labourRate: numOr('labourRate'),
      crewCost: numOr('crewCost'),
      overhead: numOr('overhead'),
      marginPct: numOr('marginPct'),
      roundTo: Number($('roundTo').value),
      gst: $('gstOn').checked,
      validDays: numOr('validDays'),
      hire: {
        on: $('hireOn').checked,
        supplier: $('hireSupplier').value.trim(),
        cost: numOr('hireCost'),
        period: $('hirePeriod').value,
        recoveryPct: numOr('hireRecovery'),
        jobsSharing: Number(getRadio('hireJobs') || 1),
        covered: $('hireCovered').checked
      }
    };
  }

  function syncDependentFields() {
    var p = state.pricing;
    var job = P.findJobType(p, getRadio('jobType'));
    var product = P.findProduct(p, $('product').value);
    var isClientProduct = !product;
    $('productNameField').hidden = !isClientProduct;
    var dwRadio = document.querySelector('input[name="supply"][value="droneworks"]');
    dwRadio.disabled = isClientProduct;
    if (isClientProduct) setRadio('supply', 'client');
    var unitSel = $('appUnit');
    if (product) { unitSel.value = product.unit; unitSel.disabled = true; }
    else { unitSel.disabled = false; if (!state.unitEdited && job) unitSel.value = job.unit; }

    var supplied = getRadio('supply') === 'droneworks';
    $('rateOpt').textContent = supplied ? 'required' : 'optional';
    $('rateOpt').classList.toggle('req', supplied);
    $('supplyHint').textContent = supplied
      ? 'Product cost plus ' + p.chemicalMarkupPct + '% markup is added to the quote.'
      : 'No product cost added — client supplies the product.';

    var mode = getRadio('distanceMode');
    var km = num($('distanceKm').value);
    var hint = mode === 'oneway' ? 'Enter the one-way distance; it is doubled for the return trip.' : 'Enter the total return-trip distance.';
    if (km && km > 0 && isFinite(km)) {
      var charged = mode === 'oneway' ? km * 2 : km;
      hint += ' Charged: ' + qty(charged) + ' km return';
      if (p.travel.freeKm > 0) hint += ' (first ' + qty(p.travel.freeKm) + ' km free)';
      hint += '.';
    } else if (p.travel.freeKm > 0) hint += ' First ' + qty(p.travel.freeKm) + ' km (return) free.';
    $('travelHint').textContent = hint;
    $('rushPct').textContent = '+' + p.surcharges.rushPct + '%';
    $('terrainPct').textContent = '+' + p.surcharges.terrainPct + '%';
    $('setupHint').textContent = 'Flat fee of ' + money(isFinite(p.setupFee) ? p.setupFee : 0) + ' per event, on top of the minimum job charge.';

    // LiDAR vs per-hectare jobs
    var lidar = isLidarJob();
    var L = p.lidar || {};
    $('lidarFields').hidden = !lidar;
    $('agFields').hidden = lidar;
    $('haOpt').hidden = !lidar;
    $('lidarExampleNote').hidden = !(lidar && L.example);
    var mode = getRadio('lidarMode');
    $('lidarHoursField').hidden = mode !== 'hourly';
    var hireBooked = $('hireOn').checked && !$('hireCovered').checked;
    if (mode === 'half') {
      $('lidarRateLabel').firstChild.textContent = 'Half-day price ';
      $('lidarRateHint').textContent = 'Default ' + money(L.halfDayPrice || 0) + ' · floor ' + money(L.halfDayFloor || 0) + '. Leave blank for the default.';
    } else if (mode === 'full') {
      $('lidarRateLabel').firstChild.textContent = 'Full-day price ';
      $('lidarRateHint').textContent = 'Target ' + money(L.fullDayTarget || 0) + ' · never below ' + money(L.fullDayFloor || 0) + '. Leave blank for the target.';
    } else {
      $('lidarRateLabel').firstChild.textContent = 'Hourly rate ';
      var h = 'Reference ' + money(L.hourlyRate || 0) + '/h · floor ' + money(L.hourlyFloor || 0) + '/h.';
      if (hireBooked) h += ' Hired unit: at least the half-day floor ' + money(L.halfDayFloor || 0) + '.';
      else if (L.minBillableHoursEnabled && L.minBillableHours > 0) h += ' Minimum ' + qty(L.minBillableHours) + ' h billable (owned kit / covered hire week).';
      $('lidarRateHint').textContent = h;
    }
    var typ = L.processingHoursTypical;
    $('processingHint').textContent = money(L.processingPerHour || 0) + '/h' + (typ && typ.length === 2 ? ' · typically ' + typ[0] + '–' + typ[1] + ' h' : '') + '. Shown as its own line.';

    $('hireFields').hidden = !$('hireOn').checked;

    var lr = num($('labourRate').value) || 0;
    var hrs = ['hoursPlanning', 'hoursTravel', 'hoursOnsite', 'hoursProcessing'].reduce(function (s, id) { return s + (num($(id).value) || 0); }, 0);
    var crew = num($('crewCost').value) || 0;
    $('labourHint').textContent = (currentJob() ? shortLabel(currentJob().label) + ' labour subtotal: ' : 'Labour subtotal: ') +
      money(P.round2(hrs * lr + crew)) + ' (' + qty(hrs) + ' h @ ' + money(lr) + '/h' + (crew ? ' + ' + money(crew) + ' crew' : '') + ')';
  }

  function render() {
    syncDependentFields();
    var input = readInput();
    var res = P.calculateQuote(input, state.pricing);
    state.result = res.ok ? res : null;
    state.input = input;

    var errs = res.ok ? {} : res.errors;
    document.querySelectorAll('[data-error-for]').forEach(function (p) {
      var f = p.getAttribute('data-error-for');
      var show = errs[f] && (state.touched[f] || state.touched.__all);
      p.textContent = show ? errs[f] : '';
      var inputEl = $(f === 'productId' ? 'product' : f);
      if (inputEl) inputEl.classList.toggle('invalid', !!show);
    });

    $('quoteNo').textContent = state.quoteNo;
    $('resultEmpty').hidden = res.ok;
    $('resultBody').hidden = !res.ok;
    $('copyQuote').disabled = !res.ok || !state.sheet.ok;
    $('printQuote').disabled = !res.ok;
    if (!res.ok) {
      var keys = Object.keys(errs);
      $('resultEmpty').textContent = (input.hectares === null && (errs.hectares || !isLidarJob()))
        ? (isLidarJob() ? 'Enter the LiDAR details to see a price.' : 'Enter the area in hectares to see a price.')
        : 'To finish the quote: ' + errs[keys[0]];
      return;
    }

    var tbody = $('breakdownRows');
    tbody.innerHTML = '';
    res.lines.forEach(function (l) {
      var tr = el('tr');
      var th = el('th', { scope: 'row' });
      th.appendChild(el('div', { 'class': 'line-label' }, l.label));
      th.appendChild(el('div', { 'class': 'line-detail' }, l.detail));
      if (l.note) th.appendChild(el('div', { 'class': 'line-note' }, 'Internal: ' + l.note));
      tr.appendChild(th);
      tr.appendChild(el('td', null, money(l.amount)));
      tbody.appendChild(tr);
    });
    if (input.supply === 'client' && !res.meta.isLidar) {
      var tr2 = el('tr', { 'class': 'muted-row' });
      var th2 = el('th', { scope: 'row' });
      var pi = res.meta.product;
      th2.appendChild(el('div', { 'class': 'line-label' }, 'Product supplied by client'));
      th2.appendChild(el('div', { 'class': 'line-detail' }, pi.name + (pi.rate ? ' @ ' + qty(pi.rate) + ' ' + pi.unit + '/ha (' + qty(pi.qty) + ' ' + pi.unit + ')' : '')));
      tr2.appendChild(th2);
      tr2.appendChild(el('td', null, '—'));
      tbody.appendChild(tr2);
    }
    $('subtotal').textContent = money(res.subtotal);
    $('gstLabel').textContent = gstLabel(res);
    $('gst').textContent = money(res.gst);
    $('total').textContent = money(res.total);
    $('totalAmount').textContent = money(res.total);
    $('perHa').textContent = (res.perHaInc !== null ? money(res.perHaInc) + '/ha inc GST · ' + money(res.perHaEx) + '/ha ex GST · ' : '') + money(res.subtotal) + ' ex GST';
    var s = quoteSummary();
    $('quoteMeta').textContent = (s.validUntil ? 'Valid ' + s.validDays + ' days, until ' + s.validUntil + ' · ' : '') + s.rateSheet + (quoteIsExample() ? ' · EXAMPLE PRICING' : '');
    renderWarnings(res);
    renderInternal(res);
  }

  function gstLabel(r) { return r.meta.gstOn ? 'GST (' + qty(r.meta.gstRate * 100) + '%)' : 'GST (not charged)'; }

  function quoteIsExample() {
    var r = state.result;
    if (state.isExample) return true;
    if (!r) return false;
    if (r.meta.jobType.example) return true;
    return !!(r.meta.isLidar && state.pricing.lidar && state.pricing.lidar.example);
  }

  function renderWarnings(res) {
    var box = $('warnings'); box.innerHTML = '';
    var list = (res.warnings || []).slice();
    if (!state.sheet.ok) list.unshift({ level: 'danger', text: state.sheet.message });
    list.forEach(function (w) { box.appendChild(el('div', { 'class': 'warn warn-' + w.level, role: w.level === 'info' ? null : 'alert' }, w.text)); });
  }

  function kvTable(rows) {
    var t = el('table', { 'class': 'kv' }); var tb = el('tbody');
    rows.forEach(function (r) {
      if (!r) return;
      var tr = el('tr', r[2] ? { 'class': r[2] } : null); tr.appendChild(el('th', { scope: 'row' }, r[0])); tr.appendChild(el('td', null, r[1])); tb.appendChild(tr);
    });
    t.appendChild(tb); return t;
  }

  function renderInternal(res) {
    var box = $('internalPanel'); box.innerHTML = '';
    var tm = res.meta.time;
    box.appendChild(el('h3', null, 'Internal — costs & profit (not printed or copied)'));
    var hrs = tm.hours;
    box.appendChild(kvTable([
      [shortLabel(res.meta.jobType.label) + ' labour (' + qty(hrs.total) + ' h @ ' + money(tm.labourRate) + '/h)', money(tm.labourCost)],
      tm.crew ? ['Extra crew / subcontractor', money(tm.crew)] : null,
      ['Labour subtotal', money(tm.labourSubtotal), 'sub'],
      ['Overhead / equipment allowance', money(tm.overhead)],
      tm.productCost ? ['Product at cost', money(tm.productCost)] : null,
      res.meta.hire && !res.meta.hire.covered ? ['Hire share' + (res.meta.hire.jobsSharing > 1 ? ' (1 of ' + res.meta.hire.jobsSharing + ' jobs)' : ''), money(res.meta.hire.share)] : null,
      res.meta.hire && res.meta.hire.extras ? ['Hire-week insurance, consumables & fuel', money(res.meta.hire.extras)] : null,
      ['Total costs', money(tm.totalCosts), 'sub'],
      ['Rate-card price (ex GST)', money(tm.rateCard)],
      ['Price for ' + qty(tm.marginPct) + '% target margin', money(tm.targetPrice)],
      ['Quote (ex GST)', money(res.subtotal), 'sub'],
      ['Profit', money(tm.profit) + ' (' + qty(tm.marginAchievedPct) + '%)', tm.profit < 0 ? 'neg' : 'pos']
    ]));
    var h = res.meta.hire;
    if (h) {
      box.appendChild(el('h3', null, 'Hire recovery'));
      if (h.covered) {
        box.appendChild(el('p', { 'class': 'hint' }, 'Hire week already covered by another job — no hire recovered on this quote' + (h.supplier ? ' (' + h.supplier + ')' : '') + '.'));
      } else {
        box.appendChild(kvTable([
          ['Hire cost' + (h.supplier ? ' — ' + h.supplier : '') + (h.period ? ' (per ' + h.period + ')' : ''), money(h.cost)],
          h.jobsSharing > 1 ? ['This job\'s share (' + h.jobsSharing + ' jobs)', money(h.share)] : null,
          ['Recovered by this quote (' + qty(h.recoveryPct) + '%)', money(h.recovered)],
          ['Folded into the rate', h.perHour !== null ? money(h.perHour) + '/h over ' + qty(h.onsiteHours) + ' h on site' : 'on-site hours unknown'],
          ['Shortfall you absorb', money(h.shortfall), h.shortfall > 0 ? 'neg' : ''],
          ['Hire-week cash break-even' + (h.jobsSharing > 1 ? ' (share)' : ''), money(h.breakEven)]
        ]));
      }
    }
  }

  // ---------- Quote output (copy / print) ----------
  function fmtDate(d) { return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

  function ensureQuoteNumber() {
    if (!state.quoteCommitted) {
      state.quoteNo = S.commitQuoteNumber(store, new Date());
      state.quoteCommitted = true;
      $('quoteNo').textContent = state.quoteNo;
    }
    return state.quoteNo;
  }

  function quoteSummary() {
    var r = state.result, inp = state.input, now = new Date();
    var pi = r.meta.product;
    var validDays = isFinite(inp.validDays) && inp.validDays !== null ? inp.validDays : (state.pricing.quoteValidityDays || 0);
    var productLine = !pi ? '' : pi.name + (pi.rate ? ' @ ' + qty(pi.rate) + ' ' + pi.unit + '/ha' : '') +
      (pi.suppliedBy === 'client' ? ' (supplied by client)' : ' (supplied by ' + B.name + ')');
    return {
      date: fmtDate(now),
      validDays: validDays,
      validUntil: validDays ? fmtDate(addDays(now, validDays)) : null,
      client: inp.client,
      job: r.meta.isLidar
        ? r.meta.jobType.label + ' — ' + ({ half: 'half day', full: 'full day', hourly: 'hourly' }[r.meta.lidar.mode] || '') + (r.meta.hectares ? ', ' + qty(r.meta.hectares) + ' ha' : '')
        : r.meta.jobType.label + ' — ' + qty(r.meta.hectares) + ' ha',
      product: productLine,
      notes: inp.notes,
      rateSheet: rateSheetStamp()
    };
  }

  function buildCopyText() {
    var r = state.result, s = quoteSummary(), out = [];
    if (quoteIsExample()) out.push('*** EXAMPLE PRICING – NOT REAL RATES ***', '');
    out.push(B.name + ' — Quote (estimate)');
    out.push('Quote no: ' + state.quoteNo, 'Date: ' + s.date);
    if (s.validUntil) out.push('Quote valid for ' + s.validDays + ' days (until ' + s.validUntil + ')');
    if (s.client) out.push('Client / paddock: ' + s.client);
    out.push('Job: ' + s.job);
    if (s.product) out.push('Product: ' + s.product);
    if (s.notes) out.push('Notes: ' + s.notes);
    out.push('');
    r.lines.forEach(function (l) { out.push(l.label + ': ' + money(l.amount), '   ' + l.detail); });
    out.push('');
    out.push('Subtotal (ex GST): ' + money(r.subtotal));
    out.push(gstLabel(r) + ': ' + money(r.gst));
    out.push('TOTAL (inc GST): ' + money(r.total));
    if (r.perHaInc !== null) out.push('Price per hectare: ' + money(r.perHaInc) + ' inc GST (' + money(r.perHaEx) + ' ex GST)');
    out.push('', B.disclaimer, '', s.rateSheet + ' · ' + state.quoteNo, '');
    out.push(B.contactName + ' · ' + B.phone + ' · ' + B.email + ' · ' + B.website);
    return out.join('\n');
  }

  function copyQuote() {
    if (!state.result) return;
    if (!state.sheet.ok) { toast('Copy disabled — rate sheet not approved'); return; }
    ensureQuoteNumber();
    var text = buildCopyText();
    var done = function () { toast('Quote copied to clipboard'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text) ? done() : toast('Copy failed'); });
    } else { fallbackCopy(text) ? done() : toast('Copy failed'); }
  }
  function fallbackCopy(text) {
    var ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta);
    ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta); return ok;
  }

  function buildPrint() {
    var r = state.result, s = quoteSummary(), root = $('printView');
    root.innerHTML = '';
    if (quoteIsExample()) root.appendChild(el('div', { 'class': 'pq-example' }, 'EXAMPLE PRICING – NOT REAL RATES'));
    var head = el('header', { 'class': 'pq-head' });
    var left = el('div');
    left.appendChild(el('div', { 'class': 'pq-name' }, B.name));
    left.appendChild(el('div', { 'class': 'pq-tag' }, B.tagline));
    left.appendChild(el('div', { 'class': 'pq-contact' }, B.contactName + ' · ' + B.phone));
    left.appendChild(el('div', { 'class': 'pq-contact' }, B.email + ' · ' + B.website));
    if (B.abn) left.appendChild(el('div', { 'class': 'pq-contact' }, 'ABN ' + B.abn));
    var right = el('div', { 'class': 'pq-meta' });
    right.appendChild(el('div', { 'class': 'pq-doc' }, 'QUOTE'));
    [['Quote no', state.quoteNo], ['Date', s.date], ['Valid for', s.validUntil ? s.validDays + ' days' : null], ['Valid until', s.validUntil]].forEach(function (kv) {
      if (!kv[1]) return; var d = el('div'); d.appendChild(el('span', null, kv[0] + ': ')); d.appendChild(el('strong', null, kv[1])); right.appendChild(d);
    });
    head.appendChild(left); head.appendChild(right); root.appendChild(head);

    var info = el('dl', { 'class': 'pq-info' });
    [['Client / paddock', s.client || '—'], ['Job', s.job], ['Product', s.product], ['Notes', s.notes]].forEach(function (kv) {
      if (!kv[1]) return; info.appendChild(el('dt', null, kv[0])); info.appendChild(el('dd', null, kv[1]));
    });
    root.appendChild(info);

    var t = el('table', { 'class': 'pq-table' });
    var th = el('thead'); var hr = el('tr'); hr.appendChild(el('th', null, 'Item')); hr.appendChild(el('th', null, 'Amount (ex GST)')); th.appendChild(hr); t.appendChild(th);
    var tb = el('tbody');
    r.lines.forEach(function (l) {
      var tr = el('tr'); var c = el('td'); c.appendChild(el('div', { 'class': 'pq-l' }, l.label)); c.appendChild(el('div', { 'class': 'pq-d' }, l.detail));
      tr.appendChild(c); tr.appendChild(el('td', null, money(l.amount))); tb.appendChild(tr);
    });
    t.appendChild(tb);
    var tf = el('tfoot');
    [['Subtotal (ex GST)', r.subtotal], [gstLabel(r), r.gst], ['Total (inc GST)', r.total]].forEach(function (kv, i) {
      var tr = el('tr', i === 2 ? { 'class': 'pq-grand' } : null); tr.appendChild(el('td', null, kv[0])); tr.appendChild(el('td', null, money(kv[1]))); tf.appendChild(tr);
    });
    if (r.perHaInc !== null) { var ph = el('tr', { 'class': 'pq-perha' }); ph.appendChild(el('td', null, 'Price per hectare')); ph.appendChild(el('td', null, money(r.perHaInc) + ' inc GST')); tf.appendChild(ph); }
    t.appendChild(tf); root.appendChild(t);

    var lic = el('section', { 'class': 'pq-lic' });
    lic.appendChild(el('h4', null, 'Certified, licensed & insured'));
    var ul = el('ul'); B.licences.forEach(function (x) { ul.appendChild(el('li', null, x)); }); lic.appendChild(ul);
    root.appendChild(lic);
    root.appendChild(el('p', { 'class': 'pq-disc' }, B.disclaimer));
    root.appendChild(el('footer', { 'class': 'pq-foot' }, B.name + ' · ' + B.region + ' · ' + B.phone + ' · ' + B.email));
    root.appendChild(el('div', { 'class': 'pq-stamp' }, s.rateSheet + ' · ' + state.quoteNo));
  }

  function printQuote() {
    if (!state.result) return;
    ensureQuoteNumber();
    buildPrint();
    window.print();
  }

  function newQuote() {
    $('quoteForm').reset();
    state.touched = {}; state.rateEdited = false; state.unitEdited = false;
    state.quoteCommitted = false;
    state.quoteNo = S.peekQuoteNumber(store, new Date());
    buildJobTypes(); buildProducts(); prefillDefaults(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ---------- Settings dialog ----------
  var draft = null;

  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, path, v) { var ks = path.split('.'); var last = ks.pop(); var t = ks.reduce(function (a, k) { return a[k] = a[k] || {}; }, o); t[last] = v; }

  function openSettings() {
    draft = clone(state.pricing);
    fillSettings();
    $('settingsErrors').hidden = true;
    var d = $('settingsDialog');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
  function closeSettings() { var d = $('settingsDialog'); if (d.close) d.close(); else d.removeAttribute('open'); }

  function fillSettings() {
    $('settingsExampleNote').hidden = !S.samePricing(draft, EXAMPLE);
    $('approvedVersion').value = S.getApprovedVersion(store);
    document.querySelectorAll('#settingsForm [data-path]').forEach(function (inp) {
      var v = getPath(draft, inp.getAttribute('data-path'));
      if (inp.getAttribute('data-type') === 'bool') { inp.checked = !!v; return; }
      if (inp.hasAttribute('data-percent') && typeof v === 'number') v = Math.round(v * 10000) / 100;
      inp.value = v === undefined || v === null ? '' : v;
    });
    renderJobRows(); renderProductRows();
  }

  function unitSelect(value, label) {
    var s = el('select', { 'aria-label': label });
    ['L', 'kg'].forEach(function (u) { var o = el('option', { value: u }, u); if (u === value) o.selected = true; s.appendChild(o); });
    return s;
  }
  function labelled(text, control, cls) { var l = el('label', { 'class': 'sfield ' + (cls || '') }); l.appendChild(document.createTextNode(text)); l.appendChild(control); return l; }
  function numInput(v) { var i = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any' }); i.value = v === undefined || v === null ? '' : v; return i; }
  function txtInput(v) { var i = el('input', { type: 'text', maxlength: '80' }); i.value = v || ''; return i; }
  function removeBtn(fn, label) { var b = el('button', { type: 'button', 'class': 'btn btn-icon', 'aria-label': label }, '✕'); b.addEventListener('click', fn); return b; }

  function renderJobRows() {
    var box = $('jobTypeRows'); box.innerHTML = '';
    draft.jobTypes.forEach(function (j, i) {
      var row = el('div', { 'class': 'srow' });
      var name = txtInput(j.label); name.addEventListener('input', function () { j.label = name.value; });
      var rate = numInput(j.ratePerHa); rate.addEventListener('input', function () { j.ratePerHa = num(rate.value); });
      var unit = unitSelect(j.unit, 'Default unit'); unit.addEventListener('change', function () { j.unit = unit.value; });
      row.appendChild(labelled('Name', name, 'wide'));
      if (j.kind === 'lidar') {
        row.appendChild(el('p', { 'class': 'hint wide' }, 'LiDAR — rates are in the LiDAR section below.'));
      } else {
        var hph = numInput(j.haPerHour); hph.addEventListener('input', function () { j.haPerHour = num(hph.value); });
        row.appendChild(labelled('$ per ha', rate));
        row.appendChild(labelled('Rate unit', unit));
        row.appendChild(labelled('ha per hour (est.)', hph));
      }
      row.appendChild(removeBtn(function () {
        if (draft.jobTypes.length <= 1) { showSettingsErrors(['You need at least one job type.']); return; }
        draft.jobTypes.splice(i, 1); renderJobRows();
      }, 'Remove job type'));
      box.appendChild(row);
    });
  }

  function renderProductRows() {
    var box = $('productRows'); box.innerHTML = '';
    if (!draft.products.length) box.appendChild(el('p', { 'class': 'hint' }, 'No products yet — quotes will be client-supplied only.'));
    draft.products.forEach(function (p, i) {
      var row = el('div', { 'class': 'srow' });
      var name = txtInput(p.name); name.addEventListener('input', function () { p.name = name.value; });
      var unit = unitSelect(p.unit, 'Unit'); unit.addEventListener('change', function () { p.unit = unit.value; });
      var price = numInput(p.unitPrice); price.addEventListener('input', function () { p.unitPrice = num(price.value); });
      var rate = numInput(p.defaultRate); rate.addEventListener('input', function () { p.defaultRate = num(rate.value); });
      var jobSel = el('select', { 'aria-label': 'Used for' });
      jobSel.appendChild(el('option', { value: '' }, 'Any job'));
      draft.jobTypes.forEach(function (j) { var o = el('option', { value: j.id }, shortLabel(j.label)); if (p.jobTypes && p.jobTypes.length === 1 && p.jobTypes[0] === j.id) o.selected = true; jobSel.appendChild(o); });
      jobSel.addEventListener('change', function () { p.jobTypes = jobSel.value ? [jobSel.value] : []; });
      row.appendChild(labelled('Product', name, 'wide'));
      row.appendChild(labelled('Unit', unit));
      row.appendChild(labelled('Cost $/unit', price));
      row.appendChild(labelled('Default rate /ha', rate));
      row.appendChild(labelled('Used for', jobSel));
      row.appendChild(removeBtn(function () { draft.products.splice(i, 1); renderProductRows(); }, 'Remove product'));
      box.appendChild(row);
    });
  }

  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function collectGeneral() {
    document.querySelectorAll('#settingsForm [data-path]').forEach(function (inp) {
      var type = inp.getAttribute('data-type');
      if (type === 'bool') { setPath(draft, inp.getAttribute('data-path'), inp.checked); return; }
      if (type === 'text') { setPath(draft, inp.getAttribute('data-path'), inp.value.trim()); return; }
      var v = num(inp.value);
      if (v !== null && !isNaN(v) && inp.hasAttribute('data-percent')) v = v / 100;
      setPath(draft, inp.getAttribute('data-path'), v === null ? NaN : v);
    });
    draft.jobTypes.forEach(function (j) { if (typeof j.label === 'string') j.label = j.label.trim(); });
    draft.products.forEach(function (p) { if (typeof p.name === 'string') p.name = p.name.trim(); });
  }

  function showSettingsErrors(errs) {
    var box = $('settingsErrors'); box.innerHTML = '';
    if (!errs.length) { box.hidden = true; return; }
    box.appendChild(el('strong', null, 'Please fix:'));
    var ul = el('ul'); errs.forEach(function (e) { ul.appendChild(el('li', null, e)); }); box.appendChild(ul);
    box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function saveSettings() {
    collectGeneral();
    var res = S.savePricing(store, draft);
    if (!res.ok) { showSettingsErrors(res.errors); return; }
    S.setApprovedVersion(store, $('approvedVersion').value);
    applyNewPricing();
    closeSettings();
    toast(state.isExample ? 'Saved (still the example numbers)' : 'Pricing saved on this device');
  }

  function applyNewPricing() {
    loadSettings(); buildJobTypes(); buildProducts(); prefillDefaults(); render();
  }

  function exportSettings() {
    collectGeneral();
    var errs = S.validatePricing(draft);
    if (errs.length) { showSettingsErrors(errs); return; }
    var blob = new Blob([S.exportPricing(draft)], { type: 'application/json' });
    var ver = (draft.rateSheet && draft.rateSheet.version ? '-' + draft.rateSheet.version.replace(/[^A-Za-z0-9._-]/g, '') : '');
    var a = el('a', { href: URL.createObjectURL(blob), download: 'droneworks-pricing' + ver + '-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('Settings exported — keep this file private');
  }

  function importSettings(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var res = S.parseImport(String(reader.result), EXAMPLE);
      if (!res.ok) { showSettingsErrors(['Import failed:'].concat(res.errors)); return; }
      S.savePricing(store, res.pricing);
      applyNewPricing();
      draft = clone(state.pricing); fillSettings(); showSettingsErrors([]);
      var rs = state.pricing.rateSheet || {};
      toast('Imported rate sheet ' + (rs.version || '') + (state.sheet.ok ? '' : ' — not the approved version'));
    };
    reader.readAsText(file);
  }

  function resetSettings() {
    if (!window.confirm('Remove your saved pricing from this device and go back to the example numbers?')) return;
    S.clearPricing(store);
    applyNewPricing();
    draft = clone(state.pricing); fillSettings(); showSettingsErrors([]);
    toast('Reset to example pricing');
  }

  // ---------- Events ----------
  function bind() {
    var form = $('quoteForm');
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    form.addEventListener('input', function (e) {
      var t = e.target;
      if (t.id) state.touched[t.id === 'product' ? 'productId' : t.id] = true;
      if (t.id === 'appRate') state.rateEdited = t.value !== '';
      if (t.id === 'appUnit') state.unitEdited = true;
      render();
    });
    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'jobType') { buildProducts(); state.unitEdited = false; prefillRate(); }
      if (t.id === 'hireSupplier') prefillHire();
      if (t.id === 'product') {
        state.touched.productId = true;
        if (P.findProduct(state.pricing, t.value)) setRadio('supply', 'droneworks');
        prefillRate(true);
      }
      if (t.name === 'supply') state.touched.appRate = state.touched.appRate || false;
      render();
    });
    form.addEventListener('focusout', function (e) { if (e.target.id) { state.touched[e.target.id === 'product' ? 'productId' : e.target.id] = true; render(); } });

    $('copyQuote').addEventListener('click', function () { state.touched.__all = true; copyQuote(); });
    $('printQuote').addEventListener('click', function () { state.touched.__all = true; printQuote(); });
    $('newQuote').addEventListener('click', newQuote);
    window.addEventListener('beforeprint', function () { if (state.result) buildPrint(); });

    $('openSettings').addEventListener('click', openSettings);
    $('bannerSettings').addEventListener('click', openSettings);
    $('closeSettings').addEventListener('click', closeSettings);
    $('cancelSettings').addEventListener('click', closeSettings);
    $('saveSettings').addEventListener('click', saveSettings);
    $('exportSettings').addEventListener('click', exportSettings);
    $('importSettings').addEventListener('change', function (e) { var f = e.target.files[0]; if (f) importSettings(f); e.target.value = ''; });
    $('resetSettings').addEventListener('click', resetSettings);
    $('addJobType').addEventListener('click', function () { draft.jobTypes.push({ id: uid('job'), label: '', ratePerHa: 0, unit: 'L' }); renderJobRows(); renderProductRows(); });
    $('addProduct').addEventListener('click', function () { draft.products.push({ id: uid('prod'), name: '', unit: 'L', unitPrice: 0, defaultRate: 0, jobTypes: [] }); renderProductRows(); });
  }

  function prefillHire() {
    var name = $('hireSupplier').value.trim().toLowerCase();
    var sup = ((state.pricing.hire && state.pricing.hire.suppliers) || []).filter(function (s) { return s.name.toLowerCase() === name; })[0];
    if (!sup) return;
    if ($('hireCost').value === '') $('hireCost').value = sup.cost;
    if (sup.period) $('hirePeriod').value = sup.period;
  }

  function prefillRate(force) {
    var p = P.findProduct(state.pricing, $('product').value);
    if (p && (force || !state.rateEdited)) { $('appRate').value = p.defaultRate || ''; state.rateEdited = false; }
  }

  // ---------- Init ----------
  loadSettings();
  buildJobTypes();
  buildProducts();
  prefillDefaults();
  state.quoteNo = S.peekQuoteNumber(store, new Date());
  bind();
  render();

  // Exposed for debugging / headless tests only.
  window.DWApp = { state: state, render: render, buildCopyText: function () { return state.result ? buildCopyText() : ''; } };
})();
