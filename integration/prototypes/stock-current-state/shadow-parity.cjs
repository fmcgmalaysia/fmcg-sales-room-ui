'use strict';

const { hash } = require('./commit-proof.cjs');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fields = {
  positions: ['schemaVersion', 'company', 'stockKey', 'sourceKind', 'sourceId', 'sourceTaskId', 'poId', 'receiptAccepted', 'replacementReceived', 'supplierReturned', 'dispatched', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewCodes', 'status'],
  claims: ['schemaVersion', 'company', 'stockKey', 'positionId', 'taskId', 'customerId', 'orderId', 'sourceLineId', 'reservedUsable', 'isolatedAttributed', 'reviewCodes', 'status'],
  products: ['schemaVersion', 'company', 'stockKey', 'barcode', 'packing', 'ea', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewRequired', 'status']
};
const quantities = ['onHand', 'isolated', 'reservedUsable', 'available'];
const count = n => Number.isSafeInteger(n) && n >= 0;
const sum = (rows, field) => {
  let n = 0;
  for (const row of rows) { if (row[field] === null) return null; if (!count(row[field]) || !count(n + row[field])) throw Error('Shadow quantity invalid'); n += row[field]; }
  return n;
};
// Explicit private maintenance/shadow diagnostic. Never called on normal stock
// reads, never writes, never elects a winner or grants activation permission.
function compareStockShadow({ company, expected, current, controlBefore, controlAfter }) {
  const report = { company, activationReady: false, parity: false, status: null, differenceCount: 0, differences: [] };
  const finish = status => ({ ...report, status, fingerprint: hash(canonical({ ...report, status })) });
  if (!['NCT', 'GHR'].includes(company) || expected?.company !== company || current?.company !== company || current.complete !== true
    || !count(expected.generation) || !count(current.generation) || !Array.isArray(current.transfers)
    || Object.keys(fields).some(k => !Array.isArray(expected[k]) || !Array.isArray(current[k]))) throw Error('Complete company shadow snapshots required');
  if (!same(controlBefore, controlAfter)) return finish('SNAPSHOT_CHANGED_RECHECK');
  if (controlBefore?._id !== hash(company, 'STOCK_CONTROL') || controlBefore.company !== company || !controlBefore._version
    || controlBefore.schemaVersion !== 1 || !count(controlBefore.generation)) return finish('CONTROL_NOT_VERIFIED');
  if (controlBefore.pending) return finish('SAVE_PENDING_STAY_BLOCKED');
  if (!['MAINTENANCE', 'SHADOW'].includes(controlBefore.mode)) return finish('MODE_NOT_ELIGIBLE');
  if (expected.generation !== current.generation || current.generation !== controlBefore.generation) return finish('GENERATION_MISMATCH');
  if (current.transfers.length) return finish('RELATION_AWARE_BASELINE_REQUIRED');
  const differences = (table, id, field, reason = 'FIELD_MISMATCH') => {
    report.differenceCount++;
    if (report.differences.length < 100) report.differences.push({ table, id, field, reason });
  };
  const maps = {}, fingerprintRows = {};
  let reviewRequired = false;
  for (const table of Object.keys(fields)) {
    const left = new Map(), right = new Map();
    for (const [rows, map] of [[expected[table], left], [current[table], right]]) for (const row of rows) {
      const id = table === 'positions' ? hash(company, row.stockKey, 'PURCHASE_SOURCE', row.sourceTaskId)
        : table === 'claims' ? hash(company, row.positionId, row.taskId) : hash(company, row.stockKey);
      let key; try { key = JSON.parse(row.stockKey); } catch (_) { throw Error('Shadow stock identity conflict'); }
      if (!row._id || row._id !== id || map.has(row._id) || row.company !== company || row.schemaVersion !== 1
        || !Array.isArray(key) || key.length !== 4 || key[0] !== company || typeof key[1] !== 'string' || !key[1]
        || typeof key[2] !== 'string' || !key[2] || !Number.isSafeInteger(key[3]) || key[3] <= 0
        || !['ACTIVE', 'CLOSED'].includes(row.status)) throw Error('Shadow row identity conflict');
      map.set(row._id, row);
    }
    maps[table] = right;
    const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
    for (const id of ids) {
      const before = left.get(id), after = right.get(id);
      if (!before || !after) { differences(table, id, '_id', before ? 'CURRENT_ROW_MISSING' : 'UNEXPECTED_CURRENT_ROW'); continue; }
      if (!after._version || !count(after.revision) || !count(after.checkpointGeneration) || after.checkpointGeneration > current.generation) differences(table, id, '_version', 'CURRENT_METADATA_INVALID');
      for (const field of fields[table]) {
        const normalize = value => field === 'reviewCodes' && Array.isArray(value) ? [...value].sort() : value;
        if (!same(normalize(before[field]), normalize(after[field]))) differences(table, id, field);
      }
      if (after.reviewRequired === true || after.reviewCodes?.length || quantities.some(k => after[k] === null) || after.isolatedAttributed === null) reviewRequired = true;
    }
    const select = row => ({ _id: row._id, ...Object.fromEntries(fields[table].map(k => [k, row[k]])) });
    fingerprintRows[table] = { expected: expected[table].map(select).sort((a, b) => a._id.localeCompare(b._id)),
      current: current[table].map(select).sort((a, b) => a._id.localeCompare(b._id)) };
  }
  const claimsByPosition = new Map(), sourcesByProduct = new Map(), productKeys = new Set([...maps.products.values()].map(p => p.stockKey));
  for (const claim of maps.claims.values()) { if (!claimsByPosition.has(claim.positionId)) claimsByPosition.set(claim.positionId, []); claimsByPosition.get(claim.positionId).push(claim); }
  for (const position of maps.positions.values()) { if (!sourcesByProduct.has(position.stockKey)) sourcesByProduct.set(position.stockKey, []); sourcesByProduct.get(position.stockKey).push(position); }
  for (const position of maps.positions.values()) {
    const claims = claimsByPosition.get(position._id) || [];
    if (!productKeys.has(position.stockKey)) differences('positions', position._id, 'stockKey', 'PRODUCT_CHECKPOINT_MISSING');
    const usable = sum(claims, 'reservedUsable');
    if (usable !== null && position.reservedUsable !== null && usable !== position.reservedUsable) differences('positions', position._id, 'reservedUsable', 'CLAIM_TOTAL_MISMATCH');
    if (quantities.every(k => count(position[k])) && position.onHand !== position.available + position.isolated + position.reservedUsable) differences('positions', position._id, 'onHand', 'PHYSICAL_BALANCE_MISMATCH');
    if ([position.onHand, position.supplierReturned, position.dispatched, position.receiptAccepted, position.replacementReceived].every(count)
      && position.onHand + position.supplierReturned + position.dispatched !== position.receiptAccepted + position.replacementReceived) differences('positions', position._id, 'onHand', 'MOVEMENT_TOTAL_MISMATCH');
  }
  for (const claim of maps.claims.values()) {
    const position = maps.positions.get(claim.positionId);
    if (!position || claim.stockKey !== position.stockKey) differences('claims', claim._id, 'positionId', 'ORPHANED_CLAIM');
  }
  for (const product of maps.products.values()) {
    const sources = sourcesByProduct.get(product.stockKey) || [];
    for (const field of quantities) if (sum(sources, field) !== product[field]) differences('products', product._id, field, 'SOURCE_TOTAL_MISMATCH');
  }
  report.dataFingerprint = hash(canonical(fingerprintRows));
  report.parity = report.differenceCount === 0;
  return finish(report.parity ? reviewRequired ? 'PARITY_WITH_REVIEW_REQUIRED' : 'PARITY_CONFIRMED_KNOWN' : 'DIFFERENCE_REVIEW_REQUIRED');
}
module.exports = { compareStockShadow };
