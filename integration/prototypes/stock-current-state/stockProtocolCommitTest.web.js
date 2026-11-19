import { items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { createHash, randomBytes } from 'crypto';
const randomUUID = () => randomBytes(16).toString('hex');
const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

const sdkFieldCodecFactory = (() => {

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

return createSdkFieldCodec;
})();
const stockAdapterFactory = (() => {

// Candidate adapter only. Caller supplies authorized company and explicit collection scope.
// Not imported by production. Verified SDK1.0.528 uses plain WQL conditions, not Filter().
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
const createSdkFieldCodec = sdkFieldCodecFactory;
const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

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
  // Optional insert-only capability. Never bulkSave/bulkUpdate: duplicate IDs
  // must not overwrite a newer version. Caller confirms ALL exact after-images.
  async function insertMany(collection, rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 32
      || new Set(rows.map(row => row?._id)).size !== rows.length) throw Error('Bounded distinct insert images required');
    const payload = rows.map(row => { scope(collection, row?._id); return encode(collection, row); });
    const bytes = text => { let size = 0; for (const char of text) { const code = char.codePointAt(0);
      size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; } return size; };
    if (payload.some(row => bytes(JSON.stringify(row)) > 450000)
      || bytes(JSON.stringify(payload)) > 3500000) throw Error('Insert batch payload requires review');
    // No auth/hook suppression. A resolved bulk result may still be partial;
    // it is deliberately NOT converted into an acknowledgement here.
    await items.bulkInsert(collection, payload);
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
  return { read, readMany, insert, compareAndSet, compareAndRemove, normalizeListedRow,
    ...(typeof items.bulkInsert === 'function' ? { insertMany } : {}) };
}


return createSdkConditionalStore;
})();

const isolatedStoreFactory = (() => {

// Test namespace only. Never points logical collections at physical business collections.
function createIsolatedProtocolStore({ store, namespace }) {
  if (namespace !== 'PROTOCOL-70c1b2') throw Error('Fixed isolated namespace required');
  const collection = 'StockProtocolTest';
  const allowed = new Set(['NCTActivity', 'StockPositions', 'StockClaims', 'StockProducts']);
  function address(logical, id) {
    if (!allowed.has(logical) || typeof id !== 'string' || !id || id.length > 128) throw Error('Invalid isolated address');
    return namespace + ':' + logical + ':' + id;
  }
  function encode(logical, row) { return { ...row, _id: address(logical, row._id) }; }
  function decode(logical, id, row) {
    if (!row) return null;
    if (row._id !== address(logical, id)) throw Error('Isolated identity conflict');
    return { ...row, _id: id };
  }
  return {
    read: async (logical, id) => decode(logical, id, await store.read(collection, address(logical, id))),
    insert: async (logical, row) => decode(logical, row._id, await store.insert(collection, encode(logical, row))),
    compareAndSet: async (logical, id, version, row) => {
      if (row?._id !== id) throw Error('Isolated image identity conflict');
      return decode(logical, id, await store.compareAndSet(collection, address(logical, id), version, encode(logical, row)));
    },
    compareAndRemove: async (logical, id, attempt) => decode(logical, id,
      await store.compareAndRemove(collection, address(logical, id), attempt))
  };
}


return createIsolatedProtocolStore;
})();

const domainScopeFactory = (() => {

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
const { planCollections } = domainScopeFactory;

const stockProtocolFactory = (() => {

// OFFLINE CONTRACT PROOF. No Wix adapter, authorization endpoint or production imports.
// compareAndSet/compareAndRemove MUST test their condition atomically at mutation time.


const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function createFencedProof({ store, company = 'NCT', newAttempt = randomUUID, domainWrites = false }) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Invalid company');
  for (const method of ['read', 'insert', 'compareAndSet', 'compareAndRemove']) {
    if (typeof store[method] !== 'function') throw Error('Conditional storage required');
  }
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const scope = company + '/PURCHASE', lockId = hash(scope, 'LOCK');
  const controlId = hash(company, 'STOCK_CONTROL');
  const allowed = new Set(planCollections(company, domainWrites));
  const initial = () => ({ _id: controlId, company, generation: 0, pending: null, _version: 'GENESIS' });
  const readControl = async () => {
    const row = await store.read(journal, controlId);
    if (!row || row.company !== company || !row._version || !Number.isSafeInteger(row.generation)
      || row.generation < 0) throw Error('Control missing or invalid');
    return row;
  };
  // Initialization is an explicit offline setup step; production migration is not implemented.
  async function initialize() { await store.insert(journal, initial()); }
  async function transition(collection, before, after) {
    try {
      if (before) await store.compareAndSet(collection, after._id, before._version, copy(after));
      else await store.insert(collection, copy(after));
    } catch (error) {
      // Only exact after-image confirms a lost reply. A before-image does NOT mean cancelled.
      if (!same(await store.read(collection, after._id), after)) throw error;
    }
    if (!same(await store.read(collection, after._id), after)) throw Error('Conditional write unconfirmed');
  }
  const nextControl = (before, fields) => ({ ...before, ...fields,
    _version: hash(before._version, fields) });
  function checkPlan(plan, key) {
    if (!plan || !Array.isArray(plan.writes) || !plan.writes.length || plan.writes.length > 30
      || Buffer.byteLength(JSON.stringify(plan)) > 180000) throw Error('Proof plan limit');
    const keys = new Set();
    for (const change of plan.writes) {
      const id = change.after?._id, identity = change.collection + '/' + id;
      if (!allowed.has(change.collection) || !id || keys.has(identity) || change.after.company !== company
        || change.before && (change.before._id !== id || change.before.company !== company || !change.before._version)
        || change.collection === journal && [lockId, controlId, key, hash(key, 'RESULT')].includes(id)) {
        throw Error('Plan identity conflict');
      }
      keys.add(identity);
      const token = hash(key, change.collection, id);
      if (change.before?._version === token) throw Error('Version reuse');
      change.after._version = token;
    }
  }
  async function readSnapshot(readRows) {
    const before = await readControl();
    if (before.pending) throw Error('Inventory pending');
    const rows = await readRows(), after = await readControl();
    if (after.pending || before._version !== after._version) throw Error('Inventory changed during read');
    return { generation: after.generation, rows };
  }
  async function commit({ requestId, memberId, input, prepare, validate = () => {}, authorize = () => {} }) {
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || !memberId || typeof authorize !== 'function') throw Error('Proof identity required');
    const key = hash(scope, requestId, memberId), digest = hash(input), resultId = hash(key, 'RESULT');
    const attempt = newAttempt();
    if (typeof attempt !== 'string' || !attempt) throw Error('Attempt identity required');
    // An uncertain acquisition is not auto-removed or stolen; no domain writes have begun.
    await store.insert(journal, { _id: lockId, company, owner: key, attempt });
    try {
      let control = await readControl();
      if (control.pending && (control.pending.key !== key || control.pending.digest !== digest)) {
        throw Error('Prior inventory save pending');
      }
      const prior = await store.read(journal, resultId);
      let receipt = await store.read(journal, key);
      if (prior && (prior.company !== company || prior._id !== resultId || !Number.isSafeInteger(prior.baseGeneration) || prior.baseGeneration < 0)
        || receipt && (receipt.company !== company || receipt._id !== key || !Number.isSafeInteger(receipt.baseGeneration) || receipt.baseGeneration < 0)) throw Error('Operation receipt scope conflict');
      if (prior && prior.digest !== digest || receipt && receipt.digest !== digest) throw Error('Request identity reused');
      if (prior && receipt && prior.baseGeneration !== receipt.baseGeneration) throw Error('Operation receipt generation conflict');
      if (prior && (prior.outcome?.ok !== true || prior.outcome.operationId !== key || prior.outcome.generation !== prior.baseGeneration + 1
        || !control.pending && control.generation < prior.outcome.generation)) throw Error('Operation result requires review');
      // Runs under the owned fence on EVERY invocation, including completed or pending
      // replays. Replay identity comes only from exact server receipts, never UI flags.
      await authorize(copy({ control, key, digest, replay: !!(prior || receipt), baseGeneration: (prior || receipt)?.baseGeneration ?? control.generation }));
      if (prior) {
        if (control.pending) {
          if (control.generation !== prior.baseGeneration) throw Error('Result generation conflict');
          await transition(journal, control, nextControl(control, { generation: prior.baseGeneration + 1, pending: null }));
        }
        return copy(prior.outcome);
      }
      if (!receipt) {
        const plan = copy(await prepare()); checkPlan(plan, key);
        receipt = { _id: key, company, digest, baseGeneration: control.generation, plan };
        await transition(journal, null, receipt);
      }
      const plan = copy(receipt.plan); checkPlan(plan, key);
      if (!same(plan, receipt.plan)) throw Error('Prepared plan changed');
      if (receipt.baseGeneration !== control.generation) throw Error('Prepared generation stale');
      if (!control.pending) {
        for (const change of plan.writes) {
          if (!same(await store.read(change.collection, change.after._id), change.before)) throw Error('Prepared before-image stale');
        }
        const pending = nextControl(control, { pending: { key, digest } });
        await transition(journal, control, pending); control = pending;
      }
      for (const change of plan.writes) {
        const current = await store.read(change.collection, change.after._id);
        if (same(current, change.after)) continue;
        if (!same(current, change.before)) throw Error('Write version conflict');
        await transition(change.collection, change.before, change.after);
      }
      for (const change of plan.writes) {
        if (!same(await store.read(change.collection, change.after._id), change.after)) throw Error('Final image conflict');
      }
      await validate(copy(plan));
      const outcome = { ok: true, operationId: key, generation: receipt.baseGeneration + 1 };
      await transition(journal, null, { _id: resultId, company, digest, baseGeneration: receipt.baseGeneration, outcome });
      await transition(journal, control, nextControl(control, { generation: receipt.baseGeneration + 1, pending: null }));
      return outcome;
    } finally {
      // No domain mutation follows release. A late copy must recheck attempt at execution.
      await store.compareAndRemove(journal, lockId, attempt);
    }
  }
  return { initialize, commit, readSnapshot, readControl, ids: { journal, lockId, controlId } };
}


return createFencedProof;
})();
// Three ordered Admin probes. All records except exactly three successful lock releases stay.
const makeProtocolProbe = () => {
  const raw = stockAdapterFactory({ items, company: 'NCT', collections: ['StockProtocolTest'] });
  const store = isolatedStoreFactory({ store: raw, namespace: 'PROTOCOL-70c1b2' });
  const protocol = stockProtocolFactory({ store, company: 'NCT' });
  return { store, protocol };
};
const probeRequest = (store, prepareAllowed = true) => ({
  requestId: '70c1b200-1111-4111-8111-111111111111', memberId: 'SYNTHETIC-ADMIN-PROBE', input: { amount: 10 },
  prepare: async () => {
    if (!prepareAllowed) throw Error('Replay must not prepare a new plan');
    const source = await store.read('StockPositions', 'SOURCE'), product = await store.read('StockProducts', 'PRODUCT');
    if (product.available !== 20 || source.reserved !== 0) throw Error('Unexpected initial synthetic balance');
    return { writes: [
      { collection: 'NCTActivity', before: null, after: { _id: 'DOMAIN', company: 'NCT', amount: 10 } },
      { collection: 'StockPositions', before: source, after: { ...source, reserved: 10 } },
      { collection: 'StockClaims', before: null, after: { _id: 'CLAIM', company: 'NCT', reserved: 10 } },
      { collection: 'StockProducts', before: product, after: { ...product, reserved: 10, available: 10 } }
    ] };
  },
  validate: async () => {
    const source = await store.read('StockPositions', 'SOURCE'), product = await store.read('StockProducts', 'PRODUCT');
    if (source.onHand !== 20 || source.reserved !== 10 || product.reserved !== 10 || product.available !== 10) throw Error('Synthetic balance mismatch');
  }
});

export const interruptStockProtocolProbe = webMethod(Permissions.Admin, async () => {
  const { store, protocol } = makeProtocolProbe();
  if (await store.read(protocol.ids.journal, protocol.ids.controlId)
    || await store.read('StockPositions', 'SOURCE') || await store.read('StockProducts', 'PRODUCT')) throw Error('Probe already initialized; inspect instead of reset');
  await protocol.initialize();
  await store.insert('StockPositions', { _id: 'SOURCE', company: 'NCT', onHand: 20, reserved: 0, _version: 'S0' });
  await store.insert('StockProducts', { _id: 'PRODUCT', company: 'NCT', onHand: 20, reserved: 0, available: 20, _version: 'P0' });
  const interruptedStore = { ...store, insert: async (collection, row) => {
    if (collection === 'StockClaims' && row._id === 'CLAIM') throw Error('Injected application interruption before claim');
    return store.insert(collection, row);
  } };
  let interrupted = false;
  try { await stockProtocolFactory({ store: interruptedStore, company: 'NCT' }).commit(probeRequest(store)); }
  catch (e) { if (!String(e.message || e).includes('Injected application interruption')) throw e; interrupted = true; }
  let blockedRead = false;
  try { await protocol.readSnapshot(() => store.read('StockProducts', 'PRODUCT')); }
  catch (e) { if (!String(e.message || e).includes('Inventory pending')) throw e; blockedRead = true; }
  const control = await protocol.readControl(), source = await store.read('StockPositions', 'SOURCE');
  const product = await store.read('StockProducts', 'PRODUCT'), lock = await store.read(protocol.ids.journal, protocol.ids.lockId);
  return { passed: interrupted && blockedRead && Boolean(control.pending) && control.generation === 0
    && source.reserved === 10 && product.available === 20 && lock === null,
    stage: 'interrupted', control, source, product, blockedRead, lockAbsent: lock === null,
    limitation: 'Application exception injected, not a real network timeout. All writes confined to StockProtocolTest.' };
});

export const resumeStockProtocolProbe = webMethod(Permissions.Admin, async () => {
  const { store, protocol } = makeProtocolProbe(), before = await protocol.readControl();
  if (!before.pending || before.generation !== 0) throw Error('Expected interrupted probe; inspect instead of replay');
  const outcome = await protocol.commit(probeRequest(store, false));
  const snapshot = await protocol.readSnapshot(async () => ({ source: await store.read('StockPositions', 'SOURCE'),
    claim: await store.read('StockClaims', 'CLAIM'), product: await store.read('StockProducts', 'PRODUCT') }));
  const lock = await store.read(protocol.ids.journal, protocol.ids.lockId);
  return { passed: snapshot.generation === 1 && snapshot.rows.source.reserved === 10
    && snapshot.rows.claim.reserved === 10 && snapshot.rows.product.available === 10 && lock === null,
    stage: 'resumed', outcome, snapshot, lockAbsent: lock === null };
});

export const replayStockProtocolProbe = webMethod(Permissions.Admin, async () => {
  const { store, protocol } = makeProtocolProbe(), control = await protocol.readControl();
  if (control.pending || control.generation !== 1) throw Error('Expected completed probe');
  const outcome = await protocol.commit(probeRequest(store, false));
  const after = await protocol.readControl(), product = await store.read('StockProducts', 'PRODUCT');
  const lock = await store.read(protocol.ids.journal, protocol.ids.lockId);
  return { passed: after.generation === 1 && !after.pending && product.available === 10 && lock === null,
    stage: 'replayed', outcome, control: after, product, lockAbsent: lock === null };
});


