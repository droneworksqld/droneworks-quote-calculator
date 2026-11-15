// Optional headless browser smoke test (not needed to use the app).
// Needs playwright-core and a local Chrome/Chromium, e.g.:
//   NODE_PATH=/path/to/node_modules CHROME=/usr/bin/google-chrome node tests/browser-check.js
// Also regenerates screenshot.png (390px phone width). Set PDF_OUT=/tmp/quote.pdf to save the print PDF.
const { chromium } = require('playwright-core');
const path = require('path');
const assert = require('assert/strict');

(async () => {
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);

  const visible = (sel) => page.locator(sel).isVisible();
  assert.equal(await visible('#exampleBanner'), true, 'example banner visible on first load');
  assert.equal(await page.locator('#copyQuote').isDisabled(), true, 'copy disabled before input');

  // Validation: negative hectares
  await page.fill('#hectares', '-5');
  await page.locator('#hectares').blur();
  assert.match(await page.textContent('[data-error-for="hectares"]'), /more than 0/);

  // Realistic example job: 120 ha spraying, DroneWorks supplies Example Herbicide @ 2 L/ha, 60 km one way, rush
  await page.fill('#hectares', '120');
  await page.selectOption('#product', 'ex-herbicide');
  assert.equal(await page.inputValue('#appRate'), '2', 'default rate prefilled');
  assert.equal(await page.locator('input[name="supply"][value="droneworks"]').isChecked(), true);
  await page.fill('#distanceKm', '60');
  await page.check('#rush');
  await page.fill('#client', 'Example Farming – North paddock');
  // 3600 + 720 rush + travel (120-50)*2=140 + product 2640 = 7100 ; GST 710 ; total 7810
  assert.equal(await page.textContent('#subtotal'), '$7,100.00');
  assert.equal(await page.textContent('#gst'), '$710.00');
  assert.equal(await page.textContent('#total'), '$7,810.00');
  const copy = await page.evaluate(() => window.DWApp.buildCopyText());
  assert.match(copy, /EXAMPLE PRICING/);
  assert.match(copy, /TOTAL \(inc GST\): \$7,810.00/);
  assert.match(copy, /Quote valid for 14 days \(until /);
  assert.match(copy, /Rate sheet EXAMPLE/);
  assert.doesNotMatch(copy, /Internal|hire/i);
  assert.match(await page.textContent('#quoteMeta'), /Valid 14 days/);
  assert.equal(await visible('#internalPanel'), true, 'internal panel on screen');

  // Set up / pack up / clean up: 3 × $50 on top of the quote above, then back to 0 before the screenshot.
  assert.equal(await page.inputValue('#setupEvents'), '0');
  await page.fill('#setupEvents', '3');
  assert.equal(await page.textContent('#subtotal'), '$7,250.00');
  assert.equal(await page.textContent('#gst'), '$725.00');
  assert.equal(await page.textContent('#total'), '$7,975.00');
  assert.match(await page.textContent('#breakdownRows'), /Set up \/ pack up \/ clean up/);
  assert.match(await page.textContent('#breakdownRows'), /3 × \$50\.00/);
  const copySetup = await page.evaluate(() => window.DWApp.buildCopyText());
  assert.match(copySetup, /Set up \/ pack up \/ clean up: \$150\.00/);
  assert.match(copySetup, /3 × \$50\.00/);
  await page.fill('#setupEvents', '-2');
  assert.match(await page.textContent('[data-error-for="setupEvents"]'), /negative/);
  await page.fill('#setupEvents', '1.5');
  assert.match(await page.textContent('[data-error-for="setupEvents"]'), /whole number/);
  await page.fill('#setupEvents', '101');
  assert.match(await page.textContent('[data-error-for="setupEvents"]'), /too many/);
  await page.fill('#setupEvents', '0');
  assert.equal(await page.textContent('[data-error-for="setupEvents"]'), '');
  assert.equal(await page.textContent('#total'), '$7,810.00');
  assert.equal((await page.textContent('#breakdownRows')).includes('Set up / pack up / clean up'), false);

  // GST toggle + rounding
  await page.uncheck('#gstOn');
  assert.equal(await page.textContent('#gst'), '$0.00');
  assert.equal(await page.textContent('#total'), '$7,100.00');
  await page.check('#gstOn');
  await page.selectOption('#roundTo', '100');
  assert.equal(await page.textContent('#subtotal'), '$7,100.00'); // already a round $100
  await page.fill('#setupEvents', '1'); // 7150 -> rounded up to 7200
  assert.equal(await page.textContent('#subtotal'), '$7,200.00');
  assert.match(await page.textContent('#breakdownRows'), /Rounding/);
  await page.fill('#setupEvents', '0');
  await page.selectOption('#roundTo', '10');

  // Hire on a spray job: folded into the application line, internal panel shows recovery
  await page.check('#hireOn');
  await page.fill('#hireSupplier', 'Example Hire Co');
  await page.locator('#hireSupplier').dispatchEvent('change');
  assert.equal(await page.inputValue('#hireCost'), '2000', 'known supplier prefills cost');
  await page.fill('#hireRecovery', '50');
  const rowsText = await page.textContent('#breakdownRows');
  assert.doesNotMatch(rowsText, /hire/i, 'no hire line on the quote');
  assert.match(await page.textContent('#internalPanel'), /Shortfall you absorb/);
  assert.match(await page.textContent('#warnings'), /WARNING/);
  await page.fill('#hireRecovery', '100');
  await page.uncheck('#hireOn');

  // Screenshot at phone width: grow the viewport to the full page height so sticky/fixed bars sit where they would on a phone.
  await page.evaluate(() => window.scrollTo(0, 0));
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 390, height: h });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'screenshot.png') });
  await page.setViewportSize({ width: 390, height: 844 });

  // LiDAR job (example rates): half day + 12 h processing, then hourly with a hired unit at 0% recovery
  await page.click('#newQuote');
  await page.click('#jobTypeGroup label:has-text("LiDAR")');
  assert.equal(await visible('#lidarFields'), true);
  assert.equal(await visible('#agFields'), false);
  assert.equal(await visible('#lidarExampleNote'), true);
  await page.fill('#processingHours', '12');
  // 2000 capture + 1080 processing = 3080
  assert.equal(await page.textContent('#subtotal'), '$3,080.00');
  await page.click('#lidarModeGroup label:has-text("Hourly")');
  await page.fill('#lidarHours', '3');
  await page.check('#hireOn');
  await page.fill('#hireCost', '2000');
  await page.fill('#hireRecovery', '0');
  assert.match(await page.textContent('#warnings'), /STRONG WARNING/);
  assert.equal(await page.locator('#copyQuote').isDisabled(), false, 'warnings never block the quote');
  await page.fill('#hireRecovery', '100');
  await page.screenshot({ path: '/tmp/pwtest/lidar.png', fullPage: true });

  // Print view: build it (window.print stubbed headless), render to PDF and check it is one page.
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('#printQuote');
  assert.match(await page.textContent('#printView'), /DWQ-\d{8}-001/);
  assert.match(await page.textContent('#printView'), /QLD Pilot Chemical Rating Licence/);
  assert.match(await page.textContent('#printView'), /estimate only/i);
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(pages, 1, 'printed quote fits on one page');
  if (process.env.PDF_OUT) require('fs').writeFileSync(process.env.PDF_OUT, pdf);

  // Settings: change minimum charge + rate, save, reload -> persisted, banner hidden
  await page.click('#openSettings');
  assert.equal(await page.inputValue('[data-path="setupFee"]'), '50');
  await page.fill('[data-path="minimumCharge"]', '800');
  await page.fill('[data-path="setupFee"]', '80');
  await page.locator('#jobTypeRows .srow').first().locator('input[type="number"]').first().fill('35');
  await page.screenshot({ path: '/tmp/pwtest/settings.png' });
  await page.click('#saveSettings');
  assert.equal(await visible('#exampleBanner'), false, 'banner hidden after custom pricing saved');
  await page.reload();
  assert.equal(await visible('#exampleBanner'), false, 'banner still hidden after reload');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dwq.pricing.v1')));
  assert.equal(saved.minimumCharge, 800);
  assert.equal(saved.setupFee, 80);
  assert.equal(saved.jobTypes[0].ratePerHa, 35);
  await page.fill('#hectares', '10'); // 350 < 800 -> minimum applies
  assert.equal(await page.textContent('#subtotal'), '$800.00');
  await page.fill('#setupEvents', '2'); // 2 × $80 on top of the $800 minimum
  assert.equal(await page.textContent('#subtotal'), '$960.00');
  assert.match(await page.textContent('#breakdownRows'), /2 × \$80\.00/);
  await page.fill('#setupEvents', '0');

  // Approved rate-sheet version mismatch disables Copy quote
  await page.click('#openSettings');
  await page.fill('#approvedVersion', 'v-something-else');
  await page.click('#saveSettings');
  assert.equal(await visible('#rateSheetWarning'), true);
  assert.equal(await page.locator('#copyQuote').isDisabled(), true, 'copy disabled on version mismatch');
  await page.click('#openSettings');
  await page.fill('#approvedVersion', '');
  await page.click('#saveSettings');
  assert.equal(await page.locator('#copyQuote').isDisabled(), false);

  // Export → import round trip via file
  await page.click('#openSettings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportSettings')]);
  const exported = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.equal(JSON.parse(exported).pricing.minimumCharge, 800);
  assert.equal(JSON.parse(exported).pricing.setupFee, 80);
  page.once('dialog', (d) => d.accept());
  await page.click('#resetSettings');
  assert.equal(await page.evaluate(() => localStorage.getItem('dwq.pricing.v1')), null);
  await page.setInputFiles('#importSettings', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await page.waitForFunction(() => !!localStorage.getItem('dwq.pricing.v1'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dwq.pricing.v1')).minimumCharge), 800);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dwq.pricing.v1')).setupFee), 80);

  assert.deepEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('Browser check passed');
})().catch((e) => { console.error(e); process.exit(1); });
