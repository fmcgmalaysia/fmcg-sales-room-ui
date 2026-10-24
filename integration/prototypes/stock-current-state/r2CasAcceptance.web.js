import { items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { createHash, randomBytes } from 'crypto';
const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const randomUUID=()=>randomBytes(16).toString('hex');
const {planCollections}=(()=>{

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

return {planCollections};
})();
const {createSdkFieldCodec}=(()=>{

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

return {createSdkFieldCodec};
})();
const {createSdkConditionalStore}=(()=>{

// Candidate adapter only. Caller supplies authorized company and explicit collection scope.
// Not imported by production. Verified SDK1.0.528 uses plain WQL conditions, not Filter().
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);

function createSdkConditionalStore({ items, company, collections, dateTimeFields = {} }) {
  if (!['NCT', 'GHR'].includes(company) || !Array.isArray(collections) || !collections.length
    || collections.some(name => typeof name !== 'string' || !name)
    || !items || ['query', 'insert', 'patch', 'remove'].some(method => typeof items[method] !== 'function')) {
    throw Error('Explicit conditional store scope required');
  }
  const allowed = new Set(collections);
  const fieldCodec = createSdkFieldCodec({ collections, dateTimeFields });
  function scope(collection, id) {
    if (!allowed.has(collection) || typeof id !== 'string' || !id) throw Error('Storage scope violation');
  }
  function normalize(collection, row) {
    if (!row) return null;
    if (row.company !== company) throw Error('Storage company conflict');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (!metadata.has(key) && key !== 'stockCommitVersion') result[key] = fieldCodec.decode(collection, key, value);
    }
    if (own(row, 'stockCommitVersion')) result._version = row.stockCommitVersion;
    return result;
  }
  function encode(collection, row) {
    if (!row || row.company !== company || own(row, 'stockCommitVersion')
      || Object.keys(row).some(key => metadata.has(key))) throw Error('Invalid owned storage image');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== '_version') result[key] = fieldCodec.encode(collection, key, value);
    }
    if (own(row, '_version')) {
      if (typeof row._version !== 'string' || !row._version) throw Error('Storage version required');
      result.stockCommitVersion = row._version;
    }
    return result;
  }
  async function read(collection, id) {
    scope(collection, id);
    // Exact bounded query distinguishes missing from any permission/network/query failure.
    const page = await items.query(collection).eq('_id', id).limit(2).find({ consistentRead: true });
    if (!Array.isArray(page?.items) || page.items.length > 1) throw Error('Invalid exact storage read');
    return normalize(collection, page.items[0] || null);
  }
  // Server-only exact IDs within ONE caller-owned readSnapshot. No persistent
  // cache or write/verify reuse. Fifty is our request policy, not a claimed Wix
  // hasSome capacity. Missing is returned only after a complete strong result.
  async function readMany(collection, ids) {
    if (!allowed.has(collection) || !Array.isArray(ids) || ids.length > 2000
      || new Set(ids).size !== ids.length) throw Error('Bounded distinct storage IDs required');
    const requested = [...ids];
    for (const id of requested) scope(collection, id);
    const found = new Map();
    for (let offset = 0; offset < requested.length; offset += 50) {
      const batch = requested.slice(offset, offset + 50), expected = new Set(batch);
      // Match read(): do not hide a foreign row behind a company filter and
      // misreport an occupied exact ID as absent. normalize rejects that row.
      const page = await items.query(collection).hasSome('_id', batch)
        .limit(batch.length + 1).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0
        || page.totalCount > batch.length || page.items.length !== page.totalCount) throw Error('Incomplete exact storage batch');
      for (const row of page.items) {
        if (!expected.has(row?._id) || found.has(row._id)) throw Error('Exact storage batch identity conflict');
        found.set(row._id, normalize(collection, row));
      }
    }
    return requested.map(id => found.get(id) || null);
  }
  async function insert(collection, row) {
    scope(collection, row?._id);
    return normalize(collection, await items.insert(collection, encode(collection, row)));
  }
  async function compareAndSet(collection, id, expectedVersion, after) {
    scope(collection, id);
    if (typeof expectedVersion !== 'string' || !expectedVersion || after?._id !== id
      || !after._version || after._version === expectedVersion) throw Error('Fresh conditional version required');
    const current = await read(collection, id);
    if (!current || current._version !== expectedVersion) throw Error('Storage version conflict');
    const beforePayload = encode(collection, current), afterPayload = encode(collection, after);
    let patch = items.patch(collection, id);
    for (const key of Object.keys(beforePayload)) {
      if (key !== '_id' && !own(afterPayload, key)) patch = patch.removeField(key);
    }
    for (const [key, value] of Object.entries(afterPayload)) {
      if (key !== '_id') patch = patch.setField(key, value);
    }
    return normalize(collection, await patch.run({ condition: { company: { $eq: company }, stockCommitVersion: { $eq: expectedVersion } } }));
  }
  async function compareAndRemove(collection, id, expectedAttempt) {
    scope(collection, id);
    if (typeof expectedAttempt !== 'string' || !expectedAttempt) throw Error('Execution identity required');
    return normalize(collection, await items.remove(collection, id, {
      condition: { company: { $eq: company }, attempt: { $eq: expectedAttempt } }
    }));
  }
  // Private server-read boundary for rows ALREADY returned by the original paged
  // table reader. Same codec/ownership/version normalization, no extra per-row
  // SDK request and no new write capability. Not an authority for browser rows.
  function normalizeListedRow(collection, row) {
    scope(collection, row?._id);
    const companyLock = collection === (company === 'NCT' ? 'NCTActivity' : 'NCTActivity1')
      && row._id === hash(company+'/PURCHASE','LOCK') && typeof row.owner === 'string' && row.owner
      && typeof row.attempt === 'string' && row.attempt && !row.action && !row.details && !own(row,'stockCommitVersion');
    // Attempt-scoped protocol locks are intentionally unversioned; only that exact
    // reserved identity may use the same metadata normalization without a version.
    if (!companyLock && (typeof row.stockCommitVersion !== 'string' || !row.stockCommitVersion)) throw Error('Listed current row requires migrated version');
    return normalize(collection, row);
  }
  return { read, readMany, insert, compareAndSet, compareAndRemove, normalizeListedRow };
}


return {createSdkConditionalStore};
})();
const {createSegmentedPlanCodec,same,copy}=(()=>{

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

return {createSegmentedPlanCodec,same,copy};
})();
const {createSegmentedFencedProof}=(()=>{

// OFFLINE v2 candidate. Same company fence/CAS contract as v1, no live endpoint.
// Runtime/staging budgets still require actual platform acceptance before activation.
function createSegmentedFencedProof({ store, company = 'NCT', newAttempt = randomUUID,
  domainWrites = false, codecPolicy = {}, stepsPerInvocation = 20, maxStagedFragments = 32,
  coordination = 'EXCLUSIVE_LOCK', batchApplyReads = false }) {
  for (const method of ['read', 'insert', 'compareAndSet', 'compareAndRemove']) {
    if (typeof store?.[method] !== 'function') throw Error('Conditional storage required');
  }
  if (!Number.isSafeInteger(stepsPerInvocation) || stepsPerInvocation < 1
    || !Number.isSafeInteger(maxStagedFragments) || maxStagedFragments < 1
    || !['EXCLUSIVE_LOCK', 'CONTROL_CAS_CANDIDATE'].includes(coordination)
    || typeof batchApplyReads !== 'boolean') throw Error('Bounded execution policy required');
  const codec = createSegmentedPlanCodec({ ...codecPolicy, company, domainWrites });
  const { journal, lockId, controlId } = codec.ids, scope = company + '/PURCHASE';
  async function readControl() {
    const row = await store.read(journal, controlId);
    if (!row || row.company !== company || !row._version || !Number.isSafeInteger(row.generation) || row.generation < 0) throw Error('Control missing or invalid');
    return row;
  }
  async function initialize() { await store.insert(journal, { _id: controlId, company, generation: 0, pending: null, _version: 'GENESIS' }); }
  async function writeExpected(collection, before, after) {
    try {
      if (before) await store.compareAndSet(collection, after._id, before._version, copy(after));
      else await store.insert(collection, copy(after));
    } catch (error) {
      if (!same(await store.read(collection, after._id), after)) throw error;
    }
  }
  async function transition(collection, before, after) {
    await writeExpected(collection, before, after);
    if (!same(await store.read(collection, after._id), after)) throw Error('Conditional write unconfirmed');
  }
  const nextControl = (before, fields) => ({ ...before, ...fields, _version: hash(before._version, fields) });
  async function readImages(collection, ids) {
    // Same complete exact-ID adapter already used during preparation. A failed
    // or malformed batch NEVER falls back to individual queries or partial rows.
    const rows = [];
    if (typeof store.readMany === 'function') rows.push(...await store.readMany(collection, ids));
    else for (const id of ids) rows.push(await store.read(collection, id));
    if (rows.length !== ids.length || rows.some((row, index) => row !== null
      && (!row || row._id !== ids[index] || row.company !== company))) throw Error('Exact complete image batch required');
    return rows;
  }
  async function readSnapshot(readRows) {
    const before = await readControl();
    if (before.pending) throw Error('Inventory pending');
    const rows = await readRows(copy(before)), after = await readControl();
    if (after.pending || before._version !== after._version) throw Error('Inventory changed during read');
    return { generation: after.generation, rows };
  }
  async function commit({ requestId, memberId, input, prepare, validate = () => {}, authorize = () => {} }) {
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || typeof memberId !== 'string' || !memberId
      || typeof prepare !== 'function' || typeof validate !== 'function' || typeof authorize !== 'function') throw Error('Operation identity required');
    const key = hash(scope, requestId, memberId), digest = hash(input), resultId = hash(key, 'RESULT'), attempt = newAttempt();
    if (typeof attempt !== 'string' || !attempt) throw Error('Attempt identity required');
    // Default deployed candidate retains its original lock contract. The opt-in
    // LOCAL review policy coordinates through the existing conditional control
    // transition; it never touches, releases or adopts a native UNKNOWN lock.
    const exclusive = coordination === 'EXCLUSIVE_LOCK';
    if (exclusive) await store.insert(journal, { _id: lockId, company, owner: key, attempt });
    try {
      let control = await readControl();
      if (control.pending && (control.pending.key !== key || control.pending.digest !== digest)) throw Error('Prior inventory save pending');
      const prior = await store.read(journal, resultId);
      let manifest = await store.read(journal, key);
      if (manifest && manifest.digest !== digest) throw Error('Request identity reused');
      if (manifest && (manifest.company !== company || manifest._id !== key
        || manifest.memberId !== memberId || manifest.requestId !== requestId || manifest.stockOperationProtocol !== 2
        || !Number.isSafeInteger(manifest.baseGeneration) || manifest.baseGeneration < 0)) throw Error('Operation manifest identity conflict');
      if (prior && (!manifest || prior.company !== company || prior._id !== resultId || prior.digest !== digest
        || prior.baseGeneration !== manifest.baseGeneration || prior.stockOperationProtocol !== 2
        || prior.outcome?.ok !== true || prior.outcome.operationId !== key
        || prior.outcome.generation !== manifest.baseGeneration + 1
        || !control.pending && control.generation < prior.outcome.generation)) throw Error('Operation result requires review');
      await authorize(copy({ control, key, digest, replay: !!manifest, baseGeneration: manifest?.baseGeneration ?? control.generation }));
      if (prior) {
        if (control.pending) {
          if (control.generation !== manifest.baseGeneration || control.pending.planHash !== manifest.planHash
            || control.pending.phase !== 'FINALIZE' || control.pending.cursor !== manifest.writeCount) throw Error('Result generation conflict');
          await transition(journal, control, nextControl(control, { generation: manifest.baseGeneration + 1, pending: null }));
        }
        return copy(prior.outcome);
      }
      if (!manifest) {
        if (control.pending) throw Error('Pending manifest missing');
        if (!Number.isSafeInteger(control.generation + 1)) throw Error('Inventory generation exhausted');
        const encoded = codec.encode({ key, digest, memberId, requestId, attempt, baseGeneration: control.generation, plan: await prepare() });
        // Refuse before staging, never silently truncate or pretend this is a measured
        // production limit. All fragments must be durable before unique root insert.
        if (encoded.fragments.length > maxStagedFragments) throw Error('Staging capacity requires review');
        for (const fragment of encoded.fragments) await transition(journal, null, fragment);
        manifest = encoded.manifest;
        await transition(journal, null, manifest);
      }
      if (manifest.baseGeneration !== control.generation) throw Error('Prepared generation stale');
      if (!Array.isArray(manifest.fragments) || manifest.fragments.length > maxStagedFragments) throw Error('Manifest capacity conflict');
      const fragments = await readImages(journal, manifest.fragments.map(ref => ref.id));
      const plan = codec.decode({ manifest, fragments, key, digest, memberId, requestId });
      const count = plan.writes.length;
      if (!control.pending) {
        const pending = { key, digest, planHash: manifest.planHash, phase: 'BEFORE', cursor: 0, count };
        const next = nextControl(control, { pending }); await transition(journal, control, next); control = next;
      }
      const p = control.pending;
      if (p.planHash !== manifest.planHash || p.count !== count || !['BEFORE', 'APPLY', 'VERIFY', 'FINALIZE'].includes(p.phase)
        || !Number.isSafeInteger(p.cursor) || p.cursor < 0 || p.cursor > count
        || p.phase === 'FINALIZE' && p.cursor !== count) throw Error('Pending progress conflict');
      let phase = p.phase, cursor = p.cursor, steps = 0;
      while (steps < stepsPerInvocation && phase !== 'FINALIZE') {
        if (cursor === count) {
          phase = phase === 'BEFORE' ? 'APPLY' : phase === 'APPLY' ? 'VERIFY' : 'FINALIZE'; cursor = phase === 'FINALIZE' ? count : 0;
          // Persist phase boundary BEFORE any following-phase action. Particularly,
          // an interrupted APPLY cannot accidentally re-enter BEFORE verification.
          const next = nextControl(control, { pending: { ...p, phase, cursor } });
          await transition(journal, control, next); control = next;
          continue;
        }
        if (phase !== 'APPLY' && typeof store.readMany === 'function') {
          const span = plan.writes.slice(cursor, cursor + Math.min(count - cursor, stepsPerInvocation - steps));
          const groups = new Map(), found = new Map();
          for (const change of span) {
            if (!groups.has(change.collection)) groups.set(change.collection, []);
            groups.get(change.collection).push(change.after._id);
          }
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), phase === 'BEFORE' ? change.before : change.after)) {
            throw Error(phase === 'BEFORE' ? 'Prepared before-image stale' : 'Final image conflict');
          }
          cursor += span.length; steps += span.length;
          continue;
        }
        if (phase === 'APPLY' && batchApplyReads && typeof store.readMany === 'function') {
          const span = plan.writes.slice(cursor, cursor + Math.min(count - cursor, stepsPerInvocation - steps));
          const groups = new Map(), found = new Map();
          for (const change of span) {
            if (!groups.has(change.collection)) groups.set(change.collection, []);
            groups.get(change.collection).push(change.after._id);
          }
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) {
            const current = found.get(change.collection + '/' + change.after._id);
            if (!same(current, change.before) && !same(current, change.after)) throw Error('Write version conflict');
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), change.after)) {
            await writeExpected(change.collection, change.before, change.after);
          }
          // Exact complete strong readback precedes the durable cursor. A failed
          // batch or partial write leaves the original checkpoint unchanged.
          for (const [collection, ids] of groups) {
            const rows = await readImages(collection, ids);
            ids.forEach((id, index) => found.set(collection + '/' + id, rows[index]));
          }
          for (const change of span) if (!same(found.get(change.collection + '/' + change.after._id), change.after)) throw Error('Conditional batch write unconfirmed');
          cursor += span.length; steps += span.length;
          continue;
        }
        const change = plan.writes[cursor], current = await store.read(change.collection, change.after._id);
        if (phase === 'BEFORE') {
          if (!same(current, change.before)) throw Error('Prepared before-image stale');
        } else if (phase === 'APPLY') {
          if (!same(current, change.after)) {
            if (!same(current, change.before)) throw Error('Write version conflict');
            await transition(change.collection, change.before, change.after);
          }
        } else if (!same(current, change.after)) throw Error('Final image conflict');
        cursor++; steps++;
      }
      // Checkpoint may lag completed row writes after an interruption; replay checks
      // exact after-images, not blind increments. Never advances before row confirms.
      if (phase !== control.pending.phase || cursor !== control.pending.cursor) {
        const next = nextControl(control, { pending: { ...p, phase, cursor } });
        await transition(journal, control, next); control = next;
      }
      if (phase !== 'FINALIZE') return { ok: false, pending: true, phase, completedCount: cursor, totalRecords: count, requestId };
      await validate(copy(plan));
      const outcome = { ok: true, operationId: key, generation: manifest.baseGeneration + 1 };
      await transition(journal, null, { _id: resultId, company, stockOperationProtocol: 2, digest, baseGeneration: manifest.baseGeneration, outcome });
      await transition(journal, control, nextControl(control, { generation: manifest.baseGeneration + 1, pending: null }));
      return outcome;
    } finally {
      if (exclusive) await store.compareAndRemove(journal, lockId, attempt);
    }
  }
  return { initialize, readControl, readSnapshot, commit, ids: codec.ids, planFormat: 'SEGMENTED_V2' };
}

return {createSegmentedFencedProof};
})();
// Fixed, nonbusiness native acceptance. Distinct from both stopped lock tests.
// No deletion, old-prefix access, activation or business-table capability exists.
async function verifyR2CasAcceptance({items,createSdkConditionalStore,createSegmentedFencedProof,hash,copy,same,input,enabled=false,now=()=>Date.now()}) {
 if(!input||Array.isArray(input)||Object.keys(input).length!==1||!['SEED','ADVANCE','FAULT','INSPECT','REPLAY'].includes(input.step))throw Error('Fixed R2 CAS test step required');
 const started=now(),counts={queries:0,inserts:0,patches:0,deletes:0},prefix='SPT-R2CAS-20261024-6d31:',collection='StockProtocolTest',company='NCT',journal='NCTActivity';
 let mutationAttempted=false,stage='PREFLIGHT';
 const report=(ok,extra={})=>({ok,schema:'R2_CAS_NATIVE_ACCEPTANCE_V1',step:input.step,stage,elapsedMs:now()-started,
  operationsAttempted:{...counts},mutationAttempted,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,
  originalBusinessCollectionsAccepted:false,productionCapacityAccepted:false,activationReady:false,...extra});
 if(!enabled){stage='CLOSED';return report(false,{blocked:true});}
 const address=(name,id)=>{if(![journal,'StockPositions'].includes(name)||typeof id!=='string'||!id)throw Error('Fixed logical test scope');return prefix+name+':'+id;};
 const bounded={query:name=>{if(name!==collection||++counts.queries>100)throw Error('Query budget');return items.query(name);},
  insert:async(name,row)=>{if(name!==collection||!row?._id?.startsWith(prefix)||++counts.inserts>24)throw Error('Insert scope/budget');mutationAttempted=true;return items.insert(name,row);},
  patch:(name,id)=>{if(name!==collection||!id?.startsWith(prefix)||++counts.patches>14)throw Error('Patch scope/budget');mutationAttempted=true;return items.patch(name,id);},
  remove:()=>{throw Error('NO_DELETE_CAPABILITY');}};
 const raw=createSdkConditionalStore({items:bounded,company,collections:[collection]});
 const decode=(name,id,row)=>{if(!row)return null;if(row._id!==address(name,id))throw Error('Test image identity');return{...row,_id:id};};
 const store={read:async(name,id)=>decode(name,id,await raw.read(collection,address(name,id))),
  readMany:async(name,ids)=>(await raw.readMany(collection,ids.map(id=>address(name,id)))).map((row,index)=>decode(name,ids[index],row)),
  insert:async(name,row)=>decode(name,row._id,await raw.insert(collection,{...row,_id:address(name,row._id)})),
  compareAndSet:async(name,id,version,row)=>{if(row?._id!==id)throw Error('Exact test image');return decode(name,id,await raw.compareAndSet(collection,address(name,id),version,{...row,_id:address(name,id)}));},
  compareAndRemove:()=>{throw Error('NO_LOCK_REMOVAL_CAPABILITY');}};
 const options={company,coordination:'CONTROL_CAS_CANDIDATE',batchApplyReads:true,stepsPerInvocation:10},protocol=createSegmentedFencedProof({...options,store});
 const seeds=Array.from({length:20},(_,index)=>({_id:'CAS-S'+index,company,onHand:100,_version:'CAS-INITIAL-'+index}));
 const genesis={_id:protocol.ids.controlId,company,generation:0,pending:null,_version:'GENESIS'};
 const requestId='6d310000-1111-4111-8111-111111111111',memberId='FIXED-R2-CAS-TEST',requestInput={receipt:10},key=hash(company+'/PURCHASE',requestId,memberId);
 const expected=seeds.map(row=>({...row,onHand:110,_version:hash(key,'StockPositions',row._id)}));
 const request={requestId,memberId,input:requestInput,prepare:async()=>({writes:seeds.map(before=>({collection:'StockPositions',before:copy(before),after:{...before,onHand:110}}))})};
 try{
  const lock=await store.read(journal,protocol.ids.lockId);if(lock)throw Error('Unexpected company lock; never remove');
  if(input.step==='SEED'){
   stage='FRESH_TEST_ONLY';
   const control=await store.read(journal,protocol.ids.controlId),manifest=await store.read(journal,key),result=await store.read(journal,hash(key,'RESULT'));
   if(control||manifest||result||(await store.readMany('StockPositions',seeds.map(row=>row._id))).some(Boolean))throw Error('Occupied test, no reset or adoption');
   await protocol.initialize();for(const row of seeds)await store.insert('StockPositions',row);
   if(!same(await store.readMany('StockPositions',seeds.map(row=>row._id)),seeds)||!same(await protocol.readControl(),genesis))throw Error('Seed readback unconfirmed');
   stage='SEEDED';return report(true,{seeded:20,generation:0});
  }
  const control=await protocol.readControl();
  if(Object.hasOwn(control,'mode')||control.generation>1)throw Error('Nonbusiness fixed control only');
  if(input.step==='INSPECT'){
   stage='READ_ONLY_INSPECTION';const rows=await store.readMany('StockPositions',seeds.map(row=>row._id));
   if(control.pending){let blocked=false;try{await protocol.readSnapshot(()=>[]);}catch(error){blocked=error.message==='Inventory pending';}
    if(!blocked)throw Error('Read barrier missing');
    if(rows.some((row,index)=>!same(row,seeds[index])&&!same(row,expected[index])))throw Error('Unexpected partial image');
    return report(true,{generation:0,pending:copy(control.pending),applied:rows.filter((row,index)=>same(row,expected[index])).length,mixedReadBlocked:true});}
   if(control.generation!==1||!same(rows,expected))throw Error('Final twenty images unconfirmed');
   const receipt=await store.read(journal,hash(key,'RESULT'));
   if(receipt?.outcome?.ok!==true||receipt.outcome.generation!==1||receipt.outcome.operationId!==key)throw Error('Durable result unconfirmed');
   const snapshot=await protocol.readSnapshot(()=>store.readMany('StockPositions',seeds.map(row=>row._id)));
   if(snapshot.generation!==1||!same(snapshot.rows,expected))throw Error('Final snapshot unconfirmed');
   return report(true,{generation:1,pending:null,verifiedImages:20,totalOnHand:2200,resultCount:1,noLockCreated:true});
  }
  if(input.step==='REPLAY'?control.generation!==1||control.pending:control.generation!==0)throw Error('Exact operation phase required');
  let writes=0,injected=false;
  const executionStore=input.step==='FAULT'?{...store,compareAndSet:async(name,id,version,row)=>{
   if(name==='StockPositions'){if(writes===3){injected=true;throw Error('KNOWN_R2_CAS_INTERRUPTION');}writes++;}
   return store.compareAndSet(name,id,version,row);}}:store;
  if(input.step==='FAULT'&&(!control.pending||!(control.pending.phase==='APPLY'&&control.pending.cursor===0
   ||control.pending.phase==='BEFORE'&&control.pending.cursor===20)))throw Error('Exact first APPLY boundary required');
  stage='EXECUTING';let outcome;
  try{outcome=await createSegmentedFencedProof({...options,store:executionStore}).commit(request);}
  catch(error){if(!injected||error.message!=='KNOWN_R2_CAS_INTERRUPTION')throw error;
   const checkpoint=await protocol.readControl();
   if(checkpoint.generation!==0||checkpoint.pending?.key!==control.pending.key||checkpoint.pending?.phase!=='APPLY'||checkpoint.pending.cursor!==0||writes!==3)throw Error('Partial cursor changed');
   const rows=await store.readMany('StockPositions',seeds.map(row=>row._id));
   if(!same(rows,expected.slice(0,3).concat(seeds.slice(3))))throw Error('Exact three partial images unconfirmed');
   stage='KNOWN_INTERRUPTION_CONFIRMED';return report(true,{applied:3,pending:copy(checkpoint.pending),cursorUnchanged:true,noLockCreated:true});}
  const after=await protocol.readControl();
  if(await store.read(journal,protocol.ids.lockId))throw Error('Unexpected lock created');
  stage=input.step==='REPLAY'?'COMPLETED_REPLAY':'CHECKPOINT_CONFIRMED';
  return report(true,{outcome,control:{generation:after.generation,pending:after.pending},noLockCreated:true});
 }catch(error){return report(false,{error:error.message,retainRequest:true,noAutomaticRetryResetOrCleanup:true});}
}

const NATIVE_R2_CAS_ACCEPTANCE_ENABLED=false;
export const verifyR2Cas=webMethod(Permissions.Admin,input=>verifyR2CasAcceptance({items,createSdkConditionalStore,createSegmentedFencedProof,hash,copy,same,input,enabled:NATIVE_R2_CAS_ACCEPTANCE_ENABLED}));
