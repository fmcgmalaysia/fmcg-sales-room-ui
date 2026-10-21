'use strict';

const { stockKey } = require('./current-model.cjs');
const { validate, relationRemaining } = require('./borrowing-model.cjs');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Before and after are server projections of ORIGINAL domain before/after images,
// assembled over the SAME exact current rows. Not browser-proposed balance changes.
function guardProcurementStock({ before, after }) {
  validate(before); validate(after);
  if (stockKey(before) !== stockKey(after) || before.revision !== after.revision
    || !same(before.relations, after.relations) || !same(before.packingHolds, after.packingHolds)) throw Error('Procurement cannot rewrite stock generation, transfers or packing instructions');
  if (before.tasks.length !== after.tasks.length) throw Error('Procurement cannot create customer demand');
  const changedSources = [];
  for (const task of before.tasks) {
    const next = after.tasks.find(t => t.id === task.id);
    if (!next || ['customerId', 'orderId', 'sourceLineId', 'requested', 'dispatched'].some(k => next[k] !== task[k])) throw Error('Procurement cannot remove or retarget customer stock provenance');
  }
  for (const source of before.sources) {
    const next = after.sources.find(s => s.id === source.id);
    if (!next) throw Error('Existing stock source cannot disappear from procurement');
    if (['ownerTaskId', 'orderId', 'sourceLineId'].some(k => next[k] !== source[k])) throw Error('Procurement source ownership identity is immutable');
    const related = before.relations.filter(r => [r.lenderSourceId, r.replacementSourceId].includes(source.id));
    if (next.poId !== source.poId && (source.accepted > 0 || related.length)) throw Error('Received or transfer-bound PO substitution requires its dedicated workflow');
    if (['accepted', 'onHand', 'isolated', 'available'].some(k => next[k] !== source[k])
      || (next.replacementReceived || 0) !== (source.replacementReceived || 0) || (next.supplierReturned || 0) !== (source.supplierReturned || 0)
      || !same(next.claims, source.claims) || !same(next.dispatchedByTask || {}, source.dispatchedByTask || {})) throw Error('Procurement cannot release ownership or change physical movements');
    const lent = related.filter(r => r.lenderSourceId === source.id).reduce((n, r) => n + r.quantity - (r.returned || 0), 0);
    const committedOwner = (source.claims[source.ownerTaskId] || 0) + (source.dispatchedByTask?.[source.ownerTaskId] || 0) + lent;
    if (next.ownerShare < Math.min(source.ownerShare, committedOwner)) throw Error('Procurement share reduction would erase committed customer stock');
    const pending = related.filter(r => r.replacementSourceId === source.id).reduce((n, r) => n + relationRemaining(r), 0);
    if (Math.max(0, next.ownerShare - next.accepted) < pending) throw Error('Procurement reduction would remove approved replacement supply');
    if (next.planned !== source.planned || next.ownerShare !== source.ownerShare || next.poId !== source.poId) changedSources.push(source.id);
  }
  for (const source of after.sources.filter(s => !before.sources.some(old => old.id === s.id))) {
    if (source.accepted || source.onHand || source.isolated || source.available || source.replacementReceived || source.supplierReturned
      || Object.values(source.claims).some(Boolean) || Object.values(source.dispatchedByTask || {}).some(Boolean)) throw Error('New PO source is not a physical receipt');
    changedSources.push(source.id);
  }
  return { company: before.company, stockKey: stockKey(before), generationUnchanged: true, changedSources };
}
module.exports = { guardProcurementStock };
