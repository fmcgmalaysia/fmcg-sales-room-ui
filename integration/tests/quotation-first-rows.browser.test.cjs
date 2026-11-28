const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { chromium } = require(path.join(os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const html = fs.readFileSync(path.join(__dirname, '../wix/master-quotations-20261126-account.inline.html'), 'utf8');
const top = 'https://www.ltpos.ai/quotation-fixture';
const embed = 'https://quotes-fixture.invalid/quotations.html';

function customer(id, total) {
  return {
    customerId: id, name: id + ' TEST', preferredCurrency: 'USD', rateToMyr: 4,
    rows: Array.from({ length: total }, (_, index) => ({
      id: id + '-' + index, name: id + ' Product ' + index,
      barcode: String(8100000000000 + index), ea: 12, revision: 1, selectionEpoch: 'current',
      draft: { mode: 'EA', value: 2, priceEa: 2, priceCtn: 24, currency: 'USD' }
    }))
  };
}

const customers = [customer('ALPHA', 1), customer('BETA', 219), customer('CHARLIE', 2)];
const parent = `<iframe style="width:100%;height:100vh;border:0" src="${embed}"></iframe><script>
  const customers = ${JSON.stringify(customers)};
  const costs = new Map();
  window.finishCosts = (id, mode) => costs.get(id)?.(mode);
  window.costsWaiting = id => costs.has(id);
  let manualDone;
  window.finishManualCost = () => manualDone();
  addEventListener('message', event => {
    const m = event.data;
    if (m?.type !== 'MASTER_QUOTATION_REQUEST' || event.origin !== 'https://quotes-fixture.invalid') return;
    const send = (result, accessDenied = false) => event.source.postMessage({
      type: 'MASTER_QUOTATION_RESULT', requestId: m.requestId, action: m.action, customerId: m.customerId,
      ok: !accessDenied, result: result && { staffId: 'TEST', ...result }, accessDenied
    }, event.origin);
    const customer = customers.find(row => row.customerId === m.customerId);
    if (m.action === 'customers') return send({ customers });
    if (m.action === 'selection-counts') return send({ counts: [] });
    if (m.action === 'purchase-history') return send({ customerId: m.customerId, items: [] });
    if (m.action === 'cost') manualDone = () => send({ pending: false, rows: [], updated: 0, unchanged: 1, failed: 0 });
    if (m.action === 'quotes') return send({ customer, rows: customer.rows, canEdit: true, canPublish: true,
      costsDeferred: m.input?.deferCosts === true });
    if (m.action === 'quote-current-costs') costs.set(m.customerId, mode => {
      costs.delete(m.customerId);
      if (mode === 'denied') return send(null, true);
      send({ customerId: m.customerId, rows: mode === 'unavailable' ? null : customer.rows.map(row => ({
        id: row.id, selectionEpoch: 'current', costMyr: 24, costAt: '2026-11-28T00:00:00Z',
        costDetails: { lpEa: 2, lpCtn: 24, remark: 'Confirmed current cost' }
      })) });
    });
  });
</script>`;

test('Quotations renders while costs are pending and preserves the current customer, search and controls', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url() === top) return route.fulfill({ contentType: 'text/html', body: parent });
      if (route.request().url() === embed) return route.fulfill({ contentType: 'text/html', body: html });
      return route.abort();
    });
    await page.goto(top);
    const quote = page.frameLocator('iframe');
    const select = quote.locator('#customer');
    const catchCost = quote.locator('#catch-cost');
    const find = quote.locator('#quote-find');
    const banner = quote.locator('#quote-cost-wait');
    const gridTop = () => quote.locator('.quote-grid').evaluate(grid => Math.round(grid.getBoundingClientRect().top));
    const scenes = new Set();
    const readBanner = async () => {
      await banner.waitFor();
      scenes.add(await banner.locator('.quote-cost-wait-art').getAttribute('data-scene'));
      assert.match(await banner.innerText(), /\d\d:\d\d/);
    };
    const row = id => quote.locator('tr[data-row="' + id + '"]');
    await row('ALPHA-0').waitFor();
    assert.equal(await banner.isVisible(), false);
    const beforeBanner = await gridTop();
    await readBanner();
    assert.equal(await gridTop(), beforeBanner);
    assert.match(await banner.locator('time').textContent(), /^00:0[2-9]$/);
    assert.match(await banner.innerText(), /Auto-refreshing costs/);
    assert.equal(await catchCost.textContent(), 'Checking costs…');
    assert.equal(await row('ALPHA-0').locator('[data-mode=EA]').isEnabled(), false);
    await select.selectOption('BETA');
    await row('BETA-0').waitFor();
    await readBanner();
    await page.setViewportSize({ width: 320, height: 850 });
    const mobile = await banner.evaluate(element => ({
      width: Math.round(element.getBoundingClientRect().width),
      height: Math.round(element.getBoundingClientRect().height),
      fits: element.scrollWidth <= element.clientWidth
    }));
    assert(mobile.width <= 268 && mobile.height <= 44 && mobile.fits, JSON.stringify(mobile));
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await quote.locator('table').getAttribute('aria-rowcount'), '220');
    await find.fill('BETA Product 41');
    await page.waitForFunction(() => costsWaiting('ALPHA') && costsWaiting('BETA'));
    await page.evaluate(() => finishCosts('ALPHA'));
    assert.equal(await catchCost.isVisible(), false);
    assert.equal(await row('ALPHA-0').count(), 0);
    await page.evaluate(() => finishCosts('BETA'));
    await quote.getByRole('button', { name: 'Catch Cost', exact: true }).waitFor();
    assert.equal(await banner.isVisible(), false);
    assert.equal(await find.inputValue(), 'BETA Product 41');
    assert.equal(await find.evaluate(input => input === document.activeElement), true);
    assert.equal(await row('BETA-41').locator('[data-mode=EA]').isEnabled(), true);
    assert.match(await row('BETA-41').innerText(), /Confirmed current cost/);
    await select.selectOption('CHARLIE');
    await row('CHARLIE-0').waitFor();
    await readBanner();
    await page.waitForFunction(() => costsWaiting('CHARLIE'));
    await page.evaluate(() => finishCosts('CHARLIE', 'unavailable'));
    await quote.getByText('Current costs could not be checked.', { exact: false }).waitFor();
    assert.equal(await banner.isVisible(), false);
    assert.equal(await catchCost.isEnabled(), true);
    await catchCost.click();
    await readBanner();
    assert.equal(await banner.getByRole('status').innerText(), 'Refreshing costs…');
    await page.evaluate(() => finishManualCost());
    await banner.waitFor({ state: 'hidden' });
    await select.selectOption('ALPHA');
    await row('ALPHA-0').waitFor();
    await readBanner();
    assert.equal(scenes.size, 5);
    await page.waitForFunction(() => costsWaiting('ALPHA'));
    await page.evaluate(() => finishCosts('ALPHA', 'denied'));
    await row('ALPHA-0').waitFor({ state: 'detached' });
    assert.equal(await banner.isVisible(), false);
    await select.selectOption('BETA');
    await row('BETA-0').waitFor();
    await page.waitForFunction(() => costsWaiting('BETA'));
    await page.evaluate(() => finishCosts('BETA'));
    await quote.getByRole('button', { name: 'Catch Cost', exact: true }).waitFor();
    assert.equal(await banner.isVisible(), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
