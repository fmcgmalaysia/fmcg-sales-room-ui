const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { start } = require('./server.cjs');
const evidence = 'C:/FMCG-WIX-LOCAL/handoff/catalogue-and-mobile-20261117/sequential-release-preflight/web-quotations-shared-customer-evidence';

async function main() {
  fs.mkdirSync(evidence, { recursive: true });
  const { server, qa } = start({ port: 8897, file: null });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const checks = [];
  async function waitForText(text) { await page.getByText(text, { exact: true }).waitFor(); }
  try {
    await page.goto('http://127.0.0.1:8897/#catalogue');
    await page.locator('[data-select=product-1]').click();
    await page.locator('[data-select=product-2]').click();
    await page.locator('[data-select=product-3]').click();
    await page.locator('#company').selectOption('GHR');
    await page.getByRole('link', { name: 'Quotations', exact: true }).click();
    assert.equal(await page.locator('#company').isVisible(), false);
    await page.getByRole('button', { name: 'Catch Cost', exact: true }).click();
    await waitForText('3 costs updated.');
    const gp = page.getByRole('spinbutton', { name: 'Target margin for Chocolate Cream Biscuits', exact: true });
    await gp.fill('25');
    const initialEa = page.getByRole('spinbutton', { name: 'Unit price for Chocolate Cream Biscuits', exact: true });
    assert.equal(await initialEa.inputValue(), '');
    const targetEa = page.getByRole('spinbutton', { name: 'Target unit price for Chocolate Cream Biscuits', exact: true });
    assert.equal(Number(await targetEa.inputValue()), 1);
    await page.getByRole('button', { name: 'Apply calculator for Chocolate Cream Biscuits', exact: true }).click();
    assert.equal(await initialEa.inputValue(), '1');
    const beforeCompanySwitch = await page.locator('.quote-grid tbody').innerText();
    await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
    await page.locator('#company').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#company').inputValue(), 'GHR');
    await page.locator('#company').selectOption('NCT');
    await page.getByRole('link', { name: 'Quotations', exact: true }).click();
    await initialEa.waitFor();
    assert.equal(await page.locator('#company').isVisible(), false);
    assert.equal(await page.locator('#customer').inputValue(), 'QA-A');
    assert.equal(await page.locator('.quote-grid tbody').innerText(), beforeCompanySwitch);
    assert.equal(await initialEa.inputValue(), '1');
    assert.equal(await targetEa.inputValue(), '1.00');
    checks.push('Company switch is hidden in Quotations; changing it elsewhere preserves the customer, grid and unsaved inputs');
    await page.getByRole('switch', { name: 'Show quote for Chocolate Cream Biscuits', exact: true }).click();
    await waitForText('Quotation is visible to this customer.');
    assert.equal(await page.getByRole('switch', { name: 'Show quote for Chocolate Cream Biscuits', exact: true }).getAttribute('aria-checked'), 'true');
    checks.push('Catalogue selection -> whole-list Catch Cost -> Target GP 25 -> visible quote');
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const metrics = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth, font: getComputedStyle(document.querySelector('input[data-mode]')).fontSize, menu: getComputedStyle(document.querySelector('#navigation')).display }));
      assert.equal(metrics.width, width); assert(metrics.body <= width + 1, JSON.stringify(metrics));
      if (width <= 600) {
        assert.equal(metrics.menu, 'none'); assert.equal(metrics.font, '16px');
        await page.locator('#menu').click();
        assert.equal(await page.locator('#menu').getAttribute('aria-expanded'), 'true');
        await page.locator('#menu').click();
      }
      if (width === 1440) {
        const name = page.getByText('Magiclean Kitchen Cleaner (TP) - Ocean and Love Story Limited Edition', { exact: true });
        assert(await name.evaluate(element => element.scrollWidth <= element.clientWidth));
        const handle = page.getByRole('button', { name: 'Move Sparkling Cola', exact: true });
        await handle.press('Alt+ArrowUp');
        assert.match(await page.locator('[data-row]').first().innerText(), /Sparkling Cola/);
        await handle.press('Alt+ArrowDown');
        assert.match(await page.locator('[data-row]').first().innerText(), /Chocolate Cream Biscuits/);
      }
      await page.screenshot({ path: path.join(evidence, `quotations-${width}.png`), fullPage: true });
      checks.push({ width, metrics });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const price = page.getByRole('spinbutton', { name: 'Unit price for Chocolate Cream Biscuits', exact: true });
    await price.fill('1.5');
    await page.locator('tr').filter({ has: price }).getByRole('button', { name: 'Update quote', exact: true }).click();
    await waitForText('Quotation is visible to this customer.');
    const previousPriceRow = page.locator('tr').filter({ has: price });
    assert.equal(await previousPriceRow.locator('[data-previous-sp]').innerText(), '12.00 / CTN');
    assert.equal(await page.locator('[data-previous-sp]').nth(1).innerText(), '');
    await page.locator('#menu').click();
    await page.getByRole('link', { name: 'Buyer Room', exact: true }).click();
    await waitForText('USD 18');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Excel', exact: true }).click();
    await (await downloaded).saveAs(path.join(evidence, 'QA-My-Selection.xlsx'));
    const workbook = fs.readFileSync(path.join(evidence, 'QA-My-Selection.xlsx')).toString();
    assert(workbook.includes('USD / CTN')); assert(workbook.includes('Chocolate Cream Biscuits'));
    await page.getByRole('spinbutton', { name: 'Quantity for Chocolate Cream Biscuits', exact: true }).fill('2');
    await page.getByRole('button', { name: 'Send order request', exact: true }).click();
    await waitForText('Order request received.');
    assert.equal(qa.store.rows('WixBuyerOrders').length, 1);
    const orderLine = JSON.parse(qa.store.rows('WixBuyerOrderLines')[0].payload);
    assert.equal(orderLine.lineAmount, 36);
    await page.screenshot({ path: path.join(evidence, 'buyer-order-390.png'), fullPage: true });
    checks.push('390 px unit-price update -> Buyer Room Excel downloaded -> two cartons ordered for USD 36');
    await page.locator('#customer').selectOption('QA-B');
    await waitForText('Choose products in Catalogue to request a quotation.');
    assert.equal(await page.locator('[data-item]').count(), 0);
    checks.push('Second customer cannot see the first customer selection or order');
    await page.locator('#customer').selectOption('QA-A');
    await page.locator('#menu').click(); await page.getByRole('link', { name: 'Quotations', exact: true }).click();
    await gp.waitFor();
    await price.fill('');
    qa.state.failure = 'AFTER';
    await page.getByRole('switch', { name: 'Show quote for Chocolate Cream Biscuits', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false' && document.querySelector('.quote-label')?.textContent === '');
    assert.equal(await page.getByRole('switch', { name: 'Show quote for Chocolate Cream Biscuits', exact: true }).isDisabled(), true);
    assert.equal(JSON.parse(qa.store.rows('WixBuyerOrderLines')[0].payload).lockedUnitPrice, 18);
    assert.equal(await price.inputValue(), '');
    checks.push('Incomplete price edit does not block hiding; edit retained; lost reply recovered; existing order retained USD 18 carton price');
    await price.fill('2');
    const draftRow = page.locator('tr').filter({ has: price });
    await draftRow.getByRole('button', { name: 'Save draft', exact: true }).click();
    await waitForText('Draft saved.');
    assert.equal(await draftRow.getByRole('button', { name: 'Save draft', exact: true }).isDisabled(), true);
    await price.fill('3'); await price.fill('2');
    assert.equal(await draftRow.getByRole('button', { name: 'Save draft', exact: true }).isDisabled(), true);
    checks.push('Saved draft and edit-then-revert both disable Save');
    await page.locator('#actor').selectOption('support');
    await page.waitForFunction(() => document.querySelector('#catch-cost')?.disabled);
    assert.equal(await price.isDisabled(), true);
    assert.equal(await page.getByRole('switch', { name: 'Show quote for Chocolate Cream Biscuits', exact: true }).isDisabled(), true);
    checks.push('Read-only QA Support has disabled cost, price and publication controls');
    await page.setViewportSize({ width: 1440, height: 1000 });
    const fixture = qa.store.rows('WixBuyerListItems').find(item => item.customerId === 'QA-A');
    for (let i = 4; i <= 1000; i++) {
      const original = JSON.parse(fixture.payload);
      const id = 'volume-product-' + i;
      qa.store.rows('FMCGMALAYSIA').push({ _id: id, name: 'Volume test item ' + i, description: '100 g × 12', ea: 12 });
      qa.store.rows('WixBuyerListItems').push({
        ...fixture,
        _id: 'volume-selection-' + i,
        payload: JSON.stringify({ ...original, productId: id, unitBarcode: String(9900000000000 + i) })
      });
    }
    await page.locator('#actor').selectOption('sales');
    await page.getByText('Volume test item 1000', { exact: true }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('.quote-grid tbody tr').count(), 1000);
    assert.equal(await page.locator('[data-page]').count(), 0);
    await page.locator('#search').fill('Volume test item 1000');
    assert.equal(await page.locator('.quote-grid tbody tr').count(), 1);
    assert.equal(await page.locator('.quote-grid .product-name').innerText(), 'Volume test item 1000');
    checks.push('1,000 fixture rows on one page, with search reaching the last row');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ passed: true, checks, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
