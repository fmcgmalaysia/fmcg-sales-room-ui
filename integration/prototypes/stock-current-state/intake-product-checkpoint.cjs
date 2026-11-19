'use strict';

const { stockKey } = require('./current-model.cjs');
const { hash } = require('./commit-proof.cjs');
const { copy } = require('./segmented-plan.cjs');
// Exact company-scoped product reads from the private shared barrier are required.
// Creates zero product metadata only; no receipt, reservation, PO or free cartons.
function appendIntakeProductCheckpoints({ company, body, plan, productRows, generation }) {
  if (!['NCT', 'GHR'].includes(company) || body?.destination !== company || !Array.isArray(body.lines)
    || !Array.isArray(plan?.writes) || !Number.isSafeInteger(generation) || generation < 0 || !Number.isSafeInteger(generation + 1)) throw Error('Private intake product context required');
  if (!plan.writes.length) return copy(plan); // Original accepted replay stays read-only.
  const identities = new Map();
  for (const line of body.lines) {
    const identity = { company, barcode: line.unitBarcode, packing: line.packingSize, ea: line.eaPerCtn, name: line.itemName };
    const key = stockKey(identity); if (!identities.has(key)) identities.set(key, identity);
  }
  if (!Array.isArray(productRows) || productRows.length !== identities.size) throw Error('Complete exact intake product reads required');
  const provided = new Map();
  for (const entry of productRows) {
    const key = stockKey(entry.identity);
    if (entry.identity.company !== company || !identities.has(key) || provided.has(key) || entry.row !== null && (!entry.row
      || entry.row._id !== hash(company, key) || entry.row.company !== company || entry.row.stockKey !== key || !entry.row._version
      || entry.row.lifecycleVersion !== 2 || !Number.isSafeInteger(entry.row.nextBorrowSequence) || entry.row.nextBorrowSequence < 1)) throw Error('Intake product checkpoint conflict');
    provided.set(key, entry.row);
  }
  const result = copy(plan), marker = result.writes.pop();
  if (marker?.after.action !== 'ORDER_RECEIVED') throw Error('Original accepted marker must remain last');
  for (const [key, identity] of identities) if (provided.get(key) === null) {
    result.writes.push({ collection: 'StockProducts', before: null, after: { _id: hash(company, key), schemaVersion: 1,
      company, stockKey: key, barcode: identity.barcode, name: identity.name, packing: identity.packing, ea: identity.ea,
      lifecycleVersion: 2, nextBorrowSequence: 1, onHand: 0, isolated: 0, available: 0, reservedUsable: 0,
      reviewRequired: false, reviewCodes: [], revision: 0, checkpointGeneration: generation + 1, status: 'CLOSED' } });
  }
  result.writes.push(marker); return result;
}
module.exports = { appendIntakeProductCheckpoints };
