const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { changePackingList, packingHeld, packingAvailability } = load('packingListModel.js');
const { currentPackingContext } = require('../prototypes/stock-current-state/current-packing-context.cjs');
const { preparePackingStock } = require('../prototypes/stock-current-state/packing-stock-plan.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { validateOriginalPacking } = require('../prototypes/stock-current-state/original-packing-validation.cjs');
const { createPackingListOperations, packingVersion } = load('packingListOperations.js');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture(status = 'DRAFT', loaded = 0) {
  const identity = { company: 'NCT', barcode: '1', packing: '12', ea: 12 }, key = stockKey(identity), positionId = hash('NCT', key, 'PURCHASE_SOURCE', 'S');
  const list = { id: 'L', company: 'NCT', customerId: 'C', currency: 'USD', revision: 'L0', status,
    lines: [{ taskId: 'T', quantity: 50, packed: loaded, loaded, reason: loaded < 50 ? 'Container full' : '' }] };
  const state = { ...identity, complete: true, revision: 0, tasks: [{ ...identity, id: 'T', customerId: 'C', requested: 50, dispatched: 0 }],
    packingHolds: { company: 'NCT', complete: true, scope: 'TASK_TOTAL', version: 'H0', heldByTask: { T: packingHeld(list, 'T') } },
    sources: [{ ...identity, id: 'S', ownerTaskId: 'T', poId: 'P', poValid: true, reviewRequired: false, receiptPolicy: 'OWNER_DEMAND',
      planned: 50, ownerShare: 50, accepted: 50, onHand: 50, available: 0, isolated: 0, claims: { T: 50 } }], relations: [] };
  const base = { company: 'NCT', stockKey: key, revision: 0, _version: 'V0', status: 'ACTIVE', reviewCodes: [] };
  const rows = { complete: true, positions: [{ ...base, _id: positionId, sourceTaskId: 'S', poId: 'P', receiptAccepted: 50,
    replacementReceived: 0, dispatched: 0, onHand: 50, available: 0, isolated: 0, reservedUsable: 50 }],
    claims: [{ ...base, _id: hash('NCT', positionId, 'T'), positionId, taskId: 'T', customerId: 'C', reservedUsable: 50, isolatedAttributed: 0 }],
    product: { ...base, _id: hash('NCT', key), onHand: 50, available: 0, isolated: 0, reservedUsable: 50, reviewRequired: false }, transfers: [] };
  const context = { company: 'NCT', sourceVersion: 'ORIGINAL', tasks: [{ taskId: 'T', company: 'NCT', customerId: 'C', currency: 'USD', remaining: 50, ready: 999,
    review: false, chatContexts: [{ id: 'CHAT' }] }], lists: [list] };
  const currentRecord = { _id: hash('NCT', 'L', 'PACKING_CURRENT'), _version: 'LIST0', company: 'NCT', description: 'L',
    action: 'SUPPORT_PACKING_LIST_CURRENT', result: 'SAVED', details: { list } };
  return { company: 'NCT', generation: 0, products: [{ state, rows }], currentRecord, context, list };
}
function transition(f, action, actor = 'WAREHOUSE', extra = {}) {
  const context = currentPackingContext({ context: f.context, states: f.products.map(p => p.state) });
  const list = changePackingList({ list: f.list, input: { action, revision: f.list.revision, ...extra }, context, actor, id: f.list.id, revision: 'L1', at: '2026-10-22' });
  const record = { ...copy(f.currentRecord), title: 'L', initiatedByStaffId: 'STAFF', activityTime: '2026-10-22', details: { list } }; delete record._version;
  return { ...f, packingHeld, validated: { beforeRevision: 'L0', uploads: [], record } };
}
test('packing ready uses current customer-owned stock, never incoming/free/legacy aggregate; original review remains', () => {
  const f = fixture(), saved = currentPackingContext({ context: f.context, states: [f.products[0].state] });
  assert.equal(saved.tasks[0].ready, 50); assert.equal(f.context.tasks[0].ready, 999);
  assert.deepEqual(saved.tasks[0].chatContexts, [{ id: 'CHAT' }]);
  f.context.tasks[0].review = true;
  assert.equal(currentPackingContext({ context: f.context, states: [f.products[0].state] }).tasks[0].review, true);
  assert.throws(() => currentPackingContext({ context: f.context, states: [] }), /provenance/);
});
test('Support SEND and Warehouse LOADED save list/checkpoint only, no physical or ownership mutation', () => {
  for (const [status, action, actor, extra] of [['DRAFT', 'SEND', 'SUPPORT', {}], ['PROCESSING', 'PROGRESS', 'WAREHOUSE', { lines: [{ taskId: 'T', packed: 50, loaded: 40, reason: 'Container full' }] }]]) {
    const f = fixture(status), result = preparePackingStock(transition(f, action, actor, extra));
    assert.equal(result.plan.writes.length, 2);
    assert.equal(result.plan.writes[0].before._version, 'LIST0');
    assert.equal(result.states[0].sources[0].onHand, 50); assert.equal(result.states[0].sources[0].claims.T, 50);
    assert.equal(result.states[0].packingHolds.heldByTask.T, 50);
  }
});
test('completed40of50 releases packing hold10 but retains customer reservation and physical50', () => {
  const f = fixture('PROCESSING', 40), args = transition(f, 'COMPLETE'), result = preparePackingStock(args);
  assert.equal(result.states[0].packingHolds.heldByTask.T, 40);
  assert.equal(result.states[0].sources[0].onHand, 50); assert.equal(result.states[0].sources[0].available, 0);
  assert.equal(result.states[0].sources[0].claims.T, 50);
  const context = currentPackingContext({ context: { ...f.context, lists: [args.validated.record.details.list] }, states: result.states });
  assert.equal(packingAvailability(context)[0].readyToArrange, 10);
});
test('another list hold, wrong revision, photo uploads and incomplete product coverage cannot bypass save', () => {
  const f = fixture('COMPLETED', 40); f.products[0].state.packingHolds.heldByTask.T = 50;
  const args = transition(f, 'REOPEN', 'WAREHOUSE', { reason: 'Need more' });
  assert.throws(() => preparePackingStock(args), /Packing task coverage/);
  for (const mutate of [a => { a.validated.beforeRevision = 'OLD'; }, a => { a.validated.uploads = [{ fileId: 'F' }]; },
    a => { a.products = []; }, a => { a.products.push(copy(a.products[0])); }]) {
    const a = transition(fixture(), 'SEND', 'SUPPORT'); mutate(a); assert.throws(() => preparePackingStock(a));
  }
});

test('original packing prepare validates current-ready context and produces exact single current record plan', async () => {
  const f = fixture(), before = JSON.stringify(f), context = currentPackingContext({ context: f.context, states: [f.products[0].state] });
  const request = { createPackingListOperations, company: 'NCT', context, requestId: '11111111-1111-4111-8111-111111111111',
    staff: { memberId: 'M', staffId: 'S', staffName: 'LAW', packingDepartment: 'SUPPORT' },
    input: { action: 'SEND', id: 'L', revision: 'L0', version: packingVersion(context) }, now: () => new Date('2026-10-22T10:00:00Z') };
  const validated = await validateOriginalPacking(request);
  const result = preparePackingStock({ ...f, validated, packingHeld });
  assert.equal(result.plan.writes[0].after.details.list.status, 'SENT');
  assert.equal(result.states[0].packingHolds.heldByTask.T, 50);
  assert.equal(JSON.stringify(f), before);
  await assert.rejects(validateOriginalPacking({ ...request, input: { ...request.input, version: 'OLD' } }), /changed/);
  await assert.rejects(validateOriginalPacking({ ...request, staff: { ...request.staff, packingDepartment: 'WAREHOUSE' } }), /other department/);
  await assert.rejects(validateOriginalPacking({ ...request, input: { ...request.input, action: 'PHOTOS' } }), /non-photo/);
});
