const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { chromium } = require(path.join(os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const html = fs.readFileSync(path.join(__dirname, '../wix/master-quotations-20261126-account.inline.html'), 'utf8');
const top = 'https://www.ltpos.ai/quotation-fixture';
const embed = 'https://quotes-fixture.invalid/quotations.html';
const headings = ['Row', 'Image', 'Descriptions', 'History', 'List Cost', 'Discount', 'Net Cost', 'Remark',
  'Selling Price', 'Profit', 'Note', 'View Quote', 'GP Calculator'];

const parent = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<iframe style="position:absolute;inset:0;width:100%;height:100%;border:0" src="${embed}"></iframe><script>
  const customers = ['A', 'B'].map(customerId => ({ customerId, name: 'QA ' + customerId,
    fullName: 'QUOTATION PREVIEW ' + customerId, preferredCurrency: 'SGD', rateToMyr: 3.123456 }));
  const stamp = '2026-11-27T15:49:00Z';
  const rowsFor = id => Array.from({length: id === 'A' ? 136 : 1}, (_, index) => ({
    id: 'SELECTION-' + index, name: 'Chocolate biscuits ' + index, barcode: String(7612000000000 + index),
    ea: 18, packing: '12G x 18', staffNote: '', costAt: stamp, costMyr: 18,
    costDetails: { lpEa: 1, lpCtn: 18, disc1: 0, disc2: 0, disc3: 0, remark: 'Supplier terms' }, revision: 1,
    published: { enabled: true, priceEa: 99.99, priceCtn: 1799.82, currency: 'SGD' }
  }));
  const byCustomer = { A: rowsFor('A'), B: rowsFor('B') };
  window.actions = [];
  window.canEditNotes = true;
  addEventListener('message', event => {
    const m = event.data;
    if (m?.type !== 'MASTER_QUOTATION_REQUEST' || event.origin !== 'https://quotes-fixture.invalid') return;
    actions.push({ action: m.action, customerId: m.customerId, input: m.input });
    const send = result => event.source.postMessage({ type: 'MASTER_QUOTATION_RESULT', action: m.action,
      requestId: m.requestId, customerId: m.customerId, ok: true, result: { staffId: 'QA', ...result } }, event.origin);
    const rows = byCustomer[m.customerId];
    if (m.action === 'customers') return send({ customers });
    if (m.action === 'selection-counts') return send({ counts: [] });
    if (m.action === 'purchase-history') return send({ customerId: m.customerId, items: [] });
    if (m.action === 'quotes') return send({ customer: customers.find(c => c.customerId === m.customerId), rows,
      canEdit: true, canPublish: true, canEditNotes });
    if (m.action === 'save-note') {
      const row = rows.find(row => row.id === m.input.selectionId);
      row.staffNote = m.input.text;
      send({ revision: ++row.revision, text: row.staffNote });
    }
    if (m.action === 'cost') window.finishCost = () => {
      const costDetails = { lpEa: 1.25, lpCtn: 22.5, disc1: 10, disc2: 0, disc3: 0, remark: 'Latest supplier terms' };
      send({ pending: false, updated: 1, unchanged: 0, failed: 0, rows: [{ id: rows[0].id, costMyr: 22.5, costAt: stamp, costDetails }] });
    };
  });
</script>`;

async function inputFits(locator, value) {
  assert.equal(await locator.inputValue(), value);
  const widths = await locator.evaluate(input => {
    const style = getComputedStyle(input);
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = style.font;
    return { viewport: innerWidth, fontSize: style.fontSize, value: input.value, width: style.width,
      tracks: getComputedStyle(input.parentElement).gridTemplateColumns,
      available: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      required: canvas.measureText(input.value).width };
  });
  assert(widths.available > widths.required + 3, JSON.stringify(widths));
}

test('the Quotations worktable fits prices and keeps notes separate from cost refresh and brand-new quote submissions', { timeout: 35000 }, async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1500, 1280, 1024, 800, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 750 }, isMobile: width < 500, hasTouch: width < 500 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = route.request().url();
        if (url === top || url === embed) return route.fulfill({ contentType: 'text/html', body: url === top ? parent : html });
        return route.abort();
      });
      await page.goto(top);
      const frame = page.frameLocator('iframe');
      const cost = frame.locator('#catch-cost');
      await cost.waitFor({ timeout: 5000 });
      assert.deepEqual(await frame.locator('thead th').evaluateAll(nodes => nodes.map(node => node.firstChild.textContent.trim())), headings);
      const row = frame.locator('[data-row="SELECTION-0"]');
      const price = row.locator('[data-mode="EA"]');
      const gp = row.locator('[data-calc="GP"]');
      const note = row.locator('[data-quote-note]');
      const save = row.locator('[data-action="save-note"]');
      const search = frame.getByRole('searchbox', { name: 'Find product' });
      assert.equal(await search.getAttribute('placeholder'), 'Product name or barcode');
      assert.equal(await frame.locator('.quote-find label').count(), 0);
      assert.equal(await frame.locator('.quote-find-field svg').isVisible(), true);
      if (width >= 769) {
        assert.equal(await row.locator('.quotation-history').evaluate(cell => getComputedStyle(cell).textAlign), 'right');
        assert.equal(await frame.locator('.quote-history-heading').evaluate(cell => getComputedStyle(cell).textAlign), 'right');
        assert(await row.locator('.remark-cell').evaluate(cell => cell.clientWidth) >= 155);
        assert(await price.evaluate(el => {
          const lock = el.previousElementSibling.getBoundingClientRect();
          return el.getBoundingClientRect().left - lock.right <= 4;
        }));
        const colors = await frame.locator('thead th').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).backgroundColor));
        assert.notEqual(colors[7], colors[8]);
        assert.deepEqual(colors.slice(8, 12), Array(4).fill(colors[8]));
      }
      await row.getByRole('button', { name: 'Unlock unit price' }).click();
      await inputFits(price, '99.99');
      await gp.fill('99');
      await inputFits(gp, '99');
      if (width >= 769) {
        const layout = await cost.evaluate(button => {
          const [fx, updated] = button.parentElement.children;
          const rect = node => node.getBoundingClientRect();
          const bounds = rect(button), date = rect(updated), rate = rect(fx);
          const summary = rect(button.closest('.quote-summary').querySelector('.quote-counts'));
          return date.right <= bounds.left && bounds.right < summary.left &&
            Math.abs((rate.top + rate.bottom) / 2 - (bounds.top + bounds.bottom) / 2) < 2;
        });
        assert.equal(layout, true, `Catch Cost alignment at ${width}px`);
      }

      if (width === 1500) {
        await note.fill('MOQ 50 <CTN>');
        await cost.click();
        await page.waitForFunction(() => typeof finishCost === 'function');
        assert.equal(await cost.innerText(), 'Refreshing cost…');
        await page.evaluate(() => finishCost());
        await row.getByText('Latest supplier terms', { exact: true }).waitFor();
        assert.equal(await note.inputValue(), 'MOQ 50 <CTN>');
        assert.equal(await price.inputValue(), '99.99');
        assert.equal(await gp.inputValue(), '99');
        assert.equal(await row.locator('.cost-cell b').textContent(), '22.50');
        assert.equal(await frame.locator('.quote-spacer td').first().getAttribute('colspan'), '13');
        await save.click();
        await frame.getByText('Note saved.', { exact: true }).waitFor();
        assert.equal(await save.isHidden(), true);
        assert.equal(await price.getAttribute('readonly'), null);
        const select = frame.locator('#customer');
        await select.selectOption('B');
        await row.locator('input[data-quote-note][value=""]').waitFor();
        await select.selectOption('A');
        await row.locator('input[data-quote-note][value="MOQ 50 <CTN>"]').waitFor();
        const writes = await page.evaluate(() => actions.filter(item => ['save-note', 'publish', 'draft'].includes(item.action)));
        assert.deepEqual(writes.map(item => [item.action, item.customerId, item.input.text]), [['save-note', 'A', 'MOQ 50 <CTN>']]);
        const main = frame.locator('main');
        const grid = frame.locator('.quote-grid');
        assert.equal(await grid.evaluate(element => getComputedStyle(element).overflowY), 'visible');
        assert.equal(await main.evaluate(element => getComputedStyle(element).overflowY), 'auto');
        const mastTop = await frame.locator('.masthead').evaluate(el => el.getBoundingClientRect().top);
        await select.focus();
        await main.hover({ position: { x: 350, y: 350 } });
        await page.mouse.wheel(0, 900);
        await frame.locator('.quotation-controls[data-collapsed]').waitFor({ state: 'attached' });
        assert.equal(await frame.locator('.quotation-controls').evaluate(el => el.offsetHeight), 0);
        assert.equal(await frame.locator('.masthead').evaluate(el => el.getBoundingClientRect().top), mastTop);
        assert.equal(await grid.evaluate(element => {
          const summary = element.previousElementSibling.getBoundingClientRect();
          return Math.abs(element.querySelector('thead').getBoundingClientRect().top - summary.bottom) <= 1 &&
            Math.abs(summary.top - element.closest('main').getBoundingClientRect().top) <= 1;
        }), true);
        await main.evaluate(element => { element.scrollTop -= 80; });
        await frame.locator('.quotation-controls:not([data-collapsed])').waitFor({ state: 'attached' });
        assert(await frame.locator('.quotation-controls').evaluate(el => el.offsetHeight) > 40);
        await search.fill('7612000000135');
        const match = frame.locator('tr[data-row="SELECTION-135"].quote-find-target');
        await match.waitFor();
        assert.equal(await frame.locator('#quote-find-result').textContent(), 'Row 136');
        assert.equal(await search.evaluate(el => el === document.activeElement), true);
        await page.frames().find(item => item.url() === embed).waitForFunction(() => {
          const row = document.querySelector('tr[data-row="SELECTION-135"].quote-find-target');
          return row && row.getBoundingClientRect().bottom <= row.closest('main').getBoundingClientRect().bottom + 1;
        }, undefined, { timeout: 2500 });
        const matchPosition = await match.evaluate(el => {
          const bounds = el.getBoundingClientRect();
          const main = el.closest('main');
          return { top: bounds.top, bottom: bounds.bottom, rowHeight: bounds.height, viewport: main.getBoundingClientRect().bottom,
            scroll: main.scrollTop, maxScroll: main.scrollHeight - main.clientHeight,
            heading: el.closest('table').querySelector('thead').getBoundingClientRect().bottom };
        });
        assert(matchPosition.top >= matchPosition.heading - 1 && matchPosition.bottom <= matchPosition.viewport + 1, JSON.stringify(matchPosition));
        await main.evaluate(element => { element.scrollTop -= 100; });
        await frame.locator('.quotation-controls:not([data-collapsed])').waitFor({ state: 'attached', timeout: 4000 });
        await page.evaluate(() => { window.canEditNotes = false; });
        await select.selectOption('B');
        const readOnly = row.locator('input[data-quote-note][readonly]');
        await readOnly.waitFor();
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
