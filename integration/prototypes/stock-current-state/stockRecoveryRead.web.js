import { items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { createHash } from 'crypto';
import { Buffer } from 'buffer';
const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
const { planCollections } = (() => {
// Exact existing collection map, verified against purchaseProjection.PURCHASE_COLLECTIONS.
// This changes no CMS/employee permission; optional conditional domain plans only.
function domainCollections(company) {
  if (company === 'NCT') return ['NCTOrders', 'NCTTasks', 'PurchaseOrders'];
  if (company === 'GHR') return ['NCTOrders1', 'NCTTasks1', 'PurchaseOrders'];
  throw Error('Known company domain scope required');
}
function planCollections(company, domainWrites = false) {
  if (!['NCT', 'GHR'].includes(company) || typeof domainWrites !== 'boolean') throw Error('Explicit server plan scope required');
  return [company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', 'StockPositions', 'StockClaims', 'StockProducts',
    ...(domainWrites ? domainCollections(company) : [])];
}
return { domainCollections, planCollections };
})();
const { createSdkFieldCodec } = (() => {
// Private SDK boundary only. Caller supplies field IDs read from the actual CMS
// schema; never infer types from names, ISO-looking strings or nested event JSON.
const isDate = value => Object.prototype.toString.call(value) === '[object Date]';
function createSdkFieldCodec({ collections, dateTimeFields = {} }) {
  const proto = dateTimeFields && typeof dateTimeFields === 'object' && Object.getPrototypeOf(dateTimeFields);
  if (!Array.isArray(collections) || !dateTimeFields || Array.isArray(dateTimeFields)
    || typeof dateTimeFields !== 'object' || (proto !== null && (Object.getPrototypeOf(proto) !== null
      || Object.getOwnPropertyDescriptor(proto, 'constructor')?.value?.name !== 'Object'))) throw Error('Explicit SDK field schema required');
  const allowed = new Set(collections), fields = new Map();
  for (const [collection, names] of Object.entries(dateTimeFields)) {
    if (!allowed.has(collection) || !Array.isArray(names) || new Set(names).size !== names.length
      || names.some(name => typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)
        || ['company', 'stockCommitVersion'].includes(name))) throw Error('Invalid SDK DateTime field scope');
    fields.set(collection, new Set(names));
  }
  function convert(collection, field, value, direction) {
    if (!allowed.has(collection)) throw Error('SDK field collection scope violation');
    if (!fields.get(collection)?.has(field) || value === null) return JSON.parse(JSON.stringify(value));
    if (direction === 'decode') {
      // A string in a DateTime field is not the same Wix type. Do not silently
      // repair legacy data or make a corrupt write appear verified.
      if (!isDate(value) || !Number.isFinite(value.getTime())) throw Error('SDK DateTime read type mismatch: ' + collection + '.' + field);
      return value.toISOString();
    }
    const canonical = isDate(value) && Number.isFinite(value.getTime()) ? value.toISOString() : value;
    if (typeof canonical !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(canonical)) {
      throw Error('Canonical DateTime write required: ' + collection + '.' + field);
    }
    const date = new Date(canonical);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) throw Error('Invalid DateTime write');
    return date;
  }
  return {
    encode: (collection, field, value) => convert(collection, field, value, 'encode'),
    decode: (collection, field, value) => convert(collection, field, value, 'decode')
  };
}
return { createSdkFieldCodec };
})();
const { createRecoveryReadStore } = (() => {
// Deliberately QUERY-ONLY. Returned capability has no insert/update/CAS/remove.
// Only for the Wix Admin inspection boundary, not a business writer fallback.
function createRecoveryReadStore({ items, company, dateTimeFields = {} }) {
  if (typeof items?.query !== 'function' || !['NCT', 'GHR'].includes(company)) throw Error('Private recovery read scope required');
  const allowed = new Set(planCollections(company, true)), metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
  const fieldCodec = createSdkFieldCodec({ collections: [...allowed], dateTimeFields });
  return { read: async (collection, id) => {
    if (!allowed.has(collection) || typeof id !== 'string' || !id || id.length > 128) throw Error('Private recovery exact scope violation');
    const page = await items.query(collection).eq('_id', id).limit(2).find({ consistentRead: true });
    if (!Array.isArray(page?.items) || page.items.length > 1) throw Error('Ambiguous recovery record');
    const row = page.items[0]; if (!row) return null;
    if (row._id !== id || row.company !== company) throw Error('Recovery record identity conflict');
    const result = Object.fromEntries(Object.entries(row).filter(([k]) => !metadata.has(k) && k !== 'stockCommitVersion')
      .map(([k, v]) => [k, fieldCodec.decode(collection, k, v)]));
    if (Object.hasOwn(row, 'stockCommitVersion')) {
      if (typeof row.stockCommitVersion !== 'string' || !row.stockCommitVersion) throw Error('Invalid recovery storage version');
      result._version = row.stockCommitVersion;
    }
    return result;
  } };
}
return { createRecoveryReadStore };
})();
const { createSegmentedPlanCodec, same, copy } = (() => {
// Candidate only. Budgets are server policy, NOT measured Wix production capacity.
// No storage, endpoint, permission or business mutation is performed by this codec.


const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stringify = value => JSON.stringify(canonical(value));
const same = (a, b) => stringify(a) === stringify(b);
const copy = value => JSON.parse(JSON.stringify(value));
// Works in the generated backend without Node Buffer or a browser TextEncoder.
function utf8Bytes(value) {
  let bytes = 0;
  for (const character of value) {
    const cp = character.codePointAt(0);
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}
function assertJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') throw Error('Plain JSON plan required');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== null && (Object.getPrototypeOf(proto) !== null
    || Object.getOwnPropertyDescriptor(proto, 'constructor')?.value?.name !== 'Object')) throw Error('Plain JSON plan required');
  for (const key of Object.keys(value)) assertJson(value[key]);
}
function createSegmentedPlanCodec({ company, domainWrites = false, recordBudgetBytes = 64000,
  maxPlanBytes = 8 * 1024 * 1024, maxWrites = 10000, maxFragments = 256 }) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Known company required');
  for (const value of [recordBudgetBytes, maxPlanBytes, maxWrites, maxFragments]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw Error('Positive codec policy required');
  }
  if (recordBudgetBytes < 2048 || recordBudgetBytes > 256000) throw Error('Conservative record budget required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const scope = company + '/PURCHASE', lockId = hash(scope, 'LOCK'), controlId = hash(company, 'STOCK_CONTROL');
  const allowed = new Set(planCollections(company, domainWrites));
  const fragmentId = (key, attempt, index) => hash(key, 'PLAN_FRAGMENT', attempt, index);
  function normalize(plan, key, reserved = []) {
    assertJson(plan);
    if (!Array.isArray(plan?.writes) || !plan.writes.length || plan.writes.length > maxWrites) throw Error('Segmented plan write policy');
    const normalized = copy(plan), identities = new Set();
    const protectedIds = new Set([lockId, controlId, key, hash(key, 'RESULT'), ...reserved]);
    for (const change of normalized.writes) {
      const id = change.after?._id, identity = change.collection + '/' + id;
      if (!allowed.has(change.collection) || typeof id !== 'string' || !id || identities.has(identity)
        || change.after.company !== company || change.before !== null && (!change.before || change.before._id !== id
          || change.before.company !== company || typeof change.before._version !== 'string' || !change.before._version)
        || change.collection === journal && (protectedIds.has(id)
          || [change.before, change.after].some(row => row?.stockOperationProtocol != null))) throw Error('Plan identity conflict');
      identities.add(identity);
      const token = hash(key, change.collection, id);
      if (change.before?._version === token) throw Error('Version reuse');
      change.after._version = token;
    }
    if (utf8Bytes(stringify(normalized)) > maxPlanBytes) throw Error('Segmented plan byte policy');
    return normalized;
  }
  function identity({ key, digest, memberId, requestId, baseGeneration, attempt }) {
    if (typeof memberId !== 'string' || !memberId || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || key !== hash(scope, requestId, memberId) || typeof digest !== 'string' || !digest
      || !Number.isSafeInteger(baseGeneration) || baseGeneration < 0 || !Number.isSafeInteger(baseGeneration + 1)
      || typeof attempt !== 'string' || !attempt) throw Error('Segmented operation identity');
  }
  function encode(context) {
    identity(context);
    const { key, digest, memberId, requestId, baseGeneration, attempt } = context;
    // Business after-images retain original JSON key order: protected legacy
    // snapshot hashes can depend on it. Canonical comparison remains appropriate
    // for protocol metadata/equality, not for rewriting stored business payloads.
    const plan = normalize(context.plan, key), payload = JSON.stringify(plan), fragments = [];
    let offset = 0;
    while (offset < payload.length) {
      if (fragments.length >= maxFragments) throw Error('Segment count policy');
      const index = fragments.length, id = fragmentId(key, attempt, index);
      const wrap = text => ({ _id: id, company, stockOperationProtocol: 2, action: 'STOCK_PLAN_FRAGMENT',
        operationId: key, attempt, index, payload: text, payloadHash: hash(text) });
      let low = 1, high = Math.min(payload.length - offset, recordBudgetBytes), size = 0;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (utf8Bytes(stringify(wrap(payload.slice(offset, offset + mid)))) <= recordBudgetBytes) { size = mid; low = mid + 1; }
        else high = mid - 1;
      }
      // Never split a surrogate pair. JSON escaping also counts against record budget.
      if (size && /[\uD800-\uDBFF]/.test(payload[offset + size - 1]) && /[\uDC00-\uDFFF]/.test(payload[offset + size] || '')) size--;
      if (!size) throw Error('Fragment metadata exceeds policy');
      fragments.push(wrap(payload.slice(offset, offset + size))); offset += size;
    }
    normalize(plan, key, fragments.map(row => row._id));
    const manifest = { _id: key, company, stockOperationProtocol: 2, action: 'STOCK_PLAN_MANIFEST', digest,
      memberId, requestId, attempt, baseGeneration, planHash: hash(payload), planBytes: utf8Bytes(payload),
      writeCount: plan.writes.length, fragments: fragments.map(row => ({ id: row._id, hash: row.payloadHash, bytes: utf8Bytes(row.payload) })) };
    if (utf8Bytes(stringify(manifest)) > recordBudgetBytes) throw Error('Manifest exceeds policy');
    return { manifest, fragments, plan };
  }
  function decode({ manifest, fragments, key, digest, memberId, requestId }) {
    if (!manifest || manifest.company !== company || manifest._id !== key || manifest.digest !== digest
      || manifest.memberId !== memberId || manifest.requestId !== requestId || manifest.stockOperationProtocol !== 2
      || manifest.action !== 'STOCK_PLAN_MANIFEST' || !Array.isArray(manifest.fragments) || !manifest.fragments.length
      || manifest.fragments.length > maxFragments || !Array.isArray(fragments) || fragments.length !== manifest.fragments.length
      || utf8Bytes(stringify(manifest)) > recordBudgetBytes) throw Error('Manifest integrity conflict');
    identity({ ...manifest, key });
    const parts = []; let payloadBytes = 0;
    for (let index = 0; index < fragments.length; index++) {
      const ref = manifest.fragments[index], row = fragments[index];
      const id = fragmentId(key, manifest.attempt, index);
      if (!row || !same(ref, { id, hash: row.payloadHash, bytes: typeof row.payload === 'string' ? utf8Bytes(row.payload) : -1 })
        || typeof row.payload !== 'string' || !same(row, { _id: id, company, stockOperationProtocol: 2, action: 'STOCK_PLAN_FRAGMENT',
          operationId: key, attempt: manifest.attempt, index, payload: row.payload, payloadHash: hash(row.payload) })
        || utf8Bytes(stringify(row)) > recordBudgetBytes) throw Error('Fragment integrity conflict');
      parts.push(row.payload); payloadBytes += ref.bytes;
      if (payloadBytes > maxPlanBytes) throw Error('Segmented plan byte policy');
    }
    const payload = parts.join('');
    if (manifest.planBytes !== utf8Bytes(payload) || manifest.planHash !== hash(payload)) throw Error('Plan hash conflict');
    const parsed = JSON.parse(payload), normalized = normalize(parsed, key, fragments.map(row => row._id));
    if (!same(parsed, normalized) || JSON.stringify(parsed) !== payload || manifest.writeCount !== normalized.writes.length) throw Error('Prepared plan changed');
    const expected = { _id: key, company, stockOperationProtocol: 2, action: 'STOCK_PLAN_MANIFEST', digest,
      memberId, requestId, attempt: manifest.attempt, baseGeneration: manifest.baseGeneration,
      planHash: manifest.planHash, planBytes: manifest.planBytes, writeCount: manifest.writeCount, fragments: manifest.fragments };
    if (!same(manifest, expected)) throw Error('Manifest fields conflict');
    return normalized;
  }
  return { encode, decode, normalize, ids: { journal, lockId, controlId }, policy: { recordBudgetBytes, maxPlanBytes, maxWrites, maxFragments } };
}
return { createSegmentedPlanCodec, utf8Bytes, same, copy };
})();
const { classifyPurchaseDeletionImage } = (() => {
// Pure original image checks only. Safe to bundle in READ-ONLY recovery without
// importing file services, mutation protocols or original business writers.
function pendingImage(before,prepared,requestId){
 const document=before?.details?.documents?.find(doc=>doc.fileId===prepared?.document?.fileId),event=prepared?.event;
 if(!before?._version||!document||!same(document,prepared.document)||!same(before.details.taskIds,prepared.taskIds)
  ||prepared.expected!==hash(before)||!event?.actorStaffId||!event.actor||event.action!=='SUPPLIER_DOCUMENT_DELETED'||event.result!=='SAVED'
  ||!event.message||!Number.isFinite(Date.parse(prepared.startedAt))||Object.hasOwn(event,'time')
  ||!same(prepared.trash,{action:'TRASH',company:before.company,poId:before._id,fileId:document.fileId,sha256:document.sha256,name:document.name,type:document.type}))throw Error('Original Purchase pending deletion contract required');
 const deletion={requestId,fileId:document.fileId,by:event.actor,byStaffId:event.actorStaffId,at:prepared.startedAt};
 return{...copy(before),details:{...copy(before.details),documentDeletion:deletion,documents:before.details.documents.map(doc=>doc.fileId===document.fileId?{...copy(doc),linked:false,deletion:{...deletion,state:'PENDING'}}:copy(doc))}};
}
function finalImage(pending,prepared,at){
 if(typeof at!=='string'||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw Error('Original Purchase deletion completion time required');
 const event={...copy(prepared.event),time:at};
 return{...copy(pending),_version:hash(pending._version,'PURCHASE_FILE_DELETED',at),details:{...copy(pending.details),documentDeletion:null,updatedAt:at,
  documents:pending.details.documents.map(doc=>doc.fileId===prepared.document.fileId?{...copy(doc),linked:false,deletion:{...copy(doc.deletion),state:'DELETED',at}}:copy(doc)),
  audit:[...(copy(pending.details.audit||[])),event]}};
}
function deletionPlan(change,key){
 const metadata=change?.purchaseDeletion,prepared=metadata?.prepared,before=change?.before,after=change?.after;
 if(change?.collection!=='PurchaseOrders'||!metadata||!same(Object.keys(metadata).sort(),['prepared','requestId'])
  ||!/^[a-f0-9-]{36}$/i.test(metadata.requestId||'')||before?._id!==after?._id||before?.company!==after?.company)throw Error('Exact original Purchase unlink plan required');
 const expected=pendingImage(before,prepared,metadata.requestId);expected._version=hash(key,'PurchaseOrders',after._id);
 if(!same(expected,after))throw Error('Original Purchase unlink image changed');return prepared;
}
// Evidence classification never authorizes a callback, unlock or write.
function classifyPurchaseDeletionImage(change,current,key){
 try{const prepared=deletionPlan(change,key);if(same(current,change.after))return'PENDING_UNLINK';
  const matches=(current?.details?.audit||[]).filter(event=>event.id===prepared.event.id);
  return matches.length===1&&same(current,finalImage(change.after,prepared,matches[0].time))?'FILE_DELETE_COMPLETED':null;
 }catch(_){return null;}
}
return {pendingImage,finalImage,deletionPlan,classifyPurchaseDeletionImage};
})();
const { inspectSegmentedStockRecovery } = (() => {
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
    completeInspection: false, receiptVerified: false, currentImagesVerified: false, recoveryPerformed: false };
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
    else {
      packet.receiptVerified = true;
      const allAfter = packet.images.every(i => ['AFTER','FILE_DELETE_COMPLETED'].includes(i.image));
      // A durable receipt is not proof that today's inspected rows still match.
      // Exact BEFORE is a valid resume image only BEFORE a RESULT exists.
      if ((control.pending || control.generation === result.outcome.generation) && !allAfter) status = 'REVIEW_RESULT_IMAGES';
      else if (control.pending) status = control.generation !== result.baseGeneration || control.pending.phase !== 'FINALIZE'
        ? 'REVIEW_RESULT_BARRIER' : !packet.completeInspection ? 'PAGED_RESULT_INSPECTION_ONLY' : 'SAME_REQUEST_RECHECK_RESULT';
      else status = control.generation < result.outcome.generation ? 'REVIEW_RESULT_GENERATION'
        : control.generation === result.outcome.generation && !packet.completeInspection ? 'PAGED_RESULT_INSPECTION_ONLY' : 'CONFIRMED_RESULT';
      packet.currentImagesVerified = packet.completeInspection && allAfter
        && ['CONFIRMED_RESULT','SAME_REQUEST_RECHECK_RESULT'].includes(status);
    }
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
return { inspectSegmentedStockRecovery };
})();
const { inspectStockRecovery } = (() => {
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
return { inspectStockRecovery };
})();
// Administrator-only READ: no deletes, retries, uploads, mode changes or business saves.
export const inspectStockSave = webMethod(Permissions.Admin, async request => {
  try {
    if (!request || Object.keys(request).some(k => !['company', 'requestId', 'memberId', 'input', 'pageSize', 'cursor'].includes(k))
      || typeof request.memberId !== 'string' || request.memberId.length > 128 || !Object.hasOwn(request, 'input')
      || Buffer.byteLength(JSON.stringify(request), 'utf8') > 180000) throw Error('Bounded original save identity required');
    const { company, requestId, memberId, input, pageSize, cursor } = request;
    const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    // Exact original journal/order/task Date fields inspected in MASTER CMS.
    const store = createRecoveryReadStore({ items, company, dateTimeFields: { [journal]: ['activityTime'], [company==='NCT'?'NCTOrders':'NCTOrders1']:['estimatedShipmentDate','masterReceivedTime','salesSubmissionTime'], [company==='NCT'?'NCTTasks':'NCTTasks1']:['lastCostCaptureTime'] } });
    return { ok: true, report: await inspectStockRecovery({ store, company, requestId, memberId, input, domainWrites: true, pageSize, cursor }) };
  } catch (_) {
    return { ok: false, error: 'Inventory recovery inspection unavailable. No recovery performed.' };
  }
});
