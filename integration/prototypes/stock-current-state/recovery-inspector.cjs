'use strict';

const { hash } = require('./commit-proof.cjs');
const { planCollections } = require('./domain-scope.cjs');
const { inspectSegmentedStockRecovery } = require('./segmented-recovery-inspector.cjs');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// Private, read-only incident classification. No lock deletion/stealing, inverse writes,
// automatic retry or new save identity. Server administrator auth must wrap any endpoint.
async function inspectStockRecovery({ store, company, requestId, memberId, input, domainWrites = false, pageSize, cursor }) {
  if (typeof store?.read !== 'function' || !['NCT', 'GHR'].includes(company)
    || !/^[a-f0-9-]{36}$/i.test(requestId || '') || typeof memberId !== 'string' || !memberId) throw Error('Known original request identity required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const key = hash(company + '/PURCHASE', requestId, memberId), digest = hash(input);
  const lockId = hash(company + '/PURCHASE', 'LOCK'), controlId = hash(company, 'STOCK_CONTROL'), resultId = hash(key, 'RESULT');
  const allowed = new Set(planCollections(company, domainWrites));
  const control = await store.read(journal, controlId), lock = await store.read(journal, lockId);
  if (!control || control._id !== controlId || control.company !== company || !control._version
    || !Number.isSafeInteger(control.generation) || control.generation < 0
    || control.pending && (!control.pending.key || !control.pending.digest)) throw Error('Inventory control unavailable or invalid');
  const prepared = await store.read(journal, key), result = await store.read(journal, resultId);
  if (prepared?.stockOperationProtocol === 2) return inspectSegmentedStockRecovery({ store, company, requestId, memberId, input, domainWrites, pageSize, cursor });
  const packet = { company, operationId: key, generation: control.generation, controlVersion: control._version,
    pendingOperation: control.pending?.key || null, lockOwner: lock?.owner || null, lockAttempt: lock?.attempt || null,
    prepared: !!prepared, result: !!result, images: [], receiptVerified: false, currentImagesVerified: false, recoveryPerformed: false };
  let status;
  if (lock && (lock._id !== lockId || lock.company !== company || !lock.owner || !lock.attempt)) status = 'REVIEW_INVALID_LOCK';
  if (!status && (prepared && (prepared._id !== key || prepared.company !== company || prepared.digest !== digest)
    || result && (result._id !== resultId || result.company !== company || result.digest !== digest)
    || control.pending?.key === key && control.pending.digest !== digest)) status = 'REVIEW_REQUEST_IDENTITY_CONFLICT';
  if (!status && prepared) {
    const plan = prepared.plan;
    if (!Number.isSafeInteger(prepared.baseGeneration) || prepared.baseGeneration < 0
      || !Array.isArray(plan?.writes) || !plan.writes.length || plan.writes.length > 30 || Buffer.byteLength(JSON.stringify(plan)) > 180000) status = 'REVIEW_INVALID_PREPARED_PLAN';
    else {
      const seen = new Set();
      for (const change of plan.writes) {
        const id = change.after?._id, identity = change.collection + ':' + id;
        if (!allowed.has(change.collection) || !id || seen.has(identity) || change.after.company !== company
          || change.after._version !== hash(key, change.collection, id)
          || change.before && (change.before._id !== id || change.before.company !== company || !change.before._version || change.before._version === change.after._version)
          || change.collection === journal && [lockId, controlId, key, resultId].includes(id)) { status = 'REVIEW_INVALID_PREPARED_PLAN'; break; }
        seen.add(identity);
        if (result && !control.pending && control.generation > result.baseGeneration + 1) {
          packet.images.push({ collection: change.collection, id, version: null, image: 'LATER_GENERATION_NOT_RECHECKED' });
          continue;
        }
        const current = await store.read(change.collection, id);
        packet.images.push({ collection: change.collection, id, version: current?._version || null,
          image: same(current, change.after) ? 'AFTER' : same(current, change.before) ? 'BEFORE' : 'CONFLICT' });
      }
    }
  }
  // A diagnostic is not a snapshot if an execution changed either guard while reading.
  const afterControl = await store.read(journal, controlId), afterLock = await store.read(journal, lockId);
  if (!same(control, afterControl) || !same(lock, afterLock)) status = 'CHANGED_RECHECK_LATER';
  if (!status && lock) status = 'LOCK_PRESENT_STAY_BLOCKED';
  if (!status && control.pending && control.pending.key !== key) status = 'OTHER_OPERATION_PENDING';
  if (!status && packet.images.some(i => i.image === 'CONFLICT')) status = 'REVIEW_IMAGE_CONFLICT';
  if (!status && result) {
    if (!prepared || !Number.isSafeInteger(result.baseGeneration) || result.baseGeneration < 0 || result.outcome?.ok !== true
      || result.outcome.operationId !== key || result.outcome.generation !== result.baseGeneration + 1
      || prepared && prepared.baseGeneration !== result.baseGeneration) status = 'REVIEW_INVALID_RESULT';
    else {
      packet.receiptVerified = true;
      const allAfter = packet.images.every(i => i.image === 'AFTER');
      if ((control.pending || control.generation === result.outcome.generation) && !allAfter) status = 'REVIEW_RESULT_IMAGES';
      else if (control.pending) status = control.generation === result.baseGeneration ? 'SAME_REQUEST_FINALIZE_RESULT' : 'REVIEW_RESULT_BARRIER';
      else status = control.generation >= result.baseGeneration + 1 ? 'CONFIRMED_RESULT' : 'REVIEW_RESULT_GENERATION';
      packet.currentImagesVerified = allAfter && ['CONFIRMED_RESULT','SAME_REQUEST_FINALIZE_RESULT'].includes(status);
    }
  }
  if (!status && control.pending && !prepared) status = 'REVIEW_MISSING_PREPARED_PLAN';
  if (!status && prepared) {
    if (prepared.baseGeneration !== control.generation) status = 'REVIEW_PREPARED_GENERATION';
    else if (control.pending) status = 'SAME_REQUEST_RESUME_PREPARED';
    else status = packet.images.every(i => i.image === 'BEFORE') ? 'SAME_REQUEST_PREPARED_NOT_APPLIED' : 'REVIEW_MISSING_BARRIER';
  }
  if (!status) status = 'NO_RECEIPT_NOT_CONFIRMED';
  return { ...packet, status, fingerprint: hash(packet, status) };
}
module.exports = { inspectStockRecovery };
