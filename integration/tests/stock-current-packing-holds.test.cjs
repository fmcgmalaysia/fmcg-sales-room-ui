const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createPackingHoldSnapshot } = require('../prototypes/stock-current-state/packing-hold-snapshot.cjs');
const { readPackingLists, PACKING_CURRENT } = load('packingListOperations.js');
const { packingHeld } = load('packingListModel.js');
const { operationId } = load('purchaseOperationJournal.js');
const snapshot = createPackingHoldSnapshot({ readPackingLists, packingHeld });
function record(id, status, quantity, loaded = 0, pending) {
  const list = { id, revision: id + '-V1', company: 'NCT', customerId: 'B', currency: 'USD', status,
    lines: [{ taskId: 'B', quantity, packed: loaded, loaded }] };
  if (pending) list.change = { lines: [{ taskId: 'B', quantity: pending }] };
  return { _id: operationId('NCT', id, 'PACKING_CURRENT'), description: id, action: PACKING_CURRENT, details: { list } };
}
test('reuses real packing rules across draft/sent/pending-change/completed/cancelled', () => {
  const activity = [record('D', 'DRAFT', 90), record('S', 'SENT', 20), record('P', 'PROCESSING', 10, 4, 15),
    record('C', 'COMPLETED', 30, 8), record('X', 'CANCELLED', 99)];
  const result = snapshot({ company: 'NCT', activity, taskIds: ['A', 'B'] });
  assert.equal(result.scope, 'TASK_TOTAL'); assert.equal(result.heldByTask.A, 0); assert.equal(result.heldByTask.B, 43);
  assert.equal(Object.hasOwn(result, 'sourceTaskId'), false);
});
test('pending decreases keep old quantity until acknowledgement; changed list revision changes hold version', () => {
  const activity = [record('P', 'PROCESSING', 50, 10, 20)];
  const first = snapshot({ company: 'NCT', activity, taskIds: ['B'] });
  assert.equal(first.heldByTask.B, 50);
  activity[0].details.list.revision = 'NEW';
  assert.notEqual(snapshot({ company: 'NCT', activity, taskIds: ['B'] }).version, first.version);
});
test('malformed current lists and cross-company contexts do not turn into zero holds', () => {
  const activity = [record('S', 'SENT', 20)];
  assert.throws(() => snapshot({ company: 'GHR', activity, taskIds: ['B'] }), /identity/);
  activity[0].details.list.lines[0].loaded = 21;
  assert.throws(() => snapshot({ company: 'NCT', activity, taskIds: ['B'] }), /identity/);
  assert.throws(() => snapshot({ company: 'NCT', activity: [], taskIds: ['B', 'B'] }), /context/);
});
