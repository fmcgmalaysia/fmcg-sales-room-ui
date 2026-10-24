'use strict';

// Inductive current balance: initial parity + every exact changed-source delta.
// This is a pure mapper, not an initializer, reader or permission boundary.
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const fields = ['onHand', 'reservedUsable', 'available', 'isolated'];
const count = n => Number.isSafeInteger(n) && n >= 0;
function sourceTotals(source) {
  const reservedUsable = Object.values(source.claims || {}).reduce((sum, n) => {
    if (!count(n) || !count(sum + n)) throw Error('Source claim total overflow'); return sum + n;
  }, 0);
  const totals = { onHand: source.onHand, reservedUsable, available: source.available, isolated: source.isolated };
  if (!fields.every(k => count(totals[k])) || !count(reservedUsable + totals.available + totals.isolated)
    || totals.onHand !== reservedUsable + totals.available + totals.isolated) throw Error('Known source balance required');
  return totals;
}
function rollForwardProduct({ identity, product, beforeSources, afterSources, generation, revision, lifecycle }) {
  const company = identity?.company, key = stockKey(identity), id = hash(company, key);
  if (!['NCT', 'GHR'].includes(company) || !count(generation) || !count(revision)
    || !Array.isArray(beforeSources) || !Array.isArray(afterSources)
    || new Set(beforeSources.map(s => s.id)).size !== beforeSources.length
    || new Set(afterSources.map(s => s.id)).size !== afterSources.length) throw Error('Exact source delta scope required');
  if (product && (product._id !== id || product.company !== company || product.stockKey !== key || !product._version
    || product.revision !== revision || product.reviewRequired === true || product.reviewCodes?.length
    || !fields.every(k => count(product[k])) || product.onHand !== product.reservedUsable + product.available + product.isolated)) throw Error('Known product checkpoint required');
  if (product?.lifecycleVersion === 2 && !lifecycle) throw Error('Product lifecycle context missing');
  const afterById = new Map(afterSources.map(s => [s.id, s])), delta = Object.fromEntries(fields.map(k => [k, 0]));
  const beforeTotals = Object.fromEntries(fields.map(k => [k, 0]));
  const priorIds = new Set(beforeSources.map(s => s.id));
  for (const source of afterSources.filter(s => !priorIds.has(s.id))) {
    // Procurement may add a zero/nonphysical source before PO confirmation. The
    // existing source mapper has not written a physical position for it yet.
    if (!source.id || stockKey(source) !== key || Object.values(sourceTotals(source)).some(n => n !== 0)) throw Error('New source must remain nonphysical');
  }
  for (const before of beforeSources) {
    const after = afterById.get(before.id);
    if (!before.id || !after || stockKey(before) !== key || stockKey(after) !== key) throw Error('Source delta identity conflict');
    const old = sourceTotals(before), next = sourceTotals(after);
    if (!product && fields.some(k => old[k] !== 0)) throw Error('Product checkpoint missing');
    for (const field of fields) {
      beforeTotals[field] += old[field];
      if (!count(beforeTotals[field]) || product && beforeTotals[field] > product[field]) throw Error('Source delta exceeds product checkpoint');
      delta[field] += next[field] - old[field];
      if (!Number.isSafeInteger(delta[field])) throw Error('Product delta overflow');
    }
  }
  if (!product && revision !== 0) throw Error('Product checkpoint missing');
  const totals = Object.fromEntries(fields.map(k => [k, (product?.[k] || 0) + delta[k]]));
  if (!fields.every(k => count(totals[k])) || !count(totals.reservedUsable + totals.available + totals.isolated)
    || totals.onHand !== totals.reservedUsable + totals.available + totals.isolated || !count(revision + 1) || !count(generation + 1)) throw Error('Product delta balance conflict');
  const result = { ...(product || { _id: id, schemaVersion: 1, company, stockKey: key,
    barcode: identity.barcode, packing: identity.packing, ea: identity.ea, name: identity.name || '' }),
    ...totals, revision: revision + 1, checkpointGeneration: generation + 1, reviewRequired: false,
    status: totals.onHand === 0 ? 'CLOSED' : 'ACTIVE' };
  if (lifecycle) {
    if (lifecycle.version !== 2 || !Number.isSafeInteger(lifecycle.nextBorrowSequence) || lifecycle.nextBorrowSequence <= 0
      || product && (product.lifecycleVersion !== 2 || !Number.isSafeInteger(product.nextBorrowSequence)
        || lifecycle.nextBorrowSequence < product.nextBorrowSequence)) throw Error('Product lifecycle delta conflict');
    Object.assign(result, { lifecycleVersion: 2, nextBorrowSequence: lifecycle.nextBorrowSequence });
  }
  return copy(result);
}
module.exports = { rollForwardProduct, sourceTotals };
