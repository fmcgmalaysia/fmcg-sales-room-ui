// UNSAFE-INTERLEAVING WITNESS, NOT a production-safety pass. Uses the exact
// candidate web/root and ORIGINAL reference writer; no live changes or data.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const load = require('./load-master-module.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const folder = path.join(__dirname, '../prototypes/stock-current-state');
const source = name => fs.readFileSync(path.join(folder, name), 'utf8')
 .replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '');
function fixture(initialMode) {
 const company = 'NCT', taskId = 'a'.repeat(32), requestId = 'b'.repeat(8) + '-bbbb-bbbb-bbbb-' + 'b'.repeat(12);
 const staff = { staffId: 'PURCHASER', staffName: 'Synthetic Purchase', memberId: 'MEMBER' };
 const control = { _id: hash(company, 'STOCK_CONTROL'), company, schemaVersion: 1,
  stockCommitVersion: 'CONTROL-0', generation: 0, pending: null, mode: initialMode };
 const task = { _id: taskId, title: taskId, description: 'ORDER', imageAltText: 'LINE',
  lpPc: null, lpCtn: null, originalCostSnapshot: {}, receivedQtyInCtn: 10 };
 const order = { _id: 'ORDER-LINE', title: 'ORDER', sourceLineId: 'LINE', submissionId: 'SUBMISSION', description: '9550001', cbmCtn: 0.1 };
 const receipt = { _id: 'RECEIPT', description: 'ORDER', action: 'ORDER_RECEIVED', result: 'ACCEPTED',
  details: { submissionId: 'SUBMISSION', taskIds: [taskId] } };
 const db = new Map([['NCTTasks:' + taskId, structuredClone(task)], ['NCTOrders:' + order._id, order], ['NCTActivity:RECEIPT', receipt]]);
 const writes = []; let releaseRead, capturedRead, controlReads = 0;
 const held = new Promise(resolve => { releaseRead = resolve; }), readCaptured = new Promise(resolve => { capturedRead = resolve; });
 const currentFactory = vm.runInNewContext(source('stockCurrentCostReference.js') + ';createCurrentCostReference;', {
  getPurchaseStaffContext: async () => staff, operationId: hash,
  fulfilmentStore: { read: async (collection, id) => {
   assert.equal(collection, 'NCTActivity'); assert.equal(id, control._id); controlReads++;
   const captured = structuredClone(control); capturedRead(); await held; return captured;
  } }
 });
 const wixData = {
  query(collection) {
   const filters = []; let limit;
   const q = { eq: (key, value) => { filters.push([key, value]); return q; }, limit: n => { limit = n; return q; },
    find: async options => {
     assert.equal(options.consistentRead, true); assert.equal(options.suppressAuth, true);
     return { items: [...db].filter(([key, row]) => key.startsWith(collection + ':') && filters.every(([field, value]) => row[field] === value))
      .slice(0, limit).map(([, row]) => structuredClone(row)) };
    } }; return q;
  },
  async insert(collection, row) {
   const key = collection + ':' + row._id; if (db.has(key)) throw Error('Duplicate');
   writes.push(['INSERT', collection, row._id, control.mode]); db.set(key, structuredClone(row)); return structuredClone(row);
  },
  async update(collection, row) {
   writes.push(['UPDATE', collection, row._id, control.mode]); db.set(collection + ':' + row._id, structuredClone(row)); return structuredClone(row);
  },
  async remove(collection, id) {
   writes.push(['REMOVE', collection, id, control.mode]); db.delete(collection + ':' + id);
  }
 };
 const api = vm.runInNewContext(source('purchaseCostRetry.web.candidate.js') + ';retryPurchaseTaskCost;', {
  webMethod: (_, fn) => fn, Permissions: { SiteMember: 'SITE' }, wixData,
  getPurchaseStaffContext: async () => staff, createCurrentCostReference: currentFactory,
  createPurchaseCostRetry: load('purchaseCostRetry.js').createPurchaseCostRetry,
  capturePointbaseCosts: async () => ({ [order.description]: { unitBarcode: order.description, costCurrency: 'MYR', costStatus: 'CAPTURED',
   costIssues: [], capturedAt: '2026-10-23T00:00:00.000Z', lpPc: 1, lpCtn: 24 } })
 });
 return { db, control, writes, task, taskId, requestId, readCaptured, releaseRead, controlReads: () => controlReads,
  send: () => api(company, taskId, requestId) };
}

test('UNSAFE witness: legacy admission captured before MAINTENANCE can still enter the original writer after mode changes', async () => {
 const f = fixture('LEGACY'), pending = f.send(); await f.readCaptured;
 assert.equal(f.writes.length, 0); assert.equal([...f.db.values()].some(row => row.action === 'COST_RETRY_LOCK'), false);
 f.control.mode = 'MAINTENANCE'; f.control.stockCommitVersion = 'CONTROL-MAINTENANCE';
 // A capture made at this instant sees NO cost lock and the original task.
 const captured = structuredClone(f.db.get('NCTTasks:' + f.taskId)); f.releaseRead();
 const result = await pending;
 assert.equal(result.ok, true); assert.equal(f.controlReads(), 1);
 assert.equal(f.writes.some(([kind, collection]) => kind === 'UPDATE' && collection === 'NCTTasks'), true);
 assert.equal(f.writes.every(([, , , mode]) => mode === 'MAINTENANCE'), true);
 assert.notDeepEqual(f.db.get('NCTTasks:' + f.taskId), captured);
 // This passing assertion PROVES an unsafe race exists, not permission to switch
 // ACTIVE or a regression of deployed production (candidate is not installed).
});

test('a new request which actually observes MAINTENANCE refuses the original writer without any mutation', async () => {
 const f = fixture('MAINTENANCE'), pending = f.send(); await f.readCaptured; f.releaseRead();
 await assert.rejects(pending, /unconfirmed/); assert.deepEqual(f.writes, []);
 assert.deepEqual(f.db.get('NCTTasks:' + f.taskId), f.task);
});
