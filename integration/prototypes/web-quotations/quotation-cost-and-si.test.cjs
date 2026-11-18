const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash, randomUUID } = require('node:crypto');
const { load, initialState, createStore } = require('./isolation.cjs');

const firstBarcode = '0999000000007';
const secondBarcode = '0999000000008';
const customerId = 'QA-A';

test('Last SP reads the matching customer and product from issued SI snapshots across both companies', async () => {
  const operationId = (...value) => JSON.stringify(value);
  const { FULFILMENT_ACTION, readCustomerShipments } = load('integration/backend/customerShipmentLedger.js',
    ['FULFILMENT_ACTION', 'readCustomerShipments'], { operationId });
  const { createLastInvoicedPrices } = load('integration/backend/masterQuotationLastSale.js',
    ['createLastInvoicedPrices'], { FULFILMENT_ACTION, readCustomerShipments,
      PURCHASE_COLLECTIONS: { NCT: { activity: 'NCTActivity' }, GHR: { activity: 'NCTActivity1' } } });
  const state = initialState();
  const wixData = createStore(state, () => {});

  async function invoice(collection, company, id, customer, date, priceCtn, issue = true) {
    const lines = [{ taskId: 'TASK-' + id, barcode: firstBarcode, quantity: 1, sources: [{ sourceTaskId: 'SOURCE-' + id, quantity: 1 }] }];
    const shipment = { id, company, customerId: customer, currency: 'USD', status: 'REQUESTED', lines };
    const activity = { action: FULFILMENT_ACTION, result: 'SAVED', image: customer, description: id };
    const at = date + 'T03:00:00Z';
    await wixData.insert(collection, { ...activity, title: id + '-requested', activityTime: at,
      details: { beforeRevision: '', shipment } });
    if (!issue) return;
    await wixData.insert(collection, { ...activity, title: id + '-issued', activityTime: at,
      details: { beforeRevision: id + '-requested', shipment: { ...shipment, status: 'INVOICED',
        lines: [{ ...lines[0], sellingPriceCtn: priceCtn }],
        invoice: { date, at, number: id, currency: 'USD', rateToMyr: 4, amountCents: priceCtn * 100 } } } });
  }
  await invoice('NCTActivity', 'NCT', 'SI-NCT', customerId, '2026-11-12', 16);
  await invoice('NCTActivity1', 'GHR', 'SI-GHR', customerId, '2026-11-15', 22);
  await invoice('NCTActivity1', 'GHR', 'SI-OTHER-CUSTOMER', 'QA-B', '2026-11-17', 99);
  await invoice('NCTActivity1', 'GHR', 'NOT-ISSUED', customerId, '2026-11-18', 44, false);
  const result = await createLastInvoicedPrices(wixData)(customerId, [{ barcode: firstBarcode }, { barcode: secondBarcode }]);
  assert.deepEqual({ ...result.get(firstBarcode) }, { priceCtn: 22, currency: 'USD', siDate: '2026-11-15' });
  assert.equal(result.has(secondBarcode), false);
});

test('nightly costs deduplicate cross-customer barcodes and keep published price, visibility, version and draft unchanged', async () => {
  const { createQuotationNightlyCosts } = load('integration/backend/masterQuotationNightlyCosts.js', ['createQuotationNightlyCosts']);
  const { calculateNetCartonCost, calculateGrossProfitMargin } = load('integration/backend/grossProfitMargin.js',
    ['calculateNetCartonCost', 'calculateGrossProfitMargin']);
  const { createMasterQuotationService } = load('integration/backend/masterQuotationService.js',
    ['createMasterQuotationService'], { createHash, randomUUID, calculateNetCartonCost, calculateGrossProfitMargin });
  const price = { enabled: true, priceEa: 1.5, priceCtn: 18, currency: 'USD', version: 2, publishedAt: '2026-11-17T10:00:00Z' };
  const draft = { mode: 'GP', value: 50 };
  const rows = [{ customerId, id: 'SEL-A', barcode: firstBarcode }, { customerId, id: 'SEL-B', barcode: secondBarcode },
    { customerId: 'QA-B', id: 'SEL-C', barcode: firstBarcode }];
  const existing = new Map(rows.map(row => [row.id, { revision: 1, snapshot: { costMyr: 36, draft, published: price } }]));
  existing.get('SEL-B').snapshot.pending = { requestId: 'IN-FLIGHT' };
  const append = [];
  const quotation = createMasterQuotationService({ revisions: {
    latest: async (_, id) => existing.get(id),
    async append(command) {
      append.push(command);
      existing.set(command.selectionId, { revision: 2, snapshot: command.snapshot });
    }
  }, deliver: () => assert.fail('A cost-only refresh may not publish a quote') });
  const requests = [];
  const run = createQuotationNightlyCosts({
    readCustomers: async () => [{ customerId }, { customerId: 'QA-B' }],
    readSelections: async id => rows.filter(row => row.customerId === id),
    readCosts: async barcodes => {
      requests.push(barcodes);
      return { [firstBarcode]: { unitBarcode: firstBarcode, costCurrency: 'MYR', costStatus: 'CAPTURED',
        capturedAt: '2026-11-17T16:01:00Z', lpPc: 4, lpCtn: 48, disc1: 0, disc2: 0, disc3: 0 } };
    },
    refreshCosts: quotation.refreshScheduledCosts,
    now: () => new Date('2026-11-17T16:01:00Z')
  });
  const result = await run();
  assert.equal(result.updated, 2);
  assert.equal(result.pending, 1);
  assert.deepEqual(Array.from(requests[0]), [firstBarcode, secondBarcode]);
  for (const command of append) {
    assert.equal(command.snapshot.costMyr, 48);
    assert.deepEqual(command.snapshot.published, price);
    assert.deepEqual(command.snapshot.draft, draft);
  }
  const repeat = await run();
  assert.equal(repeat.unchanged, 2);
  assert.equal(append.length, 2);
});
