const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');

const { createLastPurchaseCosts } = load('masterQuotationLastPurchase.js');
const { createMasterQuotationActions } = load('masterQuotationAccess.js');
const { createMasterQuotationService } = load('masterQuotationService.js');
const barcode = '9550000000000';

function database() {
  const lists = {}, queries = [];
  const wixData = {
    query(collection) {
      queries.push(collection);
      const conditions = [];
      return {
        eq(field, value) { conditions.push(row => row[field] === value); return this; },
        ne(field, value) { conditions.push(row => row[field] !== value); return this; },
        hasSome(field, values) { conditions.push(row => values.includes(row[field])); return this; },
        limit() { return this; },
        async find() { return { items: (lists[collection] || []).filter(row => conditions.every(condition => condition(row))), hasNext: () => false }; }
      };
    }
  };
  return { lists, queries, wixData };
}

function addPurchase(fixture, { id, day, cents, ea = 12, customerId = 'A', company = 'NCT', omitAssignment = false }) {
  const suffix = company === 'GHR' ? '1' : '', taskId = 'T-' + id, lineId = 'L-' + id, po = 'PO-' + id;
  for (const name of ['NCTOrders', 'NCTTasks', 'NCTActivity']) fixture.lists[name + suffix] ??= [];
  fixture.lists['NCTOrders' + suffix].push({ title: id, sourceLineId: lineId, submissionId: 'S-' + id, customerId, description: barcode, orderId: ea });
  fixture.lists['NCTTasks' + suffix].push({ _id: taskId, title: taskId, description: id, imageAltText: lineId, ourPoNumber: po, supplierId: 'SUP' });
  const event = (order, action, at, details) => ({ title: order, action, result: 'SAVED', description: id,
    image: lineId, imageAltText: taskId, activityTime: `2026-11-${day}T${at}:00:00Z`, details });
  const plan = (beforeRevision, amountCents, patch = {}) => ({ beforeRevision, totalCtn: 105, supplierId: 'SUP',
    costing: { schema: 1, totalCtn: 105, amountCents, ea }, ...patch });
  const events = fixture.lists['NCTActivity' + suffix];
  events.push(event(id + '-plan', 'PURCHASE_PLAN_SAVED', '08', plan('', cents, { draftPlan: true })));
  if (!omitAssignment) events.push(event(id + '-po', 'PURCHASE_PO_ASSIGNED', '09', { after: po }));
  events.push(event(id + '-later', 'PURCHASE_PLAN_SAVED', '10', plan(id + '-plan', cents + 100, { poNumber: po, supplierConfirmed: false })));
}

test('historical NC is the latest documented P.O. cost for the same customer, company and packing', async () => {
  const f = database();
  addPurchase(f, { id: 'old', day: '18', cents: 100000 });
  addPurchase(f, { id: 'latest', day: '19', cents: 210000 });
  addPurchase(f, { id: 'unassigned', day: '20', cents: 420000, omitAssignment: true });
  addPurchase(f, { id: 'other-pack', day: '21', cents: 420000, ea: 24 });
  addPurchase(f, { id: 'other-customer', day: '22', cents: 420000, customerId: 'B' });
  addPurchase(f, { id: 'other-company', day: '23', cents: 420000, company: 'GHR' });
  const read = createLastPurchaseCosts(f.wixData);
  const items = await read({ record: { role: 'STAFF', staffAccess: { companyIds: ['NCT'] } }, customerId: 'A', products: [{ barcode, ea: 12 }] });
  assert.deepEqual(JSON.parse(JSON.stringify(items)), [{ barcode, ea: 12, netCostMyrCtn: 20, purchasedAt: '2026-11-19T09:00:00.000Z' }]);
  assert.deepEqual(f.queries, ['NCTOrders', 'NCTTasks', 'NCTActivity']);
  const [admin] = await read({ record: { role: 'SUPER ADMIN' }, customerId: 'A', products: [{ barcode, ea: 12 }] });
  assert.equal(admin.netCostMyrCtn, 40);
  assert.deepEqual(Array.from(await read({ record: { role: 'STAFF' }, customerId: 'A', products: [{ barcode, ea: 12 }] })), []);
});

test('staff selection totals and NC reads are ownership scoped while rows and FX are requested together', async () => {
  const customers = ['A', 'B'].map(customerId => ({ customerId, name: customerId, preferredCurrency: 'USD',
    assignedStaffId: customerId, quotationMode: 'WEB', webQuotationStatus: 'READY', accessStatus: 'ACTIVE' }));
  let staff = { title: 'A', staffName: 'Example', role: 'STAFF', staffStatus: 'ACTIVE', staffAccess: { quotationAccess: 'EDIT' } };
  let finishRows, finishFx;
  const started = [];
  const run = createMasterQuotationActions({
    readIdentity: async () => ({ record: staff }),
    readCustomers: async () => customers,
    readCustomer: async id => customers.find(customer => customer.customerId === id),
    readSelectionCounts: async ids => {
      assert.deepEqual(Array.from(ids), ['A']);
      return [{ customerId: 'A', selectionCount: 5 }, { customerId: 'B', selectionCount: 7 }];
    },
    readPurchaseHistory: async ({ record, customerId }) => {
      assert.equal(record.title, 'A'); assert.equal(customerId, 'A'); return [];
    },
    readRate() { started.push('fx'); return new Promise(resolve => { finishFx = resolve; }); },
    quotation: { list() { started.push('rows'); return new Promise(resolve => { finishRows = resolve; }); } }
  });
  const quotes = run('quotes', 'A');
  await new Promise(setImmediate);
  assert.deepEqual(started, ['rows', 'fx']);
  finishRows([{ id: 'row' }]); finishFx(4);
  assert.equal((await quotes).customer.rateToMyr, 4);
  assert.deepEqual(Array.from((await run('selection-counts', '', { ids: ['B'] })).counts, item => item.customerId), ['A']);
  assert.equal((await run('purchase-history', 'B')).accessDenied, true);
  assert.equal((await run('purchase-history', 'A')).customerId, 'A');
  staff = { ...staff, staffStatus: 'DISABLED' };
  assert.equal((await run('purchase-history', 'A')).accessDenied, true);
  assert.equal((await run('selection-counts', '')).accessDenied, true);
});

test('the quotation grid uses the signed combined read once and enforces customer ownership before enrichment', async () => {
  const customer = { customerId: 'A', name: 'A', preferredCurrency: 'USD', assignedStaffId: 'A', quotationMode: 'WEB', webQuotationStatus: 'READY', accessStatus: 'ACTIVE' };
  const selections = [{ id: 'SELECTION-1', customerId: 'A' }];
  const calls = [];
  let oldTransport = false;
  const run = createMasterQuotationActions({
    readIdentity: async () => ({ record: { title: 'A', role: 'STAFF', staffStatus: 'ACTIVE', staffAccess: { quotationAccess: 'EDIT' } } }),
    readQuoteContext: async id => {
      calls.push('context ' + id);
      if (id !== customer.customerId) return { customer: { ...customer, customerId: id, assignedStaffId: 'B' }, selections: [] };
      return oldTransport ? { selections } : { customer, selections };
    },
    readCustomer: async id => { calls.push('customer ' + id); return customer; },
    readRate: async () => { calls.push('fx'); return 4; },
    quotation: { list(scope, rows) { assert.equal(scope.customer, customer); assert.equal(rows, selections); calls.push('enrich'); return rows; } }
  });
  assert.equal((await run('quotes', 'A')).rows.length, 1);
  assert.deepEqual(calls.splice(0), ['context A', 'enrich', 'fx']);
  assert.equal((await run('quotes', 'B')).accessDenied, true);
  assert.deepEqual(calls.splice(0), ['context B']);
  oldTransport = true;
  assert.equal((await run('quotes', 'A')).rows.length, 1);
  assert.deepEqual(calls, ['context A', 'customer A', 'enrich', 'fx']);
});

test('the authorized grid returns before Point Base, and its separate cost read cannot access other customers', async () => {
  const customer = { customerId: 'A', preferredCurrency: 'USD', assignedStaffId: 'A',
    quotationMode: 'WEB', webQuotationStatus: 'READY', accessStatus: 'ACTIVE' };
  const rows = [{ id: 'SELECTION-1', customerId: 'A', barcode, selectionEpoch: 'restored' }];
  let releaseCosts;
  const source = new Promise(resolve => { releaseCosts = resolve; });
  let costCalls = 0;
  const quotation = createMasterQuotationService({
    revisions: { latestFor: async () => new Map() },
    readCurrentCosts: async ids => {
      assert.deepEqual(Array.from(ids), [barcode]);
      costCalls++;
      return source;
    }
  });
  const run = createMasterQuotationActions({
    readIdentity: async () => ({ record: { title: 'A', role: 'STAFF', staffStatus: 'ACTIVE',
      staffAccess: { quotationAccess: 'EDIT' } } }),
    readQuoteContext: async id => ({ customer: { ...customer, customerId: id, assignedStaffId: id }, selections: rows }),
    readRate: async () => 4,
    quotation
  });
  let costsSettled = false;
  const costs = run('quote-current-costs', 'A').then(result => { costsSettled = true; return result; });
  const early = await run('quotes', 'A', { deferCosts: true });
  assert.equal(early.costsDeferred, true);
  assert.equal(early.rows[0].id, rows[0].id);
  assert.equal(early.customer.rateToMyr, 4);
  assert.equal(costCalls, 1);
  assert.equal(costsSettled, false);
  assert.equal((await run('quote-current-costs', 'B')).accessDenied, true);
  assert.equal(costCalls, 1);
  releaseCosts({});
  const costResult = await costs;
  assert.equal(costResult.customerId, 'A');
  assert.equal(costResult.rows[0].selectionEpoch, 'restored');
  assert.match(costResult.rows[0].costError, /Point Base cost unavailable/);
  assert.equal((await run('quotes', 'A')).costsDeferred, undefined);
  assert.equal(costCalls, 2);
});
