'use strict';

const { stockKey } = require('./current-model.cjs');
const { domainCollections } = require('./domain-scope.cjs');
const { prepareProcurementTransition } = require('./borrowing-stock-plan.cjs');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Private composition seam. Products MUST be server before/after projectors over
// the same exact current rows and original domain after-images, not client states.
// Called inside fenced prepare after original Purchase/auth/version validation.
function preparePurchaseStock({ company, domainPlan, products, generation }) {
  const [, tasks] = domainCollections(company), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  if (!Array.isArray(domainPlan?.writes) || !domainPlan.writes.length || !Array.isArray(products) || !products.length) throw Error('Complete Purchase stock composition required');
  const taskIds = domainPlan.writes.filter(w => w.collection === tasks).map(w => w.after._id);
  const originalEvents = domainPlan.writes.filter(w => w.collection === journal);
  if (!taskIds.length || !originalEvents.length || new Set(taskIds).size !== taskIds.length
    || domainPlan.writes.some(w => ![tasks, journal].includes(w.collection) || w.after?.company !== company)
    || originalEvents.some(w => w.before !== null || w.after.result !== 'SAVED' || !w.after.action?.startsWith('PURCHASE_'))) throw Error('Original Purchase domain intent required');
  const keys = new Set(), coverage = new Map(taskIds.map(id => [id, 0])), writes = [...domainPlan.writes], states = [];
  const event = originalEvents[0].after;
  for (const product of products) {
    const key = stockKey(product.state);
    if (product.state.company !== company || stockKey(product.after) !== key || keys.has(key)) throw Error('Distinct same-company Purchase product coverage required');
    keys.add(key);
    const drafts = product.unconfirmedSourceIds || [];
    if (!Array.isArray(drafts) || new Set(drafts).size !== drafts.length || drafts.some(id => {
      const row = domainPlan.writes.find(w => w.collection === tasks && w.after._id === id)?.after;
      return !row?.procurementSource || row.ourPoNumber || !originalEvents.some(w => w.after.imageAltText === id
        && w.after.action === 'PURCHASE_PLAN_SAVED' && w.after.details?.draftPlan === true);
    })) throw Error('Original unconfirmed source coverage required');
    const present = id => drafts.includes(id) || [product.state, product.after].some(s => s.tasks.some(t => t.id === id) || s.sources.some(t => t.id === id));
    const covered = taskIds.filter(present);
    if (!covered.length) throw Error('Unrelated Purchase product snapshot');
    for (const id of covered) coverage.set(id, coverage.get(id) + 1);
    const mapped = prepareProcurementTransition({ ...product, event, generation });
    const repeated = mapped.plan.writes.find(w => w.collection === journal && w.after._id === event._id);
    if (!repeated || !same(repeated, originalEvents[0])) throw Error('Original Purchase event mismatch');
    writes.push(...mapped.plan.writes.filter(w => w !== repeated)); states.push(mapped.state);
  }
  if ([...coverage.values()].some(n => n !== 1) || new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length
    || writes.length > 30 || Buffer.byteLength(JSON.stringify({ writes })) > 180000) throw Error('Complete atomic Purchase stock coverage required');
  return { plan: { writes }, states };
}
module.exports = { preparePurchaseStock };
