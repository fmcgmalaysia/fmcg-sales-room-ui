import { items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { createHash } from 'crypto';
const createSdkFieldCodec = (() => {

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
const createSdkConditionalStore = (() => {

// Candidate adapter only. Caller supplies authorized company and explicit collection scope.
// Not imported by production. Verified SDK1.0.528 uses plain WQL conditions, not Filter().
const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);

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


return createSdkConditionalStore;
})();

// NEW isolated mutation candidate. Fresh exact grant needed before install/run.
// ONE fixed synthetic record retained, no delete/lock/reset/replay/schema change.
async function verifyNativeTypedRoundtrip({ items, createSdkConditionalStore, input }) {
 if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1
  || input.confirmation !== 'ONE_RETAINED_TYPED_SYNTHETIC_ROW_NO_DELETE'
  || ['query', 'insert', 'patch'].some(method => typeof items?.[method] !== 'function')
  || typeof createSdkConditionalStore !== 'function') throw Error('Explicit bounded typed roundtrip input required');
 const collection = 'StockProtocolTest', id = 'SPT-TYPE-bebf13e4-dd59-4240-9390-97fc106a66b0';
 const dates = ['activityTime', 'lastCostCaptureTime', 'estimatedShipmentDate', 'masterReceivedTime', 'salesSubmissionTime'];
 const stamp = '2026-10-23T01:23:45.678Z', nextStamp = '2026-10-24T00:00:00.000Z';
 const count = { queries: 0, inserts: 0, patches: 0 }, checks = []; let stage = 'PREFLIGHT', mutationAttempted = false;
 const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
 const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
 const own = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
 const scope = (name, identity = id) => { if (name !== collection || identity !== id) throw Error('Fixed isolated scope required'); };
 const boundedItems = {
  query: name => { scope(name); if (++count.queries > 9) throw Error('Typed query budget'); return items.query(name); },
  insert: (name, row) => { scope(name, row?._id); if (++count.inserts > 1) throw Error('Typed insert budget'); mutationAttempted = true; return items.insert(name, row); },
  patch: (name, identity) => { scope(name, identity); if (++count.patches > 1) throw Error('Typed patch budget'); mutationAttempted = true; return items.patch(name, identity); },
  // Actual shared adapter requires this method to exist, but this diagnostic
  // deliberately NEVER forwards a deletion capability to the native provider.
  remove: () => { throw Error('No deletion authorized or supported by typed probe'); }
 };
 const rawRead = async () => {
  const page = await boundedItems.query(collection).eq('_id', id).limit(2).find({ consistentRead: true, returnTotalCount: true });
  if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0
   || page.totalCount > 1 || page.items.length !== page.totalCount || page.items.some(row => row?._id !== id)) throw Error('Exact native typed read unconfirmed');
  return page.items[0] || null;
 };
 const requireNativeValues = (row, expected) => {
  if (!row || row.company !== 'NCT' || row.stockCommitVersion !== expected._version) throw Error('Native typed identity unconfirmed');
  for (const field of dates) {
   if (expected[field] === null) {
    if (!own(row, field) || row[field] !== null) throw Error('Explicit native null did not roundtrip');
   } else if (Object.prototype.toString.call(row[field]) !== '[object Date]' || !Number.isFinite(row[field].getTime())
    || row[field].toISOString() !== expected[field]) throw Error('Native Date did not roundtrip');
  }
  if (typeof row.message !== 'string' || row.message !== stamp || !same(row.details, expected.details)
   || !same(row.participantTaskIds, expected.participantTaskIds) || row.quantity !== expected.quantity
   || row.reviewRequired !== expected.reviewRequired || row.barcode !== expected.barcode
   || row.supplierPoNumber !== expected.supplierPoNumber || own(row, 'obsoleteFlag') !== own(expected, 'obsoleteFlag')) throw Error('Native nondate value changed');
 };
 const report = ok => ({ ok, schema: 'STOCK_NATIVE_TYPED_ROUNDTRIP_V1', collection, stage, checks: [...checks],
  operationsAttempted: { ...count }, mutationAttempted, recordRetentionPolicy: 'RETAIN_ANY_CREATED_FIXTURE', deletionAttempted: false, replayAllowed: false,
  originalBusinessCollectionsAccepted: false, productionCapacityAccepted: false, activationReady: false,
  limitation: 'One isolated shared-adapter value roundtrip only. Not original collection schema, employee permissions, compound index,300line capacity, migration or recovery acceptance.' });
 try {
  if (await rawRead()) throw Error('Fixed typed fixture occupied; no adopt/reset/replay');
  const store = createSdkConditionalStore({ items: boundedItems, company: 'NCT', collections: [collection], dateTimeFields: { [collection]: dates } });
  const first = { _id: id, company: 'NCT', _version: 'TYPED-V0', title: 'Retained isolated native typed roundtrip',
   ...Object.fromEntries(dates.map(field => [field, stamp])), message: stamp,
   details: { activityTime: stamp, nested: { dateLookingText: stamp }, quantities: [0, 24] },
   participantTaskIds: ['SYNTHETIC-TASK-A', 'SYNTHETIC-TASK-B'], quantity: 24, reviewRequired: false,
   barcode: '095500001', supplierPoNumber: '000123', obsoleteFlag: true };
  stage = 'INSERT_NATIVE_TYPES';
  if (!same(await store.insert(collection, first), first)) throw Error('Canonical insert image unconfirmed');
  requireNativeValues(await rawRead(), first); checks.push(stage);
  stage = 'SHARED_ADAPTER_READ_AND_BATCH';
  if (!same(await store.read(collection, id), first) || !same(await store.readMany(collection, [id]), [first])) throw Error('Canonical exact/batch typed read unconfirmed');
  checks.push(stage);
  const after = { ...first, _version: 'TYPED-V1', activityTime: nextStamp, estimatedShipmentDate: null, quantity: 0, reviewRequired: true };
  delete after.obsoleteFlag;
  stage = 'CONDITIONAL_NATIVE_PATCH';
  if (!same(await store.compareAndSet(collection, id, first._version, after), after)) throw Error('Canonical typed conditional patch unconfirmed');
  requireNativeValues(await rawRead(), after);
  if (!same(await store.read(collection, id), after)) throw Error('Final canonical typed image unconfirmed');
  checks.push(stage);
  stage = 'INVALID_DATE_REFUSES_BEFORE_TRANSPORT';
  const beforeMutationCalls = count.inserts + count.patches;
  let rejected = false;
  try { await store.compareAndSet(collection, id, after._version, { ...after, _version: 'NEVER-WRITTEN', activityTime: '2026-02-30T00:00:00.000Z' }); }
  catch (error) { rejected = /^(Invalid|Canonical) DateTime write/.test(String(error?.message || '')); }
  if (!rejected || count.inserts + count.patches !== beforeMutationCalls || !same(await store.read(collection, id), after)) throw Error('Pretransport date refusal unconfirmed');
  checks.push(stage); stage = 'ISOLATED_TYPED_VALUES_CONFIRMED'; return report(true);
 } catch (_) {
  return { ...report(false), error: 'Typed roundtrip unconfirmed. Retain any created record; no retry, reset, deletion or business recovery performed.' };
 }
}

// Fresh exact mutation grant REQUIRED. Confirmation input is not user authorization.
export const verifyStockTypedRoundtrip = webMethod(Permissions.Admin, async input => {
 try { return await verifyNativeTypedRoundtrip({items,createSdkConditionalStore,input}); }
 catch (_) { return {ok:false,mutationAttempted:false,error:'Explicit bounded isolated typed probe input required. No recovery performed.'}; }
});
