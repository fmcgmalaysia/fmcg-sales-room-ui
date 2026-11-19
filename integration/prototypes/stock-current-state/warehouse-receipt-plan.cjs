'use strict';

const { stockKey } = require('./current-model.cjs');
const { prepareBorrowingReceipt } = require('./borrowing-stock-plan.cjs');
const { utf8Bytes } = require('./segmented-plan.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
// One original PO receipt, potentially several products, ONE fenced commit.
// Product snapshots must be assembled together inside the same read barrier.
function prepareWarehouseReceipt({ validated, products, generation, planFormat = 'PROOF_V1' }) {
  if (!['PROOF_V1', 'SEGMENTED_V2'].includes(planFormat)) throw Error('Server receipt plan format required');
  const event = validated?.event;
  if (!validated?.expectedVersion || !event || event.action !== 'WAREHOUSE_RECEIPT_SAVED'
    || !Array.isArray(event.details?.lines) || !event.details.lines.length || !Array.isArray(products) || !products.length
    || !Number.isSafeInteger(generation) || generation < 0) throw Error('Validated PO receipt and complete product snapshots required');
  const keys = new Set(), consumed = new Set(), writes = [], states = [];
  for (const { state, rows } of products) {
    if (state?.company !== event.details.company) throw Error('Receipt product company conflict');
    const key = stockKey(state);
    if (keys.has(key)) throw Error('Duplicate receipt product snapshot');
    keys.add(key);
    const lines = event.details.lines.filter(line => state.sources.some(s => s.id === line.taskId));
    if (!lines.length) throw Error('Unrelated receipt product snapshot');
    for (const line of lines) {
      if (consumed.has(line.taskId)) throw Error('Ambiguous receipt product source');
      consumed.add(line.taskId);
    }
    const scoped = { ...copy(event), details: { ...copy(event.details), lines: copy(lines) } };
    const result = prepareBorrowingReceipt({ state, rows, event: scoped, generation });
    states.push(result.state);
    // Keep the ORIGINAL full event once, never save per-product partial receipts.
    for (const write of result.plan.writes) {
      if (write.after.action === 'WAREHOUSE_RECEIPT_SAVED') continue;
      writes.push(write);
    }
  }
  if (new Set(event.details.lines.map(l => l.taskId)).size !== event.details.lines.length
    || consumed.size !== event.details.lines.length) throw Error('Incomplete receipt product coverage');
  writes.unshift({ collection: event.details.company === 'NCT' ? 'NCTActivity' : 'NCTActivity1',
    before: null, after: { ...copy(event), company: event.details.company } });
  if (new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length) throw Error('Combined receipt write identity conflict');
  // Only a server-composed v2 protocol requests the segmented envelope. Individual
  // product preparation is still subject to its current working-set guards.
  if (planFormat === 'PROOF_V1' && (writes.length > 30 || utf8Bytes(JSON.stringify({ writes })) > 180000)) throw Error('Combined receipt exceeds atomic proof bound');
  if (planFormat === 'SEGMENTED_V2' && (writes.length > 10000 || utf8Bytes(JSON.stringify({ writes })) > 8 * 1024 * 1024)) throw Error('Combined receipt exceeds segmented policy');
  return { states, expectedVersion: validated.expectedVersion, plan: { writes } };
}
module.exports = { prepareWarehouseReceipt };
