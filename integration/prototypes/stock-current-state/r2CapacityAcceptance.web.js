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
  domainWrites = false, codecPolicy = {}, stepsPerInvocation = 20, maxStagedFragments = 32 }) {
  for (const method of ['read', 'insert', 'compareAndSet', 'compareAndRemove']) {
    if (typeof store?.[method] !== 'function') throw Error('Conditional storage required');
  }
  if (!Number.isSafeInteger(stepsPerInvocation) || stepsPerInvocation < 1
    || !Number.isSafeInteger(maxStagedFragments) || maxStagedFragments < 1) throw Error('Bounded execution policy required');
  const codec = createSegmentedPlanCodec({ ...codecPolicy, company, domainWrites });
  const { journal, lockId, controlId } = codec.ids, scope = company + '/PURCHASE';
  async function readControl() {
    const row = await store.read(journal, controlId);
    if (!row || row.company !== company || !row._version || !Number.isSafeInteger(row.generation) || row.generation < 0) throw Error('Control missing or invalid');
    return row;
  }
  async function initialize() { await store.insert(journal, { _id: controlId, company, generation: 0, pending: null, _version: 'GENESIS' }); }
  async function transition(collection, before, after) {
    try {
      if (before) await store.compareAndSet(collection, after._id, before._version, copy(after));
      else await store.insert(collection, copy(after));
    } catch (error) {
      if (!same(await store.read(collection, after._id), after)) throw error;
    }
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
    // Unknown acquisition is never stolen or auto-removed, including a lost reply.
    await store.insert(journal, { _id: lockId, company, owner: key, attempt });
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
      await store.compareAndRemove(journal, lockId, attempt);
    }
  }
  return { initialize, readControl, readSnapshot, commit, ids: codec.ids, planFormat: 'SEGMENTED_V2' };
}

return {createSegmentedFencedProof};
})();
const retainedSource={"schema":"STOCK_NATIVE_300_COMMIT_SOURCE_V1","company":"NCT","key":"b8a26bd03216afb6d10c5e2438ec9f81","digest":"641a68df2c62e323b169d6c41d4e1f05","memberId":"M","requestId":"11111111-1111-4111-8111-111111111111","planHash":"79d177a3ccd56f4672d5656f05834bc6","planBytes":596928,"logicalIds":["94f763baecabf7ec053887b7837abc28","b0e93b3d66b4eae21eda79ffe600f7a2","b16358bd1247bb63703e7c254f2d1f83","81cef2e5d237a4ba78e2141968b4e9c0","09aabc3b9494558928b4d0cd4f7eb1ef","08bd62785b1c4ac91c59fb6b465e90f2","995a470c013d36421c5a5bedb8cb7a44","31c0f31ebc3864ba0f9fdb30c74cdcd6","527b60446fd3c0682751a403c82f6d08","143d37697a96866b957868e742fd3e58","71a6553b7a180bb594f19107a709cb4a","b8a26bd03216afb6d10c5e2438ec9f81"],"physicalIds":["SPT-STAGE300-20261023-a32d:94f763baecabf7ec053887b7837abc28","SPT-STAGE300-20261023-a32d:b0e93b3d66b4eae21eda79ffe600f7a2","SPT-STAGE300-20261023-a32d:b16358bd1247bb63703e7c254f2d1f83","SPT-STAGE300-20261023-a32d:81cef2e5d237a4ba78e2141968b4e9c0","SPT-STAGE300-20261023-a32d:09aabc3b9494558928b4d0cd4f7eb1ef","SPT-STAGE300-20261023-a32d:08bd62785b1c4ac91c59fb6b465e90f2","SPT-STAGE300-20261023-a32d:995a470c013d36421c5a5bedb8cb7a44","SPT-STAGE300-20261023-a32d:31c0f31ebc3864ba0f9fdb30c74cdcd6","SPT-STAGE300-20261023-a32d:527b60446fd3c0682751a403c82f6d08","SPT-STAGE300-20261023-a32d:143d37697a96866b957868e742fd3e58","SPT-STAGE300-20261023-a32d:71a6553b7a180bb594f19107a709cb4a","SPT-STAGE300-20261023-a32d:b8a26bd03216afb6d10c5e2438ec9f81"]};
// Isolated native rehearsal of the EXACT segmented executor, not business auth.
// A separate compiled server gate defaults CLOSED for conditional lock deletion.
async function verifyNative300Commit({items,createSdkConditionalStore,createSegmentedPlanCodec,createSegmentedFencedProof,
 same,copy,hash,source,input,newAttempt,allowConditionalLockRelease=false,now=()=>Date.now()}){
 const steps=['SEED','INSPECT','ADVANCE','INTERRUPT_APPLY','REPLAY_COMPLETED'];
 if(!input||typeof input!=='object'||Array.isArray(input)||!steps.includes(input.step)
  ||Object.keys(input).some(key=>!['step',...(input.step==='SEED'?['batch']:[])].includes(key))
  ||input.step==='SEED'&&(!Number.isSafeInteger(input.batch)||input.batch<0||input.batch>=15)
  ||typeof newAttempt!=='function'||typeof allowConditionalLockRelease!=='boolean'
  ||source?.schema!=='STOCK_NATIVE_300_COMMIT_SOURCE_V1')throw Error('Fixed native300 test input required');
 const collection='StockProtocolTest',prefix='SPT-R2CAPACITY-20261024-9e72:',company='NCT',journal='NCTActivity';
 const started=now(),counts={queries:0,inserts:0,patches:0,deletes:0};let stage='PREFLIGHT',mutationAttempted=false;
 const report=(ok,extra={})=>({ok,schema:'STOCK_NATIVE_300_COMMIT_V1',stage,step:input.step,operationsAttempted:{...counts},
  mutationAttempted,elapsedMs:now()-started,recordRetentionPolicy:'RETAIN_ALL_NONLOCK_TEST_RECORDS',
  originalBusinessCollectionsAccepted:false,wholeBusinessPreparationAccepted:false,productionCapacityAccepted:false,activationReady:false,...extra});
 // These mutation-capable steps are rejected before storage when no exact native
 // lock-release grant has been compiled. A browser flag can never open the gate.
 if(['ADVANCE','INTERRUPT_APPLY','REPLAY_COMPLETED'].includes(input.step)&&!allowConditionalLockRelease){
  stage='EXACT_CONDITIONAL_TEST_LOCK_RELEASE_GRANT_REQUIRED';return report(false,{blocked:true});
 }
 const lockId=hash('NCT/PURCHASE','LOCK'),controlId=hash(company,'STOCK_CONTROL'),key=source.key,resultId=hash(key,'RESULT');
 const physicalLock=prefix+journal+':'+lockId;
 const sourceIds=new Set(source.physicalIds||[]);
 if(sourceIds.size!==12||source.company!==company||source.planBytes!==596928||source.planHash!=='79d177a3ccd56f4672d5656f05834bc6')throw Error('Exact retained native300 source required');
 const bounded={query:name=>{if(name!==collection||++counts.queries>200)throw Error('Native300 query budget');return items.query(name);},
  insert:async(name,row)=>{if(name!==collection||typeof row?._id!=='string'||!row._id.startsWith(prefix)||++counts.inserts>33)throw Error('Native300 insert scope/budget');
   mutationAttempted=true;return items.insert(name,row);},
  patch:(name,id)=>{if(name!==collection||typeof id!=='string'||!id.startsWith(prefix)||++counts.patches>30)throw Error('Native300 patch scope/budget');
   mutationAttempted=true;return items.patch(name,id);},
  remove:async(name,id,options)=>{if(!allowConditionalLockRelease||name!==collection||id!==physicalLock||++counts.deletes>1
   ||options?.condition?.company?.$eq!==company||typeof options?.condition?.attempt?.$eq!=='string'||!options.condition.attempt.$eq.startsWith('COMMIT300-'))throw Error('Exact conditional test lock release required');
   mutationAttempted=true;return items.remove(name,id,options);}};
 const raw=createSdkConditionalStore({items:bounded,company,collections:[collection],dateTimeFields:{[collection]:['activityTime']}});
 const codec=createSegmentedPlanCodec({company,domainWrites:true});
 try{
  // Read-only reuse of previously accepted retained staging evidence. This test
  // NEVER edits/adopts/resets those rows as its own operation/control/locks.
  const retained=await raw.readMany(collection,source.physicalIds);
  if(retained.some((row,index)=>!row||row._id!==source.physicalIds[index]))throw Error('Complete retained source required');
  const logical=retained.map((row,index)=>({...row,_id:source.logicalIds[index]})),manifest=logical.at(-1);
  if(manifest.planHash!==source.planHash||manifest.planBytes!==source.planBytes)throw Error('Retained source fingerprint conflict');
  const plan=codec.decode({manifest,fragments:logical.slice(0,-1),key,digest:source.digest,memberId:source.memberId,requestId:source.requestId});
  if(plan.writes.length!==901)throw Error('Exact actual300 plan required');
  const allowed=new Set(['NCTActivity','StockPositions','StockClaims','StockProducts']);
  const address=(name,id)=>{if(!allowed.has(name)||typeof id!=='string'||!id)throw Error('Fixed logical test scope');return prefix+name+':'+id;};
  const decode=(name,id,row)=>{if(!row)return null;if(row._id!==address(name,id))throw Error('Native test identity conflict');return{...row,_id:id};};
  const encode=(name,row)=>({...row,_id:address(name,row._id)});
  const store={read:async(name,id)=>decode(name,id,await raw.read(collection,address(name,id))),
   readMany:async(name,ids)=>(await raw.readMany(collection,ids.map(id=>address(name,id)))).map((row,index)=>decode(name,ids[index],row)),
   insert:async(name,row)=>decode(name,row._id,await raw.insert(collection,encode(name,row))),
   compareAndSet:async(name,id,version,row)=>{if(row?._id!==id)throw Error('Exact test image required');return decode(name,id,await raw.compareAndSet(collection,address(name,id),version,encode(name,row)));},
   compareAndRemove:async(name,id,attempt)=>decode(name,id,await raw.compareAndRemove(collection,address(name,id),attempt))};
  const protocol=createSegmentedFencedProof({store,company,domainWrites:true,newAttempt:()=> 'COMMIT300-'+newAttempt()});
  const genesis={_id:controlId,company,generation:0,pending:null,_version:'GENESIS'};
  const seeds=plan.writes.filter(change=>change.before!==null);
  if(seeds.length!==300||seeds.some(change=>change.collection!=='StockProducts'||change.before.onHand!==0))throw Error('Exact zero product seed scope required');
  if(input.step==='SEED'){
   stage='SEED_BATCH_PREFLIGHT';
   const control=await store.read(journal,controlId),root=await store.read(journal,key),result=await store.read(journal,resultId),lock=await store.read(journal,lockId);
   if(root||result||lock||(input.batch===0?!!control:!same(control,genesis)))throw Error('Fresh sequential seed scope required');
   // All expected domain IDs, not just seed rows, must match the exact prefix.
   const images=new Map();for(const name of allowed){const changes=plan.writes.filter(change=>change.collection===name);
    const rows=await store.readMany(name,changes.map(change=>change.after._id));changes.forEach((change,index)=>images.set(name+'/'+change.after._id,rows[index]));}
   const completed=input.batch*20;
   for(const change of plan.writes){const seed=seeds.indexOf(change),expected=seed>=0&&seed<completed?change.before:null;
    if(!same(images.get(change.collection+'/'+change.after._id),expected))throw Error('Occupied or nonsequential native seed; no reset/adopt');}
   if(input.batch===0)await protocol.initialize();
   const batch=seeds.slice(completed,completed+20);stage='SEED_BATCH_INSERT';
   for(const change of batch)if(!same(await store.insert(change.collection,change.before),change.before))throw Error('Seed insert reply mismatch');
   const confirmed=await store.readMany('StockProducts',batch.map(change=>change.before._id));
   if(!same(confirmed,batch.map(change=>change.before))||!same(await protocol.readControl(),genesis))throw Error('Exact seed batch readback unconfirmed');
   stage='SEED_BATCH_CONFIRMED';return report(true,{batch:input.batch,seededProducts:completed+20,seedComplete:input.batch===14,
    nextBatch:input.batch===14?null:input.batch+1,wholeCommitRecoveryAccepted:false});
  }
  const control=await protocol.readControl(),prior=await store.read(journal,key),lock=await store.read(journal,lockId);
  if(lock||Object.hasOwn(control,'mode')||control.generation>1)throw Error('Isolated nonbusiness control/absent lock required');
  const inspect=async()=>{
   if(control.pending){let blocked=false;try{await protocol.readSnapshot(()=>{throw Error('Mixed read callback must not run');});}catch(error){blocked=error?.message==='Inventory pending';}
    if(!blocked)throw Error('Pending read barrier unconfirmed');return{generation:control.generation,pending:true,phase:control.pending.phase,cursor:control.pending.cursor,mixedActionableReadBlocked:true};}
   if(control.generation!==1)return{generation:0,pending:false,seedComplete:(await store.readMany('StockProducts',seeds.map(change=>change.before._id))).every((row,index)=>same(row,seeds[index].before))};
   const verified=await protocol.readSnapshot(async()=>{for(const name of allowed){const changes=plan.writes.filter(change=>change.collection===name);
    const rows=await store.readMany(name,changes.map(change=>change.after._id));if(!same(rows,changes.map(change=>change.after)))throw Error('Full901image native parity unconfirmed');}return true;});
   const result=await store.read(journal,resultId);if(verified.generation!==1||result?.outcome?.ok!==true||result.outcome.operationId!==key
    ||result.outcome.generation!==1||result.baseGeneration!==0||result.digest!==hash({isolatedPlanHash:source.planHash})
    ||prior?.planHash!==source.planHash||prior.memberId!==source.memberId||prior.requestId!==source.requestId)throw Error('Final native result unconfirmed');
   return{generation:1,pending:false,full901ImagesVerified:true,positions:300,claims:300,products:300,receiptCount:1,totalOnHand:30000};
  };
  if(input.step==='INSPECT'){stage='READ_ONLY_NATIVE_COMMIT_INSPECTION';return report(true,{inspection:await inspect(),wholeCommitRecoveryAccepted:false});}
  if(input.step==='REPLAY_COMPLETED'?control.generation!==1||control.pending:control.generation!==0)throw Error('Expected exact operation phase required');
  if(!prior){
   const initialProducts=await store.readMany('StockProducts',seeds.map(change=>change.before._id));
   if(!same(control,genesis)||!initialProducts.every((row,index)=>same(row,seeds[index].before)))throw Error('Complete exact seed required before lock acquisition');
  }
  let writes=0,injected=false;
  const changeIds=new Set(plan.writes.map(change=>change.collection+'/'+change.after._id));
  const beforeMutation=async(name,row,forward)=>{
   if(input.step==='INTERRUPT_APPLY'&&changeIds.has(name+'/'+row._id)){
    if(writes===10){injected=true;throw Error('INJECTED_KNOWN_NATIVE_APPLY_INTERRUPTION');}writes++;
   }
   return forward();
  };
  if(input.step==='INTERRUPT_APPLY'&&(!control.pending||control.pending.phase!=='APPLY'||control.pending.cursor>880))throw Error('Known application boundary required');
  const executionStore=input.step==='INTERRUPT_APPLY'?{...store,insert:(name,row)=>beforeMutation(name,row,()=>store.insert(name,row)),
   compareAndSet:(name,id,version,row)=>beforeMutation(name,row,()=>store.compareAndSet(name,id,version,row))}:store;
  const executor=input.step==='INTERRUPT_APPLY'?createSegmentedFencedProof({store:executionStore,company,domainWrites:true,newAttempt:()=> 'COMMIT300-'+newAttempt()}):protocol;
  stage='EXACT_SEGMENTED_EXECUTOR';let outcome;
  try{outcome=await executor.commit({requestId:source.requestId,memberId:source.memberId,input:{isolatedPlanHash:source.planHash},
   prepare:async()=>{if(prior)throw Error('Published original plan must not be recaptured');return copy(plan);},
   authorize:operation=>{if(operation.key!==key||operation.control.company!==company||Object.hasOwn(operation.control,'mode')||operation.control.generation>1)throw Error('Isolated original operation only');}});
  }catch(error){
   if(!injected||error?.message!=='INJECTED_KNOWN_NATIVE_APPLY_INTERRUPTION')throw error;
   if(await store.read(journal,lockId))throw Error('Known application failure lock release unconfirmed');
   const after=await protocol.readControl();if(!same(after,control)||writes!==10)throw Error('Known interrupted progress changed');
   for(let index=control.pending.cursor;index<control.pending.cursor+11;index++){const change=plan.writes[index];
    if(!same(await store.read(change.collection,change.after._id),index<control.pending.cursor+10?change.after:change.before))throw Error('Exact partial native application boundary unconfirmed');}
   stage='KNOWN_APPLY_INTERRUPTION_CONFIRMED';return report(true,{appliedBeforeFault:10,inspection:await inspect(),lockAbsent:true,wholeCommitRecoveryAccepted:false});
  }
  if(await store.read(journal,lockId))throw Error('Exact completed invocation lock release unconfirmed');
  if(outcome?.pending===true&&outcome.ok===false){
   const after=await protocol.readControl();if(!after.pending||after.generation!==0)throw Error('Durable native pending missing');
   let blocked=false;try{await protocol.readSnapshot(()=>{throw Error('Mixed read callback must not run');});}catch(error){blocked=error?.message==='Inventory pending';}
   if(!blocked)throw Error('Pending read barrier unconfirmed');
   stage='SAME_REQUEST_PENDING_CONFIRMED';return report(true,{progress:{phase:outcome.phase,completedCount:outcome.completedCount,totalRecords:outcome.totalRecords},mixedActionableReadBlocked:true,lockAbsent:true,wholeCommitRecoveryAccepted:false});
  }
  if(outcome?.ok!==true||outcome.generation!==1)throw Error('Final original executor outcome unconfirmed');
  stage=input.step==='REPLAY_COMPLETED'?'COMPLETED_REPLAY_UNCHANGED':'NATIVE_901_IMAGE_APPLICATION_CONFIRMED';
  // Fresh control captured inside a NEW inspector invocation, not this precommit
  // control. Completion report alone never claims full901 image verification.
  return report(true,{generation:1,pending:false,lockAbsent:true,requiresFinalReadOnlyInspection:true,wholeCommitRecoveryAccepted:false});
 }catch(_){return report(false,{error:'Native300 test unconfirmed. Retain all records and original request. No automatic retry, reset, unlock or cleanup performed.',wholeCommitRecoveryAccepted:false});}
}

const NATIVE_TEST_LOCK_RELEASE_GRANTED=false;
export const verifyR2CapacityAcceptance=webMethod(Permissions.Admin,async input=>{
 try{return await verifyNative300Commit({items,createSdkConditionalStore,createSegmentedPlanCodec,createSegmentedFencedProof,same,copy,hash,source:retainedSource,input,newAttempt:randomUUID,allowConditionalLockRelease:NATIVE_TEST_LOCK_RELEASE_GRANTED});}
 catch(_){return{ok:false,mutationAttempted:false,error:'Fixed native300 test input required. No recovery performed.'};}
});
