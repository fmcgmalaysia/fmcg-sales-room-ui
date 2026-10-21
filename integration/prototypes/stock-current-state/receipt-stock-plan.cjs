'use strict';

// Isolated single-line balance planner. NOT an authorization or legacy receipt validator.
// Caller must first retain existing PO/version/quantity/reason/finance/allocation guards.
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const copy = row => JSON.parse(JSON.stringify(row));
const count = n => Number.isSafeInteger(n) && n >= 0;
const lineCount = n => count(n) && n <= 9999;
const present = value => typeof value === 'string' && value.length > 0;
function knownBalance(row) {
  if (!['onHand', 'reservedUsable', 'available', 'isolated'].every(field => count(row[field]))
    || row.onHand !== row.reservedUsable + row.available + row.isolated
    || !count(row.revision) || !present(row._version) || row.reviewRequired === true
    || row.reviewCodes?.length || !['ACTIVE', 'CLOSED'].includes(row.status)) throw Error('Known current balance required');
}
function planReceiptStockLine({ company, line, sourceTask, ownership, position = null, claims = [], product = null,
  generation, holdsVerified, heldByTask = {} }) {
  const key = stockKey({ ...sourceTask, company });
  if (!count(generation) || generation === Number.MAX_SAFE_INTEGER || holdsVerified !== true
    || !line || line.taskId !== sourceTask.id || line.orderId !== sourceTask.orderId
    || line.sourceLineId !== sourceTask.sourceLineId || !present(sourceTask.poId)
    || sourceTask.company !== company || !Array.isArray(claims)
    || ![line.accepted, line.beforeAccepted, line.rejected, line.beforeRejected, line.planned].every(lineCount)
    || !['CORRECTION', 'DELIVERY', 'PARTIAL', 'SHORT', 'DAMAGED', 'WRONG', 'OTHER'].includes(line.kind)
    || line.accepted > line.planned || line.beforeAccepted > line.planned) throw Error('Validated receipt context required');
  if (line.kind !== 'CORRECTION' && (line.accepted < line.beforeAccepted || line.rejected < line.beforeRejected)
    || line.kind === 'CORRECTION' && !String(line.reason || '').trim()) throw Error('Receipt correction evidence required');
  const positionId = hash(company, key, 'PURCHASE_SOURCE', sourceTask.id), productId = hash(company, key);
  if (position) {
    knownBalance(position);
    if (position._id !== positionId || position.company !== company || position.stockKey !== key
      || position.sourceTaskId !== sourceTask.id || position.poId !== sourceTask.poId
      || position.receiptAccepted !== line.beforeAccepted || !count(position.replacementReceived)
      || !count(position.dispatched)) throw Error('Receipt source basis changed');
  } else if (line.beforeAccepted !== 0 || claims.length) throw Error('Receipt source basis missing');
  if (product) {
    knownBalance(product);
    if (product._id !== productId || product.company !== company || product.stockKey !== key) throw Error('Product identity conflict');
    if (position && ['onHand', 'reservedUsable', 'available', 'isolated'].some(field => product[field] < position[field])) throw Error('Product source balance conflict');
  } else if (position) throw Error('Product summary missing');
  const seen = new Set();
  let claimSum = 0, attributedIsolated = 0;
  for (const claim of claims) {
    if (claim.company !== company || claim.positionId !== positionId || claim.stockKey !== key
      || claim._id !== hash(company, positionId, claim.taskId) || !present(claim.taskId) || !present(claim.customerId)
      || !count(claim.reservedUsable) || !count(claim.isolatedAttributed) || claim.reviewCodes?.length
      || !present(claim._version) || !count(claim.revision) || seen.has(claim.taskId)) throw Error('Complete known source claims required');
    seen.add(claim.taskId); claimSum += claim.reservedUsable;
    attributedIsolated += claim.isolatedAttributed;
    if (!count(claimSum)) throw Error('Claim overflow');
  }
  if (claimSum !== (position?.reservedUsable || 0)) throw Error('Source claims incomplete');
  if (!count(attributedIsolated) || attributedIsolated > (position?.isolated || 0)) throw Error('Isolated attribution conflict');
  for (const [taskId, held] of Object.entries(heldByTask)) {
    if (!count(held) || held > (claims.find(claim => claim.taskId === taskId)?.reservedUsable || 0)) throw Error('Hold snapshot conflict');
  }
  const delta = line.accepted - line.beforeAccepted;
  if (!ownership || !['PURCHASE_CUSTOMER_SHARE', 'PLANNER_ALLOCATION'].includes(ownership.kind)) throw Error('Ownership basis required');
  let deltaReserved = 0, claimChange = null;
  if (ownership.kind === 'PURCHASE_CUSTOMER_SHARE') {
    const share = ownership.customerShare, owner = ownership.owner;
    if (!lineCount(share) || share > line.planned || share > 0 && (!owner || stockKey({ ...owner, company }) !== key
      || owner.company !== company || !present(owner.id) || !present(owner.customerId)
      || owner.procurementSource || owner.specialPurchase)) throw Error('Saved customer share required');
    if (claims.some(claim => claim.taskId !== owner?.id)) throw Error('Implicit ownership changed');
    if (share > 0) {
      const beforeClaim = claims.find(claim => claim.taskId === owner.id) || null;
      const replacement = position?.replacementReceived || 0, dispatched = position?.dispatched || 0;
      const isolatedAttributed = beforeClaim?.isolatedAttributed || 0;
      const expectedBefore = Math.max(0, Math.min(share, line.beforeAccepted + replacement) - dispatched - isolatedAttributed);
      if ((beforeClaim?.reservedUsable || 0) !== expectedBefore || beforeClaim && beforeClaim.customerId !== owner.customerId) throw Error('Implicit claim basis changed');
      const afterReserved = Math.max(0, Math.min(share, line.accepted + replacement) - dispatched - isolatedAttributed);
      if (afterReserved < (heldByTask[owner.id] || 0)) throw Error('Correction below held stock');
      deltaReserved = afterReserved - expectedBefore;
      if (deltaReserved !== 0) {
        const after = { ...(beforeClaim || { _id: hash(company, positionId, owner.id), schemaVersion: 1, company,
          stockKey: key, positionId, taskId: owner.id, customerId: owner.customerId,
          orderId: owner.orderId || '', sourceLineId: owner.sourceLineId || '', isolatedAttributed: 0, reviewCodes: [], revision: 0 }),
          reservedUsable: afterReserved, revision: (beforeClaim?.revision || 0) + 1,
          checkpointGeneration: generation + 1, status: afterReserved === 0 && isolatedAttributed === 0 ? 'CLOSED' : 'ACTIVE' };
        claimChange = { collection: 'StockClaims', before: copy(beforeClaim), after };
      }
    } else if (claimSum !== 0) throw Error('Zero share cannot own current claims');
  }
  if (delta === 0) return { writes: [], deltaAccepted: 0, deltaReserved: 0 };
  const basePosition = position || { _id: positionId, schemaVersion: 1, company, stockKey: key,
    barcode: sourceTask.barcode, name: sourceTask.name || '', packing: sourceTask.packing, ea: sourceTask.ea,
    sourceKind: 'PURCHASE_SOURCE', sourceId: sourceTask.id, sourceTaskId: sourceTask.id, poId: sourceTask.poId,
    receiptAccepted: 0, replacementReceived: 0, dispatched: 0, onHand: 0, isolated: 0, reservedUsable: 0, available: 0,
    reviewCodes: [], revision: 0 };
  const changed = row => ({ ...row, onHand: row.onHand + delta, reservedUsable: row.reservedUsable + deltaReserved,
    available: row.available + delta - deltaReserved, revision: row.revision + 1, checkpointGeneration: generation + 1 });
  const afterPosition = { ...changed(basePosition), receiptAccepted: line.accepted };
  afterPosition.status = afterPosition.onHand === 0 ? 'CLOSED' : 'ACTIVE';
  const baseProduct = product || { _id: productId, schemaVersion: 1, company, stockKey: key,
    barcode: sourceTask.barcode, name: sourceTask.name || '', packing: sourceTask.packing, ea: sourceTask.ea,
    onHand: 0, isolated: 0, reservedUsable: 0, available: 0, reviewRequired: false, revision: 0 };
  const afterProduct = changed(baseProduct);
  afterProduct.status = afterProduct.onHand === 0 ? 'CLOSED' : 'ACTIVE';
  for (const row of [afterPosition, afterProduct]) {
    if (!['onHand', 'reservedUsable', 'available', 'isolated', 'revision'].every(field => count(row[field]))
      || row.onHand !== row.reservedUsable + row.available + row.isolated) throw Error('Correction below current physical obligations');
  }
  return { deltaAccepted: delta, deltaReserved, writes: [
    { collection: 'StockPositions', before: copy(position), after: afterPosition },
    ...(claimChange ? [claimChange] : []), { collection: 'StockProducts', before: copy(product), after: afterProduct }
  ] };
}

// Combines one already-validated immutable receipt event with all its line balances.
// Snapshot contexts must include CLOSED exact-ID rows, not just UI ACTIVE pages.
function composeReceiptStockPlan({ company, event, contexts, generation }) {
  if (!['NCT', 'GHR'].includes(company) || event?.action !== 'WAREHOUSE_RECEIPT_SAVED' || event.result !== 'SAVED'
    || !present(event._id) || event._id !== event.title || !present(event.description)
    || event.details?.company !== company || !Array.isArray(event.details.lines) || !event.details.lines.length
    || !Array.isArray(contexts) || contexts.length !== event.details.lines.length
    || !count(generation) || new Set(event.details.lines.map(line => line.taskId)).size !== contexts.length
    || new Set(contexts.map(context => context.sourceTask?.id)).size !== contexts.length) throw Error('Validated receipt event required');
  const canonical = row => Array.isArray(row) ? row.map(canonical) : row && typeof row === 'object'
    ? Object.fromEntries(Object.keys(row).sort().map(key => [key, canonical(row[key])])) : row;
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const writes = new Map();
  for (const line of event.details.lines) {
    const context = contexts.find(row => row.sourceTask.id === line.taskId);
    if (!context || context.sourceTask.poId !== event.description) throw Error('Receipt PO context mismatch');
    const plan = planReceiptStockLine({ ...context, company, line, generation });
    for (const write of plan.writes) {
      const identity = write.collection + ':' + write.after._id, old = writes.get(identity);
      if (!old) { writes.set(identity, copy(write)); continue; }
      if (write.collection !== 'StockProducts' || !equal(old.before, write.before)) throw Error('Receipt balance snapshot conflict');
      for (const field of ['onHand', 'reservedUsable', 'available', 'isolated']) {
        old.after[field] += write.after[field] - (write.before?.[field] || 0);
        if (!count(old.after[field])) throw Error('Receipt aggregate overflow');
      }
      // One product write per commit, irrespective of how many receipt source lines.
      old.after.revision = (old.before?.revision || 0) + 1;
      old.after.status = old.after.onHand === 0 ? 'CLOSED' : 'ACTIVE';
    }
  }
  const afterEvent = { ...copy(event), company };
  const plan = { writes: [{ collection: company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', before: null, after: afterEvent }, ...writes.values()] };
  // Keep current proof bounds; do not partially commit a larger PO.
  if (plan.writes.length > 30 || Buffer.byteLength(JSON.stringify(plan)) > 180000) throw Error('Receipt exceeds current commit proof limit');
  return plan;
}

module.exports = { planReceiptStockLine, composeReceiptStockPlan };
