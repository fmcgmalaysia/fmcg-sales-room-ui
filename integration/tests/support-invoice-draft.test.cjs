const test = require('node:test'), assert = require('node:assert/strict');
const { projectRows, buildDraft } = require('../../support-room/invoice-draft-model.js');
const source = (id, extra = {}) => ({ id, taskId: 'SOURCE', company: 'NCT', customerId: '168', customerName: '168 LTD',
  invoicePartyKey: 'BILL-168', currency: 'USD', shipmentGroup: 'CONTAINER-A', warehouseVersion: 'LOAD-1', invoiceCoverageVersion: 'INV-1',
  taskQty: 100, loadedQty: 80, invoicedQty: 0, pendingInvoiceQty: 0, loadedConfirmed: true,
  cbmPerCtn: 0.0118, netWeightKgPerCtn: 8.4, sellingPriceCtnCents: 1008, ...extra });
const rows = (...values) => projectRows({ company: 'NCT', rows: values });
const versions = values => Object.fromEntries(values.flatMap(row => [[row.id, row.warehouseVersion], [row.id + ':invoice', row.invoiceCoverageVersion]]));

test('invoice quantity equals the confirmed container Loaded, never requested, received or a delta', () => {
  const row = rows(source('A', { requestedQty: 500, receivedQty: 400 }))[0];
  assert.equal(row.invoiceQty, 80); assert.equal(row.amountCents, 80640);
  assert.equal(row.cbmMicro, 944000); assert.equal(row.netWeightGrams, 672000);
});
test('independent delivery batches of the same source may share one invoice without merging identities', () => {
  const values = rows(source('BATCH-1'), source('BATCH-2', { loadedQty: 20, invoicedQty: 0, taskQty: 20 }));
  const result = buildDraft(values, values.map(row => row.id), versions(values));
  assert.equal(result.quantity, 100); assert.equal(result.lines.length, 2);
  assert.equal(result.amountCents, 100800); assert.equal(result.cbmMicro, 1180000); assert.equal(result.netWeightGrams, 840000);
});
test('unloaded, stale, unconfirmed and over-invoiced loading rows cannot be selected', () => {
  for (const extra of [{ loadedQty: 0, invoicedQty: 0 }, { stale: true }, { loadedConfirmed: false }, { invoicedQty: 81 }]) {
    const values = rows(source('A', extra));
    assert.equal(values[0].selectable, false);
    assert.throws(() => buildDraft(values, ['A'], versions(values)), /eligible/);
  }
});
test('an issued loading row is locked; increased loading requires correction rather than a new delta invoice', () => {
  const issued = rows(source('A', { loadedQty: 80, invoicedQty: 80 }))[0];
  assert.equal(issued.invoiceQty, 80); assert.equal(issued.status, 'INVOICED'); assert.equal(issued.selectable, false);
  const changed = rows(source('A', { loadedQty: 100, invoicedQty: 80 }));
  assert.equal(changed[0].invoiceQty, null); assert.equal(changed[0].status, 'REVIEW');
  assert.throws(() => buildDraft(changed, ['A'], versions(changed)), /eligible/);
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
  assert.deepEqual(result.missing, ['NET_WEIGHT']); assert.equal(result.quantity, 160);
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

test('a pending invoice locks the full loading row against a second invoice', () => {
  const values = rows(source('A', { loadedQty: 80, invoicedQty: 0, pendingInvoiceQty: 80 }));
  assert.equal(values[0].invoiceQty, 80); assert.equal(values[0].status, 'INVOICE_PENDING');
  assert.throws(() => buildDraft(values, ['A'], versions(values)), /eligible/);
});

test('legacy partial invoices and changed pending loading snapshots require review, never subtraction', () => {
  for (const extra of [{ invoicedQty: 20 }, { pendingInvoiceQty: 20 }, { loadedQty: 60, invoicedQty: 80 }]) {
    const values = rows(source('A', extra));
    assert.equal(values[0].invoiceQty, null); assert.equal(values[0].status, 'REVIEW');
    assert.throws(() => buildDraft(values, ['A'], versions(values)), /eligible/);
  }
});

test('building a preview leaves loading evidence and previous invoice coverage untouched', () => {
  const input = source('A'), before = JSON.stringify(input), values = rows(input), snapshot = JSON.stringify(values);
  const result = buildDraft(values, ['A'], versions(values));
  result.lines[0].invoiceQty = 1;
  assert.equal(JSON.stringify(input), before); assert.equal(JSON.stringify(values), snapshot);
});
