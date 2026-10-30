const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../backend/catalogueSelection.web.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export const /gm, 'const ');
const clone = value => JSON.parse(JSON.stringify(value));
const CUSTOMER = 'CUS-261030-ABCDEF';
const ID = 'ml_12345678_abcdef12';

function fixture() {
  const collections = new Map();
  const rows = name => { if (!collections.has(name)) collections.set(name, []); return collections.get(name); };
  const state = { now: Date.parse('2026-10-30T00:00:00Z'), requests: [], qd: new Map(), reply: null, onSend: null, failAfterWrite: false };
  const data = {
    query(name) {
      const predicates = []; let count = 1000;
      const q = {
        eq(k, v) { predicates.push(row => row[k] === v); return q; },
        hasSome(k, values) { predicates.push(row => values.includes(row[k])); return q; },
        limit(n) { count = n; return q; },
        async find() { return { items: clone(rows(name).filter(row => predicates.every(p => p(row))).slice(0, count)), hasNext: () => false }; }
      }; return q;
    },
    async get(name, id) { const row = rows(name).find(row => row._id === id); return row ? clone(row) : null; },
    async update(name, item) { const i = rows(name).findIndex(row => row._id === item._id); if (i < 0) throw Error('Missing record'); rows(name)[i] = clone(item); return clone(item); },
    async insert(name, item) { if (rows(name).some(row => row._id === item._id)) throw Error('Duplicate ID'); rows(name).push(clone(item)); return clone(item); }
  };
  function request(_url, _options, callback) {
    const req = new EventEmitter(); let raw = '';
    req.setTimeout = () => {}; req.write = text => { raw += text; };
    req.end = () => queueMicrotask(() => {
      const payload = JSON.parse(raw); state.requests.push(payload);
      if (state.onSend) state.onSend(payload);
      const exists = state.qd.has(payload.wixMyListId);
      if (!exists && !state.reply) state.qd.set(payload.wixMyListId, state.qd.size + 7);
      if (state.failAfterWrite) { state.failAfterWrite = false; req.emit('error', Error('Response lost after write')); return; }
      const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; res.setEncoding = () => {};
      callback(res);
      const body = state.reply || { ok: true, result: { customerId: payload.customerId, wixMyListId: payload.wixMyListId, qdRow: state.qd.get(payload.wixMyListId), idempotent: exists } };
      res.emit('data', JSON.stringify(body)); res.emit('end');
    }); return req;
  }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [state.now])); } static now() { return state.now; } }
  const api = new Function('webMethod', 'Permissions', 'currentMember', 'wixData', 'getSecret', 'wixRealtimeBackend', 'httpsRequest', 'Date',
    `${source}\nreturn { addCatalogueSelection, getCatalogueSelectionState, processSalesRoomSelectionQueue, routeSalesRoomCustomerSelections, retryCatalogueSelections };`)(
    (_p, fn) => fn, { SiteMember: 'member' }, { getMember: async () => ({ _id: 'staff-member', loginEmail: 'test@example.invalid' }) }, data,
    async () => 'mock-secret', { publish: async () => {} }, request, Clock);
  rows('StaffMaster').push({ _id: 'staff', wixMemberId: 'staff-member', staffEmail: 'test@example.invalid', staffId: 'S1', role: 'SALES', title: 'Sales', status: 'ACTIVE' });
  rows('WixCustomers').push({ _id: 'customer', customerId: CUSTOMER, title: 'Synthetic buyer', assignedStaffId: 'S1', qdStatus: 'READY', qdFileId: 'synthetic-qd-file-123456789' });
  rows('FMCGMALAYSIA').push({ _id: 'product', barcode: '1234567890123', name: 'Synthetic product', pointBaseStatus: 'ACTIVE' });
  function add(id = ID, patch = {}) {
    const payload = { customerId: CUSTOMER, productId: 'product', unitBarcode: '1234567890123', quoteStatus: 'RFQ', qdSyncStatus: 'PENDING', removed: false, ...patch };
    rows('WixBuyerListItems').push({ _id: id, title: `${payload.customerId}|${payload.unitBarcode}`, customerId: payload.customerId, removed: Boolean(payload.removed), qdSyncStatus: payload.qdSyncStatus, payload: JSON.stringify(payload) }); return id;
  }
  const record = (id = ID) => rows('WixBuyerListItems').find(row => row._id === id);
  const payload = (id = ID) => JSON.parse(record(id).payload);
  return { state, rows, api, add, record, payload };
}

test('Selection persists and stays Selected without waiting for a QD request', async () => {
  const f = fixture(); const result = await f.api.addCatalogueSelection('product', CUSTOMER);
  assert.equal(result.queued, true); assert.equal(f.state.requests.length, 0);
  const selected = await f.api.getCatalogueSelectionState(CUSTOMER);
  assert.deepEqual(selected.selectedProductIds, ['product']); assert.equal(selected.total, 1);
});

test('Invalid source data remains unchanged and does not block a later normal selection', async () => {
  const f = fixture(); f.rows('FMCGMALAYSIA')[0].barcode = '123456 / 987654';
  f.add(ID, { unitBarcode: '123456 / 987654', qdSyncStatus: 'FAILED', lastError: 'Invalid Unit Barcode.' }); f.add('ml_12345678_abcdef13');
  const before = clone(f.rows('FMCGMALAYSIA'));
  const result = await f.api.processSalesRoomSelectionQueue();
  assert.equal(result.processed, 2); assert.equal(f.payload().qdSyncStatus, 'FAILED');
  assert.equal(f.payload('ml_12345678_abcdef13').qdSyncStatus, 'READY');
  assert.deepEqual(f.rows('FMCGMALAYSIA'), before); assert.equal(f.rows('WixBuyerListItems').length, 2);
});

test('After the owner corrects the exact referenced product, automatic retry retains the same selection ID', async () => {
  const f = fixture(); f.add(ID, { unitBarcode: '123456 / 987654', qdSyncStatus: 'FAILED', lastError: 'Invalid Unit Barcode.', selectedAt: 'original-time' });
  await f.api.retryCatalogueSelections();
  assert.equal(f.payload().qdSyncStatus, 'READY'); assert.equal(f.payload().selectedAt, 'original-time');
  assert.equal(f.state.requests[0].unitBarcode, '1234567890123'); assert.equal(f.state.requests[0].wixMyListId, ID);
  assert.equal(f.rows('WixBuyerListItems').length, 1); assert.equal(f.record().title, `${CUSTOMER}|1234567890123`);
  const repeated = await f.api.addCatalogueSelection('product', CUSTOMER);
  assert.equal(repeated.duplicate, true); assert.equal(repeated.selection.id, ID); assert.equal(f.rows('WixBuyerListItems').length, 1);
});

test('Response lost after a successful QD write retries the original request identity and adds no second row', async () => {
  const f = fixture(); f.add(); f.state.failAfterWrite = true;
  await f.api.retryCatalogueSelections(); assert.equal(f.payload().qdSyncStatus, 'FAILED'); assert.equal(f.state.qd.size, 1);
  f.state.now += 31000; await f.api.retryCatalogueSelections();
  assert.equal(f.payload().qdSyncStatus, 'READY'); assert.equal(f.state.qd.size, 1);
  assert.deepEqual(f.state.requests.map(p => p.wixMyListId), [ID, ID]);
});

for (const result of [{}, { customerId: CUSTOMER, wixMyListId: ID, qdRow: 0 }, { customerId: 'another-customer', wixMyListId: ID, qdRow: 7 }, { customerId: CUSTOMER, wixMyListId: 'another-id', qdRow: 7 }]) {
  test(`Incomplete or mismatched receipt does not produce a false READY: ${JSON.stringify(result)}`, async () => {
    const f = fixture(); f.add(); f.state.reply = { ok: true, result }; await f.api.retryCatalogueSelections();
    assert.equal(f.payload().qdSyncStatus, 'FAILED'); assert.match(f.payload().lastError, /did not confirm/);
  });
}

test('Automatic retry respects backoff; staff route-now can explicitly retry the same selection', async () => {
  const f = fixture(); f.add(ID, { qdSyncStatus: 'FAILED', qdNextRetryAt: new Date(f.state.now + 60000).toISOString() });
  assert.equal((await f.api.retryCatalogueSelections()).processed, 0);
  assert.equal((await f.api.routeSalesRoomCustomerSelections(CUSTOMER)).ready, 1);
});

test('Fresh routing lease is skipped and an expired lease recovers', async () => {
  const f = fixture(); f.add(ID, { qdSyncStatus: 'ROUTING', qdLastAttemptAt: new Date(f.state.now).toISOString() });
  assert.equal((await f.api.retryCatalogueSelections()).processed, 0); f.state.now += 61000;
  await f.api.retryCatalogueSelections(); assert.equal(f.payload().qdSyncStatus, 'READY');
});

test('Removed selections and suspended customers are not restored or routed by the scheduled job', async () => {
  const f = fixture(); f.add(ID, { removed: true }); f.add('ml_12345678_abcdef13');
  f.rows('WixCustomers')[0].catalogueAccessStatus = 'SUSPENDED';
  assert.equal((await f.api.retryCatalogueSelections()).processed, 0); assert.equal(f.state.requests.length, 0); assert.equal(f.record().removed, true);
});

test('Another salesperson cannot use the customer-specific retry control', async () => {
  const f = fixture(); f.add(); f.rows('WixCustomers')[0].assignedStaffId = 'S2';
  await assert.rejects(f.api.routeSalesRoomCustomerSelections(CUSTOMER), /not assigned/);
  assert.equal((await f.api.processSalesRoomSelectionQueue()).processed, 0);
});

test('A repeatedly bad first batch does not starve a new normal selection', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) f.add(`bad-${i}`, { unitBarcode: 'bad', qdSyncStatus: 'FAILED', qdLastAttemptAt: new Date(f.state.now - 120000).toISOString() });
  f.add(); await f.api.processSalesRoomSelectionQueue(); assert.equal(f.payload().qdSyncStatus, 'READY');
});

test('Published quote fields that arrive during routing are retained', async () => {
  const f = fixture(); f.add(); f.state.onSend = () => {
    f.record().payload = JSON.stringify({ ...f.payload(), quoteStatus: 'VIEW QUOTE', quotePerCtn: 42, quotePerPc: 7, quoteActive: true });
  };
  await f.api.retryCatalogueSelections();
  assert.equal(f.payload().quoteStatus, 'VIEW QUOTE'); assert.equal(f.payload().quotePerCtn, 42); assert.equal(f.payload().quoteActive, true);
});

test('Removal during a QD response does not revive the selection', async () => {
  const f = fixture(); f.add(); f.state.onSend = () => { f.record().removed = true; f.record().payload = JSON.stringify({ ...f.payload(), removed: true }); };
  await f.api.retryCatalogueSelections(); assert.equal(f.record().removed, true); assert.equal(f.payload().removed, true);
});

test('Corrected barcode collision stops safely without merging selections or editing the product', async () => {
  const f = fixture(); f.add(ID, { unitBarcode: '123456 / 987654', qdSyncStatus: 'FAILED', lastError: 'Invalid Unit Barcode.' }); f.add('ml_12345678_abcdef13', { qdSyncStatus: 'READY' });
  const product = clone(f.rows('FMCGMALAYSIA')); await f.api.retryCatalogueSelections();
  assert.equal(f.payload().qdSyncStatus, 'FAILED'); assert.match(f.payload().lastError, /another selection/); assert.equal(f.state.requests.length, 0);
  assert.deepEqual(f.rows('FMCGMALAYSIA'), product); assert.equal(f.rows('WixBuyerListItems').length, 2);
});

test('A corrected source does not require the customer to create a new selection before retry', async () => {
  const f = fixture(); f.add(ID, { unitBarcode: '123456 / 987654', qdSyncStatus: 'FAILED', lastError: 'Invalid Unit Barcode.' });
  const result = await f.api.addCatalogueSelection('product', CUSTOMER);
  assert.equal(result.selection.id, ID); assert.equal(f.rows('WixBuyerListItems').length, 1);
});

test('Scheduled retry is internal and configuration calls the same queue implementation', () => {
  assert.match(source, /const retryCatalogueSelections = async/);
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/jobs.config'), 'utf8'));
  assert.deepEqual(config.jobs.map(job => [job.functionLocation, job.functionName]), [['/catalogueSelection.web.js', 'retryCatalogueSelections']]);
});

test('Sales background retry is idle with no work, coalesces overlapping requests, and stops after completion', async () => {
  const page = fs.readFileSync(path.join(__dirname, '../sales-room/wix/sales-room-page.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
  let handler, interval, resolveQueue, hasWork = false, calls = 0;
  const html = { postMessage() {}, onMessage(fn) { handler = fn; } };
  const $w = () => html; $w.onReady = fn => fn();
  vm.runInNewContext(page, {
    $w, console,
    setInterval(fn, ms) { assert.equal(ms, 60000); interval = fn; },
    getCurrentStaffContext: async () => ({ authorized: true }),
    getSalesRoomCustomersOperational: async () => ({ customers: [{ customerId: CUSTOMER }] }),
    getSalesRoomQuoteSignals: async () => ({ byCustomer: { [CUSTOMER]: { failedRouteItemCount: hasWork ? 1 : 0 } } }),
    processSalesRoomSelectionQueue: async () => { calls++; return new Promise(resolve => { resolveQueue = resolve; }); },
    wixRealtimeFrontend: { subscribe: async () => {} }, wixLocationFrontend: { to() { throw Error('Unexpected navigation'); } }
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  interval(); await flush(); assert.equal(calls, 0);
  hasWork = true; await handler({ data: { type: 'SALES_ROOM_CUSTOMERS_REQUEST' } }); await flush(); assert.equal(calls, 1);
  interval(); interval(); await flush(); assert.equal(calls, 1);
  hasWork = false; resolveQueue({ processed: 1 }); await flush();
  interval(); await flush(); assert.equal(calls, 1);
});
