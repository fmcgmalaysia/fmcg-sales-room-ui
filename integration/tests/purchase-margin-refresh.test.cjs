const test = require('node:test'), assert = require('node:assert/strict');
const { createPurchaseMarginRefresh } = require('./load-master-module.cjs')('purchaseMarginRefresh.js');
const { operationId } = require('./load-master-module.cjs')('purchaseOperationJournal.js');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const names = { orders: 'NCTOrders', tasks: 'NCTTasks', activity: 'NCTActivity' }, rows = new Map();
  const order = { _id: 'O', title: 'ORDER', sourceLineId: 'LINE', transactionCurrency: 'SGD', sellingPricePc: 10, orderId: 10,
    salesInvoiceNumber: '', gp: .1, adminFxSource: 3, orderQtyInCtn: 100, customerId: 'C' };
  const task = { _id: 'T', title: 'T', description: 'ORDER', imageAltText: 'LINE', purchaseQtyInCtn: 90,
    lpCtn: 240, lpPc: 24, disc1: 0, disc2: 0, disc3: 0 };
  rows.set(names.orders + '/O', clone(order)); rows.set(names.tasks + '/T', clone(task));
  const store = { read: async (c, id) => clone(rows.get(c + '/' + id) || null),
    insert: async (c, row) => { if (rows.has(c + '/' + row._id)) throw Error('Duplicate'); rows.set(c + '/' + row._id, clone(row)); },
    update: async (c, row) => rows.set(c + '/' + row._id, clone(row)), remove: async (c, id) => rows.delete(c + '/' + id) };
  let rate = 3.2;
  const input = () => ({ company: 'NCT', names, orders: [clone(rows.get(names.orders + '/O'))], tasks: [clone(rows.get(names.tasks + '/T'))],
    workspace: { tasks: [{ id: 'T', orderId: 'ORDER', sourceLineId: 'LINE' }] } });
  const refresh = createPurchaseMarginRefresh({ store, readRates: async () => [{ currency: 'SGD', rateToMyr: rate, updatedAt: '2026-10-10T14:00:00Z' }] });
  return { names, rows, store, refresh, input, setRate: value => { rate = value; }, events: () => [...rows.values()].filter(row => row.action === 'GP_RECALCULATED') };
}
test('open GP uses latest Admin FX, persists only margin/FX cache, audits recalculation and skips unchanged reads', async () => {
  const f = fixture(), originalTask = clone(f.rows.get('NCTTasks/T'));
  assert.equal((await f.refresh(f.input())).get('T'), .25);
  assert.equal(f.rows.get('NCTOrders/O').gp, .25); assert.equal(f.rows.get('NCTOrders/O').adminFxSource, 3.2);
  assert.deepEqual(f.rows.get('NCTTasks/T'), originalTask); assert.equal(f.rows.get('NCTOrders/O').orderQtyInCtn, 100);
  assert.equal(f.rows.get('NCTOrders/O').sellingPricePc, 10); assert.equal(f.events().length, 1);
  await f.refresh(f.input()); assert.equal(f.events().length, 1);
  f.setRate(4); assert.equal((await f.refresh(f.input())).get('T'), .4); assert.equal(f.events().length, 2);
  assert.equal(f.events()[1].actorType, 'SYSTEM'); assert(!isNaN(Date.parse(f.events()[1].activityTime)));
});
test('missing current rate/cost never exposes the previous cached margin or substitutes zero', async () => {
  const f = fixture(); f.setRate(null); assert.equal((await f.refresh(f.input())).get('T'), null); assert.equal(f.events().length, 0);
  f.setRate(3.2); f.rows.get('NCTTasks/T').disc3 = null;
  assert.equal((await f.refresh(f.input())).get('T'), null); assert.equal(f.rows.get('NCTOrders/O').gp, .1);
  const refresh = createPurchaseMarginRefresh({ store: f.store, readRates: async () => { throw Error('Offline'); } });
  assert.equal((await refresh(f.input())).get('T'), null);
});
test('saved invoice snapshot is read-only, bare invoice without financial lock fails closed', async () => {
  const f = fixture(), order = f.rows.get('NCTOrders/O'); order.salesInvoiceNumber = 'INV-001';
  assert.equal((await f.refresh(f.input())).get('T'), null);
  order.financialLockedBy = 'STAFF'; order.gp = .375; f.setRate(5);
  assert.equal((await f.refresh(f.input())).get('T'), .375); assert.equal(order.adminFxSource, 3); assert.equal(f.events().length, 0);
});
test('concurrent cost save, invoice or quote changes cannot be overwritten by margin refresh', async () => {
  for (const mutation of [row => { row.salesInvoiceNumber = 'INV'; }, row => { row.sellingPricePc = 12; }]) {
    const f = fixture(), input = f.input(); mutation(f.rows.get('NCTOrders/O'));
    assert.equal((await f.refresh(input)).get('T'), null); assert.equal(f.events().length, 0);
  }
  const f = fixture(), input = f.input(); f.rows.get('NCTTasks/T').lpCtn = 260;
  assert.equal((await f.refresh(input)).get('T'), null); assert.equal(f.events().length, 0);
  const g = fixture(), lockId = operationId('NCT', 'T', 'COST_LOCK');
  g.rows.set('NCTActivity/' + lockId, { _id: lockId, details: { requestId: 'OTHER' } });
  assert.equal((await g.refresh(g.input())).get('T'), null); assert.equal(g.events().length, 0);
  assert.equal(g.rows.get('NCTActivity/' + lockId).details.requestId, 'OTHER');
});
test('lost cache write leaves no held task lock and the next refresh repairs GP without editing quantity', async () => {
  const f = fixture(), update = f.store.update; let fail = true;
  f.store.update = async (...args) => { if (fail) { fail = false; throw Error('Lost write'); } return update(...args); };
  assert.equal((await f.refresh(f.input())).get('T'), null);
  assert.equal(f.rows.has('NCTActivity/' + operationId('NCT', 'T', 'GP_LOCK')), false);
  assert.equal((await f.refresh(f.input())).get('T'), .25); assert.equal(f.rows.get('NCTTasks/T').purchaseQtyInCtn, 90);
});
test('failed GP lock cleanup cannot take the procurement save lock or fail the whole workspace', async () => {
  const f = fixture(); f.store.remove = async () => { throw Error('Cleanup unavailable'); };
  assert.equal((await f.refresh(f.input())).get('T'), null);
  assert.equal(f.rows.has('NCTActivity/' + operationId('NCT', 'T', 'COST_LOCK')), false);
  assert.equal(f.rows.has('NCTActivity/' + operationId('NCT', 'T', 'GP_LOCK')), true);
});
