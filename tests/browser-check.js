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

  // Screenshot at phone width: grow the viewport to the full page height so sticky/fixed bars sit where they would on a phone.
  await page.evaluate(() => window.scrollTo(0, 0));
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 390, height: h });
  await page.screenshot({ path: path.resolve(__dirname, '..', 'screenshot.png') });
  await page.setViewportSize({ width: 390, height: 844 });

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
  await page.fill('[data-path="minimumCharge"]', '800');
  await page.locator('#jobTypeRows .srow').first().locator('input[type="number"]').fill('35');
  await page.screenshot({ path: '/tmp/pwtest/settings.png' });
  await page.click('#saveSettings');
  assert.equal(await visible('#exampleBanner'), false, 'banner hidden after custom pricing saved');
  await page.reload();
  assert.equal(await visible('#exampleBanner'), false, 'banner still hidden after reload');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dwq.pricing.v1')));
  assert.equal(saved.minimumCharge, 800);
  assert.equal(saved.jobTypes[0].ratePerHa, 35);
  await page.fill('#hectares', '10'); // 350 < 800 -> minimum applies
  assert.equal(await page.textContent('#subtotal'), '$800.00');

  // Export → import round trip via file
  await page.click('#openSettings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportSettings')]);
  const exported = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.equal(JSON.parse(exported).pricing.minimumCharge, 800);
  page.once('dialog', (d) => d.accept());
  await page.click('#resetSettings');
  assert.equal(await page.evaluate(() => localStorage.getItem('dwq.pricing.v1')), null);
  await page.setInputFiles('#importSettings', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await page.waitForFunction(() => !!localStorage.getItem('dwq.pricing.v1'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dwq.pricing.v1')).minimumCharge), 800);

  assert.deepEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('Browser check passed');
})().catch((e) => { console.error(e); process.exit(1); });
