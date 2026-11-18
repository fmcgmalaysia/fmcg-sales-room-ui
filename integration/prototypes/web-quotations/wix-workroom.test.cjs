const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { buildWixWorkroom } = require('./build-wix-workroom.cjs');

const bridge = fs.readFileSync(path.join(__dirname, '../../wix/master-quotations-bridge.js'), 'utf8');
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');

test('the iframe bridge preserves correlation and never forwards a client-supplied staff identity', async () => {
  const { connectMasterQuotationFrame } = await import(moduleUrl(bridge));
  const requests = [];
  const replies = [];
  let listener;
  connectMasterQuotationFrame({ onMessage: fn => { listener = fn; }, postMessage: message => replies.push(message) },
    async (...args) => { requests.push(args); return { accessDenied: true }; });
  const requestId = randomUUID();
  const command = { type: 'MASTER_QUOTATION_REQUEST', action: 'draft', customerId: 'CUS-QA-001', requestId,
    staffId: 'FORGED', companyId: 'NCT', input: { requestId, revision: 0, selectionId: 'item-1', input: { mode: 'EA', value: 1.5 }, staffId: 'FORGED' } };

  await listener({ data: { ...command, requestId: 'not-a-uuid' } });
  await listener({ data: { ...command, input: { ...command.input, revision: -1 } } });
  assert.equal(requests.length, 0);
  await listener({ data: command });
  assert.deepEqual(requests, [['draft', 'CUS-QA-001', { requestId, revision: 0, selectionId: 'item-1', input: { mode: 'EA', value: 1.5 } }]]);
  assert.equal(replies.at(-1).requestId, requestId);
  assert.equal(replies.at(-1).customerId, command.customerId);
  assert.equal(replies.at(-1).accessDenied, true);
});

test('quotation actions recheck the original staff policy and send no unassigned customer to the workroom', async () => {
  const backend = path.join(__dirname, '../../backend');
  const policy = fs.readFileSync(path.join(backend, 'staffManagementPolicy.js'), 'utf8');
  const source = fs.readFileSync(path.join(backend, 'masterQuotationAccess.js'), 'utf8').replace('backend/staffManagementPolicy.js', moduleUrl(policy));
  const { createMasterQuotationActions } = await import(moduleUrl(source));
  const customers = ['CUS-QA-001', 'CUS-QA-002', 'CUS-QA-003'].map((customerId, i) => ({ customerId,
    name: 'QA ' + i, preferredCurrency: 'USD', rateToMyr: 4, quotationMode: 'WEB', webQuotationStatus: i === 2 ? 'PENDING' : 'READY' }));
  let identityReads = 0;
  let customerReads = 0;
  const writes = [];
  const staff = { title: 'STF-QA', staffName: 'Test staff', staffStatus: 'ACTIVE', staffAccess: {
    departmentAccess: { 'SALES MANAGEMENT': 'EDIT' }, companyIds: ['GHR'], salesRoom: 'EDIT', salesFunction: 'SALES',
    customerAccess: { 'CUS-QA-001': 'EDIT', 'CUS-QA-003': 'EDIT' }
  } };
  const run = createMasterQuotationActions({
    readIdentity: async () => { identityReads++; return { record: staff }; },
    readCustomers: async () => customers,
    readCustomer: async id => { customerReads++; return customers.find(customer => customer.customerId === id); },
    quotation: { list: async () => [{ id: 'prod-1' }], publish: async (scope, input) => { writes.push({ scope, input }); return { revision: 1 }; } }
  });
  assert.deepEqual(await run('customers', ''), { staffId: 'STF-QA', staffName: 'Test staff', customers: [{ customerId: 'CUS-QA-001', name: 'QA 0' }] });
  assert.deepEqual(await run('quotes', 'CUS-QA-002'), { accessDenied: true });
  assert.equal(customerReads, 0);
  assert.deepEqual(await run('quotes', 'CUS-QA-003'), { accessDenied: true });
  assert.equal((await run('quotes', 'CUS-QA-001')).canPublish, true);
  assert.deepEqual(await run('publish', 'CUS-QA-001', { enabled: true }), { revision: 1 });
  assert.equal(writes[0].scope.staffId, 'STF-QA');
  staff.staffAccess.salesFunction = 'SUPPORT';
  assert.equal((await run('quotes', 'CUS-QA-001')).canEdit, false);
  assert.deepEqual(await run('publish', 'CUS-QA-001', { enabled: true }), { accessDenied: true });
  staff.staffStatus = 'INACTIVE';
  assert.deepEqual(await run('customers', ''), { accessDenied: true });
  assert.equal(identityReads, 8);
  assert.equal(writes.length, 1);
});

test('a persisted revision acknowledges the insert result and retries an uncertain insert without duplicating it', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../backend/masterQuotationRevisionStore.js'), 'utf8');
  const { createMasterQuotationRevisionStore } = await import(moduleUrl(source));
  const rows = new Map();
  let reads = 0;
  let loseReceipt = false;
  const store = createMasterQuotationRevisionStore({
    latest: async (customer, selection) => [...rows.values()].filter(row => row.customerId === customer && row.selectionId === selection).at(-1),
    insert: async row => {
      if (rows.has(row._id)) throw Error('Duplicate key');
      rows.set(row._id, row);
      if (loseReceipt) throw Error('Response lost');
      return row;
    },
    read: async id => { reads++; return rows.get(id); }
  });
  const first = { customerId: 'CUS-QA-001', selectionId: 'item-1', expectedRevision: 0,
    commandId: randomUUID(), fingerprint: 'draft-1.50', snapshot: { priceEa: 1.5 } };
  const race = { ...first, commandId: randomUUID(), fingerprint: 'draft-1.75', snapshot: { priceEa: 1.75 } };
  const simultaneous = await Promise.allSettled([store.append(first), store.append(race)]);
  assert.deepEqual(simultaneous.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(reads, 1);
  assert.equal(rows.size, 1);
  reads = 0;
  const second = { ...first, expectedRevision: 1, commandId: randomUUID(), fingerprint: 'publish-1.50' };
  assert.equal((await store.append(second)).revision, 2);
  assert.equal(reads, 0);
  loseReceipt = true;
  const third = { ...second, expectedRevision: 2, commandId: randomUUID(), fingerprint: 'withdraw-1.50' };
  assert.equal((await store.append(third)).revision, 3);
  assert.equal(reads, 1);
  assert.equal((await store.append(third)).revision, 3);
  assert.equal((await store.append(first)).revision, 1);
  assert.equal(rows.size, 3);
});

test('the compact quotation grid renders and saves over the iframe message contract', async () => {
  const { chromium } = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'quotations-workroom-'));
  const asset = 'https://quote-ui.example.invalid';
  const parent = 'https://fmcg999.wixstudio.com';
  buildWixWorkroom(destination);
  const app = fs.readFileSync(path.join(destination, 'app.js'), 'utf8');
  assert.doesNotMatch(app, /qa-quote-order|#actor|\/api\//);
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const longName = 'Magiclean Kitchen Cleaner (TP) - Ocean and Love Story Limited Edition';
    const makeRow = (name, index) => ({ name, id: 'item-' + index, barcode: String(2000000000000 + index), packing: '710ML x 12', ea: 12,
      costMyr: 36, costDetails: { lpEa: 3, lpCtn: 36, disc1: 0, disc2: 0, disc3: 0, remark: '100 FOC 10' }, revision: 0 });
    const rows = [makeRow(longName, 0), ...Array.from({ length: 999 }, (_, i) => makeRow('Product ' + (i + 1), i + 1))];
    rows[0].costDetails.disc3 = 5;
    rows[0].costDetails.priceStale = true;
    rows[1].draft = { mode: 'EA', value: 0.8 };
    rows[2].draft = { mode: 'EA', value: 36 / 0.92 / 4 / 12 };
    rows[0].sortId = 'FO-00002';
    rows[1].sortId = 'FO-00010';
    rows[2].sortId = 'FO-00001';
    rows[3].sortId = 'NF-00001';
    const requests = [];
    let compactFixture = false;
    await page.exposeFunction('handleQuotation', (action, customerId, input) => {
      requests.push({ action, customerId, input });
      if (action === 'customers') return { staffId: 'STF-QA', staffName: 'Test staff', customers: [{ customerId: 'CUS-QA-001', name: 'QA Trading' }, { customerId: 'CUS-QA-002', name: 'Read only' }] };
      if (action === 'quotes') return { staffId: 'STF-QA', customer: { customerId, preferredCurrency: 'USD', rateToMyr: 4,
        fullName: customerId === 'CUS-QA-001' ? 'QA Trading Company Limited' : 'Read only' },
        canEdit: customerId === 'CUS-QA-001', rows: customerId === 'CUS-QA-001' ? (compactFixture ? rows.slice(0, 4) : rows) : [makeRow('Read only product', 1)] };
      if (action === 'draft') {
        const row = rows.find(item => item.id === input.selectionId);
        row.draft = input.input;
        return { revision: ++row.revision };
      }
      if (action === 'publish') {
        const row = rows.find(item => item.id === input.selectionId);
        row.published = { enabled: input.enabled, priceEa: row.draft.value, priceCtn: row.draft.value * row.ea,
          publishedAt: '2026-11-17T18:00:00.000Z' };
        return { revision: ++row.revision };
      }
      if (action === 'cost') {
        for (const row of rows) row.costAt = '2026-11-17T08:00:00.000Z';
        return { updated: rows.length, failed: 0 };
      }
      throw Error('Unexpected action');
    });
    await page.route(parent + '/quotations-test', route => route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0}iframe{display:block;width:100%;height:100vh;border:0}</style><iframe id="workroom" src="${asset}/index.html"></iframe><script type="module">${bridge}
      const frame = document.getElementById('workroom');
      connectMasterQuotationFrame({ onMessage: fn => window.addEventListener('message', event => {
        if (event.origin === '${asset}' && event.source === frame.contentWindow) fn(event);
      }), postMessage: data => frame.contentWindow.postMessage(data, '${asset}') }, window.handleQuotation);
      </script>` }));
    await page.route(asset + '/*', route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      return route.fulfill({ path: path.join(destination, file) });
    });
    await page.goto(parent + '/quotations-test');
    const grid = page.frameLocator('#workroom');
    const first = grid.locator('tr[data-row="item-0"]');
    await first.waitFor();
    assert.equal(await grid.locator('tbody tr').count(), 1000);
    assert.deepEqual(await grid.locator('tbody tr').evaluateAll(trs => trs.slice(0, 5).map(tr => tr.dataset.row)),
      ['item-2', 'item-0', 'item-1', 'item-3', 'item-4']);
    assert.equal(await grid.locator('.move-row').count(), 0);
    assert.equal(await grid.locator('#company, #actor').count(), 0);
    assert(await first.locator('.product-name').evaluate(el => el.scrollWidth <= el.clientWidth));

    assert.equal(await grid.getByRole('searchbox').count(), 0);
    assert.equal(await grid.locator('.quote-customer h2').textContent(), 'QA Trading Company Limited');
    assert.match(await first.locator('.disc-cell').textContent(), /Disc 35\.00$/);
    assert.equal(await first.locator('.stale-cost').textContent(), '36.00');
    assert.equal(await grid.locator('[data-row=item-1] .gp-risk').count(), 1);
    assert.equal(await grid.locator('#quote-risk-count').textContent(), '1');
    await grid.getByRole('button', { name: 'Catch Cost' }).click();
    await grid.getByText('1000 costs updated.').waitFor();
    await first.locator('[data-calc=GP]').fill('25');
    await first.getByRole('button', { name: 'Apply calculator', exact: false }).click();
    assert.equal(await first.locator('[data-mode=EA]').inputValue(), '1.00');
    await first.locator('[data-mode=EA]').fill('1.5');
    await first.getByRole('switch').click();
    await grid.getByText('Quotation is visible to this customer.').waitFor();
    await first.locator('[role=switch][aria-checked=true]').waitFor();
    assert.equal(requests.find(request => request.action === 'draft').input.input.value, 1.5);
    assert.equal(requests.find(request => request.action === 'publish').input.revision, 1);
    assert.equal(await first.locator('[data-carton]').textContent(), '18.00');
    assert.equal(await first.locator('.quote-label').textContent(), '18-11-26');
    assert.equal(await first.getByRole('button', { name: 'Save draft' }).count(), 0);
    const ea = first.locator('[data-mode=EA]');
    await ea.fill('3');
    await ea.press('Enter');
    await first.locator('[role=switch][aria-checked=false]').waitFor();
    assert.equal(await ea.inputValue(), '3.00');
    assert.equal(requests.filter(request => request.action === 'publish').at(-1).input.enabled, false);
    await ea.press('ArrowDown');
    assert.equal(await grid.locator('[data-row=item-1] [data-mode=EA]:focus').count(), 1);
    await first.locator('[data-calc=GP]').press('ArrowRight');
    assert.equal(await first.locator('[data-calc=EA]:focus').count(), 1);

    compactFixture = true;
    await grid.locator('#customer').selectOption('CUS-QA-002');
    await grid.getByText('Read only product', { exact: true }).waitFor();
    assert(await grid.locator('[data-mode=EA]').isDisabled());
    assert(await grid.getByRole('button', { name: 'Catch Cost' }).isDisabled());
    await grid.locator('#customer').selectOption('CUS-QA-001');
    await first.waitFor();
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 920 });
      const frame = await page.locator('#workroom').elementHandle();
      const workroom = await frame.contentFrame();
      await workroom.waitForFunction(width => innerWidth === width, width, { timeout: 3000 }).catch(async error => {
        throw Error(`Expected iframe width ${width}, got ${await workroom.evaluate(() => innerWidth)}`, { cause: error });
      });
      const metrics = await first.evaluate(el => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, height: el.getBoundingClientRect().height,
        font: getComputedStyle(el.querySelector('[data-mode]')).fontSize }));
      assert.equal(metrics.width, width);
      assert(metrics.scroll <= width + 1, JSON.stringify(metrics));
      assert(metrics.height > 0, JSON.stringify(metrics));
      if (width <= 600) assert.equal(metrics.font, '16px');
      if (process.env.QUOTATIONS_SCREENSHOTS && [1440, 390, 320].includes(width)) {
        fs.mkdirSync(process.env.QUOTATIONS_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.QUOTATIONS_SCREENSHOTS, `quote-workroom-${width}.png`) });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    fs.rmSync(destination, { recursive: true, force: true });
  }
});
