'use strict';

const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { preparePackingHoldTransition } = require('./borrowing-stock-plan.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Original prepare and original list parser must run FIRST on current Packing context.
// No photo/file operations here; PHOTOS needs its own preserved external retry protocol.
function preparePackingStock({ company, validated, currentRecord, products, generation, packingHeld }) {
  const record = validated?.record, prior = currentRecord?.details?.list, next = record?.details?.list;
  if (!['NCT', 'GHR'].includes(company) || typeof packingHeld !== 'function' || validated?.uploads?.length || !next?.id || next.company !== company
    || record.action !== 'SUPPORT_PACKING_LIST_CURRENT' || record.result !== 'SAVED'
    || record._id !== hash(company, next.id, 'PACKING_CURRENT') || record.description !== next.id
    || !record.initiatedByStaffId || !Array.isArray(next.lines) || !next.lines.length || !Array.isArray(products) || !products.length
    || (prior?.revision || '') !== validated.beforeRevision
    || currentRecord && (currentRecord.company !== company || !currentRecord._version || currentRecord._id !== record._id)
    || next.invoiceId || next.dispatchedAt) throw Error('Original exact non-invoice packing transition required');
  const lines = new Set([...(prior?.lines || []), ...(prior?.change?.lines || []), ...next.lines, ...(next.change?.lines || [])].map(l => l.taskId));
  const coverage = new Map([...lines].map(id => [id, 0])), keys = new Set(), states = [], writes = [];
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', event = { ...copy(record), company };
  writes.push({ collection: journal, before: copy(currentRecord || null), after: event });
  for (const product of products) {
    const key = stockKey(product.state), covered = [...lines].filter(id => product.state.tasks.some(t => t.id === id));
    if (product.state.company !== company || keys.has(key) || !covered.length) throw Error('Distinct complete packing product coverage required');
    keys.add(key); for (const id of covered) coverage.set(id, coverage.get(id) + 1);
    const packingHolds = copy(product.state.packingHolds);
    packingHolds.version = hash(packingHolds.version, record._id, prior?.revision || '', next.revision);
    for (const task of product.state.tasks) {
      const oldListHeld = prior ? packingHeld(prior, task.id) : 0, newListHeld = packingHeld(next, task.id);
      if (![oldListHeld, newListHeld].every(n => Number.isSafeInteger(n) && n >= 0)
        || packingHolds.heldByTask[task.id] < oldListHeld) throw Error('Original packing hold provenance conflict');
      packingHolds.heldByTask[task.id] += newListHeld - oldListHeld;
    }
    const mapped = preparePackingHoldTransition({ ...product, event, generation, packingHolds });
    const duplicate = mapped.plan.writes.find(w => w.collection === journal && w.after._id === record._id);
    if (!duplicate || !same(duplicate.after, event)) throw Error('Original packing record mismatch');
    writes.push(...mapped.plan.writes.filter(w => w !== duplicate)); states.push(mapped.state);
  }
  if ([...coverage.values()].some(n => n !== 1) || new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length
    || writes.length > 30 || Buffer.byteLength(JSON.stringify({ writes })) > 180000) throw Error('Atomic packing coverage limit');
  return { plan: { writes }, states };
}
module.exports = { preparePackingStock };
