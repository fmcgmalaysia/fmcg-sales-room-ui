import { items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { createHash, randomBytes } from 'crypto';
const randomUUID = () => randomBytes(16).toString('hex');
const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

const stockAdapterFactory = (() => {

// Candidate adapter only. Caller supplies authorized company and explicit collection scope.
// Not imported by production. Verified SDK1.0.528 uses plain WQL conditions, not Filter().
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
const copy = value => JSON.parse(JSON.stringify(value));

function createSdkConditionalStore({ items, company, collections }) {
  if (!['NCT', 'GHR'].includes(company) || !Array.isArray(collections) || !collections.length
    || collections.some(name => typeof name !== 'string' || !name)
    || !items || ['query', 'insert', 'patch', 'remove'].some(method => typeof items[method] !== 'function')) {
    throw Error('Explicit conditional store scope required');
  }
  const allowed = new Set(collections);
  function scope(collection, id) {
    if (!allowed.has(collection) || typeof id !== 'string' || !id) throw Error('Storage scope violation');
  }
  function normalize(row) {
    if (!row) return null;
    if (row.company !== company) throw Error('Storage company conflict');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (!metadata.has(key) && key !== 'stockCommitVersion') result[key] = copy(value);
    }
    if (own(row, 'stockCommitVersion')) result._version = row.stockCommitVersion;
    return result;
  }
  function encode(row) {
    if (!row || row.company !== company || own(row, 'stockCommitVersion')
      || Object.keys(row).some(key => metadata.has(key))) throw Error('Invalid owned storage image');
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== '_version') result[key] = copy(value);
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
    return normalize(page.items[0] || null);
  }
  async function insert(collection, row) {
    scope(collection, row?._id);
    return normalize(await items.insert(collection, encode(row)));
  }
  async function compareAndSet(collection, id, expectedVersion, after) {
    scope(collection, id);
    if (typeof expectedVersion !== 'string' || !expectedVersion || after?._id !== id
      || !after._version || after._version === expectedVersion) throw Error('Fresh conditional version required');
    const current = await read(collection, id);
    if (!current || current._version !== expectedVersion) throw Error('Storage version conflict');
    const beforePayload = encode(current), afterPayload = encode(after);
    let patch = items.patch(collection, id);
    for (const key of Object.keys(beforePayload)) {
      if (key !== '_id' && !own(afterPayload, key)) patch = patch.removeField(key);
    }
    for (const [key, value] of Object.entries(afterPayload)) {
      if (key !== '_id') patch = patch.setField(key, value);
    }
    return normalize(await patch.run({ condition: { company: { $eq: company }, stockCommitVersion: { $eq: expectedVersion } } }));
  }
  async function compareAndRemove(collection, id, expectedAttempt) {
    scope(collection, id);
    if (typeof expectedAttempt !== 'string' || !expectedAttempt) throw Error('Execution identity required');
    return normalize(await items.remove(collection, id, {
      condition: { company: { $eq: company }, attempt: { $eq: expectedAttempt } }
    }));
  }
  return { read, insert, compareAndSet, compareAndRemove };
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


