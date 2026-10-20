const test = require('node:test'), assert = require('node:assert/strict');
const { projectRows, buildDraft } = require('../../support-room/invoice-draft-model.js');
const source = (id, extra = {}) => ({ id, taskId: 'SOURCE', company: 'NCT', customerId: '168', customerName: '168 LTD',
  invoicePartyKey: 'BILL-168', currency: 'USD', shipmentGroup: 'CONTAINER-A', warehouseVersion: 'LOAD-1', invoiceCoverageVersion: 'INV-1',
  taskQty: 100, loadedQty: 80, invoicedQty: 20, pendingInvoiceQty: 0, loadedConfirmed: true,
  cbmPerCtn: 0.0118, netWeightKgPerCtn: 8.4, sellingPriceCtnCents: 1008, ...extra });
const rows = (...values) => projectRows({ company: 'NCT', rows: values });
const versions = values => Object.fromEntries(values.flatMap(row => [[row.id, row.warehouseVersion], [row.id + ':invoice', row.invoiceCoverageVersion]]));

test('invoice uses confirmed loaded less issued and pending coverage, never requested or received', () => {
  const row = rows(source('A', { requestedQty: 500, receivedQty: 400, pendingInvoiceQty: 5 }))[0];
  assert.equal(row.invoiceQty, 55); assert.equal(row.amountCents, 55440);
  assert.equal(row.cbmMicro, 649000); assert.equal(row.netWeightGrams, 462000);
});
test('independent delivery batches of the same source may share one invoice without merging identities', () => {
  const values = rows(source('BATCH-1'), source('BATCH-2', { loadedQty: 20, invoicedQty: 0, taskQty: 20 }));
  const result = buildDraft(values, values.map(row => row.id), versions(values));
  assert.equal(result.quantity, 80); assert.equal(result.lines.length, 2);
  assert.equal(result.amountCents, 80640); assert.equal(result.cbmMicro, 944000); assert.equal(result.netWeightGrams, 672000);
});
test('unloaded, stale, unconfirmed and over-invoiced loading rows cannot be selected', () => {
  for (const extra of [{ loadedQty: 0, invoicedQty: 0 }, { stale: true }, { loadedConfirmed: false }, { invoicedQty: 81 }]) {
    const values = rows(source('A', extra));
    assert.equal(values[0].selectable, false);
    assert.throws(() => buildDraft(values, ['A'], versions(values)), /eligible/);
  }
});
test('already fully invoiced loading does not become eligible until loading actually increases', () => {
  assert.equal(rows(source('A', { loadedQty: 20 }))[0].invoiceQty, 0);
  assert.equal(rows(source('A', { loadedQty: 20 }))[0].status, 'INVOICED');
  assert.equal(rows(source('A', { loadedQty: 30 }))[0].invoiceQty, 10);
});
test('customer, bill-to, currency and shipment cannot silently mix on one invoice', () => {
  for (const extra of [{ customerId: 'OTHER' }, { invoicePartyKey: 'OTHER' }, { currency: 'MYR' }, { shipmentGroup: 'NEXT' }]) {
    const values = rows(source('A'), source('B', extra));
    assert.throws(() => buildDraft(values, ['A', 'B'], versions(values)), /same company/);
  }
  assert.throws(() => rows(source('A', { company: 'GHR' })), /Company mismatch/);
});
test('missing CBM or net weight is unknown, blocks complete preview and is never treated as zero', () => {
  const values = rows(source('A'), source('B', { netWeightKgPerCtn: null }));
  const result = buildDraft(values, ['A', 'B'], versions(values));
  assert.equal(result.netWeightGrams, null); assert.equal(result.canPreview, false);
  assert.deepEqual(result.missing, ['NET_WEIGHT']); assert.equal(result.quantity, 120);
});
test('changed loading or invoice coverage invalidates the original checkbox selection', () => {
  const original = rows(source('A')), captured = versions(original);
  for (const extra of [{ warehouseVersion: 'LOAD-2' }, { invoiceCoverageVersion: 'INV-2' }]) {
    assert.throws(() => buildDraft(rows(source('A', extra)), ['A'], captured), /changed/);
  }
});
test('duplicate identities, malformed quantities and invalid selling price cannot produce an invoice', () => {
  assert.throws(() => rows(source('A'), source('A')), /Duplicate/);
  for (const loadedQty of [-1, 1.5, NaN, 101]) assert.equal(rows(source('A', { loadedQty }))[0].selectable, false);
  const values = rows(source('A', { sellingPriceCtnCents: null }));
  assert.equal(buildDraft(values, ['A'], versions(values)).canPreview, false);
});

test('missing invoice coverage version cannot be accepted as an unchanged empty version', () => {
  const values = rows(source('A', { invoiceCoverageVersion: undefined }));
  assert.equal(values[0].selectable, false);
  assert.throws(() => buildDraft(values, ['A'], versions(values)), /eligible/);
});

test('pending invoice coverage reduces eligibility before a second employee can bill those cartons', () => {
  const values = rows(source('A', { loadedQty: 80, invoicedQty: 20, pendingInvoiceQty: 60 }));
  assert.equal(values[0].invoiceQty, 0); assert.equal(values[0].status, 'INVOICE_PENDING');
  assert.throws(() => buildDraft(values, ['A'], versions(values)), /eligible/);
});

test('building a preview leaves loading evidence and previous invoice coverage untouched', () => {
  const input = source('A'), before = JSON.stringify(input), values = rows(input), snapshot = JSON.stringify(values);
  const result = buildDraft(values, ['A'], versions(values));
  result.lines[0].invoiceQty = 1;
  assert.equal(JSON.stringify(input), before); assert.equal(JSON.stringify(values), snapshot);
});
