'use strict';

const { hash } = require('./commit-proof.cjs');
const { createSegmentedPlanCodec, same } = require('./segmented-plan.cjs');
const { classifyPurchaseDeletionImage } = require('./purchase-delete-images.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
// READ ONLY. A page of evidence cannot authorize unlocking, inverse writes or
// claim an entire901row operation was checked. Original retained request only.
async function inspectSegmentedStockRecovery({ store, company, requestId, memberId, input, domainWrites = false,
  pageSize = 20, cursor = null }) {
  if (typeof store?.read !== 'function' || !['NCT', 'GHR'].includes(company) || !/^[a-f0-9-]{36}$/i.test(requestId || '')
    || typeof memberId !== 'string' || !memberId || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50
    || cursor && (!/^[a-f0-9]{32}$/.test(cursor.version || '') || !count(cursor.offset) || cursor.offset % pageSize)) throw Error('Bounded original segmented inspection required');
  const codec = createSegmentedPlanCodec({ company, domainWrites }), { journal, lockId, controlId } = codec.ids;
  const key = hash(company + '/PURCHASE', requestId, memberId), digest = hash(input), resultId = hash(key, 'RESULT');
  const control = await store.read(journal, controlId), lock = await store.read(journal, lockId);
  if (!control || control._id !== controlId || control.company !== company || !control._version || !count(control.generation)) throw Error('Inventory control unavailable or invalid');
  const manifest = await store.read(journal, key), result = await store.read(journal, resultId);
  const version = hash('SEGMENTED_RECOVERY_V2', company, key, digest, control, lock, manifest, result, pageSize);
  if (cursor && cursor.version !== version) throw Error('Recovery evidence changed; restart inspection');
  const offset = cursor?.offset || 0;
  const packet = { company, operationId: key, generation: control.generation, controlVersion: control._version,
    pendingOperation: control.pending?.key || null, lockOwner: lock?.owner || null, lockAttempt: lock?.attempt || null,
    prepared: !!manifest, result: !!result, images: [], totalRecords: 0, offset, nextCursor: null,
    completeInspection: false, recoveryPerformed: false };
  let status, plan;
  if (lock && (lock._id !== lockId || lock.company !== company || !lock.owner || !lock.attempt)) status = 'REVIEW_INVALID_LOCK';
  if (!status && manifest) {
    if (!Array.isArray(manifest.fragments) || manifest.fragments.length > 32) status = 'REVIEW_SEGMENT_CAPACITY';
    else {
      const fragments = [];
      for (const ref of manifest.fragments) fragments.push(await store.read(journal, ref.id));
      try { plan = codec.decode({ manifest, fragments, key, digest, memberId, requestId }); }
      catch (_) { status = 'REVIEW_INVALID_SEGMENTED_PLAN'; }
    }
  }
  if (control.pending && (control.pending.key === key && control.pending.digest !== digest)) status = 'REVIEW_REQUEST_IDENTITY_CONFLICT';
  if (!status && plan) {
    packet.totalRecords = plan.writes.length;
    if (offset > plan.writes.length) throw Error('Recovery page outside plan');
    for (const change of plan.writes.slice(offset, offset + pageSize)) {
      const id = change.after._id;
      if (result && !control.pending && control.generation > result.baseGeneration + 1) {
        packet.images.push({ collection: change.collection, id, version: null, image: 'LATER_GENERATION_NOT_RECHECKED' });
      } else {
        const current = await store.read(change.collection, id);
        packet.images.push({ collection: change.collection, id, version: current?._version || null,
          image: change.purchaseDeletion && classifyPurchaseDeletionImage(change,current,key) || (same(current, change.after) ? 'AFTER' : same(current, change.before) ? 'BEFORE' : 'CONFLICT') });
      }
    }
    packet.completeInspection = offset === 0 && packet.images.length === plan.writes.length;
    if (offset + packet.images.length < plan.writes.length) packet.nextCursor = { version, offset: offset + packet.images.length };
    const p = control.pending;
    if (p?.key === key && (p.planHash !== manifest.planHash || p.count !== plan.writes.length || !count(p.cursor)
      || p.cursor > p.count || !['BEFORE', 'APPLY', 'VERIFY', 'FINALIZE'].includes(p.phase)
      || p.phase === 'FINALIZE' && p.cursor !== p.count)) status = 'REVIEW_PENDING_PROGRESS';
  }
  const afterControl = await store.read(journal, controlId), afterLock = await store.read(journal, lockId);
  if (!same(control, afterControl) || !same(lock, afterLock)) status = 'CHANGED_RECHECK_LATER';
  if (!status && lock) status = 'LOCK_PRESENT_STAY_BLOCKED';
  if (!status && control.pending && control.pending.key !== key) status = 'OTHER_OPERATION_PENDING';
  if (!status && packet.images.some(i => i.image === 'CONFLICT')) status = 'REVIEW_IMAGE_CONFLICT';
  if (!status && result && packet.images.some(i => i.image === 'PENDING_UNLINK')) status = 'REVIEW_FILE_DELETE_NOT_COMPLETED';
  if (!status && !result && packet.images.some(i => i.image === 'FILE_DELETE_COMPLETED') && control.pending?.phase !== 'FINALIZE') status = 'REVIEW_FILE_DELETE_PHASE';
  if (!status && result) {
    if (!plan || result.company !== company || result._id !== resultId || result.digest !== digest || result.stockOperationProtocol !== 2
      || !count(result.baseGeneration) || result.baseGeneration !== manifest.baseGeneration || result.outcome?.ok !== true
      || result.outcome.operationId !== key || result.outcome.generation !== result.baseGeneration + 1) status = 'REVIEW_INVALID_RESULT';
    else if (control.pending) status = control.generation === result.baseGeneration && control.pending.phase === 'FINALIZE'
      ? 'SAME_REQUEST_RECHECK_RESULT' : 'REVIEW_RESULT_BARRIER';
    else status = control.generation >= result.outcome.generation ? 'CONFIRMED_RESULT' : 'REVIEW_RESULT_GENERATION';
  }
  if (!status && control.pending && !manifest) status = 'REVIEW_MISSING_PREPARED_PLAN';
  if (!status && plan) {
    if (manifest.baseGeneration !== control.generation) status = 'REVIEW_PREPARED_GENERATION';
    else if (!packet.completeInspection) status = 'PAGED_INSPECTION_ONLY';
    else if (control.pending) status = 'SAME_REQUEST_REVALIDATES_ON_RESUME';
    else status = packet.images.every(i => i.image === 'BEFORE') ? 'SAME_REQUEST_PREPARED_NOT_APPLIED' : 'REVIEW_MISSING_BARRIER';
  }
  if (!status) status = 'NO_RECEIPT_NOT_CONFIRMED';
  return { ...packet, status, fingerprint: hash(packet, status, version) };
}
module.exports = { inspectSegmentedStockRecovery };
