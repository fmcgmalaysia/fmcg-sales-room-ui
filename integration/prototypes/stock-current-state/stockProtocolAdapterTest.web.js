import { items } from '@wix/data';
import { createHash } from 'crypto';
import { webMethod, Permissions } from 'wix-web-module';

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
const stockQueryFactory = (() => {

// Isolated read candidate. Caller must authenticate department/company before construction.
// No Activity access, mutation methods, history fallback or production imports.
const fields = {
  StockProducts: ['_id', 'company', 'stockKey', 'barcode', 'name', 'packing', 'ea', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewRequired', 'status', 'revision', 'checkpointGeneration'],
  StockPositions: ['_id', 'company', 'stockKey', 'barcode', 'name', 'packing', 'ea', 'sourceKind', 'sourceId', 'sourceTaskId', 'poId', 'poNumber', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewCodes', 'status', 'revision', 'checkpointGeneration'],
  StockClaims: ['_id', 'company', 'stockKey', 'positionId', 'taskId', 'customerId', 'orderId', 'sourceLineId', 'reservedUsable', 'isolatedAttributed', 'reviewCodes', 'status', 'revision', 'checkpointGeneration']
};
const count = n => Number.isSafeInteger(n) && n >= 0;
const text = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
const copy = value => JSON.parse(JSON.stringify(value));

function createCurrentQuery({ items, company }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function') throw Error('Authorized query scope required');
  function pageArgs(args) {
    if (args?.company !== company || !count(args.page) || !count(args.pageSize) || !args.pageSize
      || args.pageSize > 100 || !count(args.page * args.pageSize) || args.status !== 'ACTIVE'
      || args.consistentRead !== true) throw Error('Invalid current page scope');
  }
  const base = collection => items.query(collection).eq('company', company).eq('status', 'ACTIVE');
  async function run(collection, query, args, matches, order = ['_id']) {
    const page = await query.ascending(...order).skip(args.page * args.pageSize).limit(args.pageSize)
      .find({ consistentRead: true, returnTotalCount: true });
    if (!Array.isArray(page?.items) || page.items.length > args.pageSize || !count(page.totalCount)
      || page.totalCount < page.items.length) throw Error('Invalid current page response');
    const ids = new Set();
    for (const row of page.items) {
      if (!text(row._id, 256) || ids.has(row._id) || row.company !== company || row.status !== 'ACTIVE'
        || !matches(row)) throw Error('Current page identity conflict');
      ids.add(row._id);
    }
    // Explicit display fields only: no operation plans, internal versions or incidental cost.
    return { items: page.items.map(row => Object.fromEntries(fields[collection]
      .filter(field => Object.prototype.hasOwnProperty.call(row, field)).map(field => [field, copy(row[field])]))),
      totalCount: page.totalCount, page: args.page, pageSize: args.pageSize };
  }
  async function queryProducts(args) {
    pageArgs(args);
    if (typeof args.search !== 'string' || args.search.length > 120
      || JSON.stringify(args.order) !== JSON.stringify(['barcode', '_id'])) throw Error('Invalid product query');
    let query = base('StockProducts');
    const search = args.search.trim();
    if (search) {
      const filter = items.query('StockProducts').contains('barcode', search)
        .or(items.query('StockProducts').contains('name', search))
        .or(items.query('StockProducts').contains('packing', search));
      query = query.and(filter);
    }
    return run('StockProducts', query, args, () => true, ['barcode', '_id']);
  }
  async function queryPositions(args) {
    pageArgs(args);
    if (!text(args.stockKey, 2048)) throw Error('Product identity required');
    return run('StockPositions', base('StockPositions').eq('stockKey', args.stockKey), args,
      row => row.stockKey === args.stockKey);
  }
  async function queryClaims(args) {
    pageArgs(args);
    const byPosition = text(args.positionId, 256), byTask = text(args.taskId, 256);
    if (byPosition === byTask || args.positionId !== undefined && !byPosition
      || args.taskId !== undefined && !byTask) throw Error('Exactly one claim selector required');
    const field = byPosition ? 'positionId' : 'taskId', value = args[field];
    return run('StockClaims', base('StockClaims').eq(field, value), args, row => row[field] === value);
  }
  return { queryProducts, queryPositions, queryClaims };
}

// Uses the same pending/generation barrier as the product page, never sums a detail page.
async function readCurrentDetailPage({ protocol, repository, company, kind, page = 0, pageSize = 50, stockKey, positionId, taskId }) {
  if (!['positions', 'claims'].includes(kind)) throw Error('Invalid current detail kind');
  const args = { company, page, pageSize, status: 'ACTIVE', consistentRead: true,
    ...(kind === 'positions' ? { stockKey } : { positionId, taskId }) };
  return protocol.readSnapshot(() => kind === 'positions' ? repository.queryPositions(args) : repository.queryClaims(args));
}


return createCurrentQuery;
})();
// Read-only continuation after the one-shot mutation fixture. Never resets or creates rows.
export const inspectStockSdkAdapter = webMethod(Permissions.Admin, async () => {
  const collection = 'StockProtocolTest';
  const mappedItems = { query: logical => {
    if (!['StockPositions', 'StockClaims', 'StockProducts'].includes(logical)) throw Error('Unexpected probe collection');
    return items.query(collection).eq('probeKind', logical).startsWith('_id', 'ADAPTER-c61f7e82-');
  } };
  const query = () => mappedItems.query('StockProducts').eq('company', 'NCT').eq('status', 'ACTIVE').limit(1);
  const withoutCount = await query().find({ consistentRead: true });
  const withCount = await query().find({ consistentRead: true, returnTotalCount: true });
  const store = stockAdapterFactory({ items, company: 'NCT', collections: [collection] });
  const source = await store.read(collection, 'ADAPTER-c61f7e82-S');
  const claim = await store.read(collection, 'ADAPTER-c61f7e82-C');
  const product = await store.read(collection, 'ADAPTER-c61f7e82-P');
  const repository = stockQueryFactory({ items: mappedItems, company: 'NCT' });
  const args = { company: 'NCT', page: 0, pageSize: 1, status: 'ACTIVE', consistentRead: true };
  const products = await repository.queryProducts({ ...args, search: 'ADAPTER-C61F7E82', order: ['barcode', '_id'] });
  const next = await repository.queryProducts({ ...args, page: 1, search: 'ADAPTER-C61F7E82', order: ['barcode', '_id'] });
  const positions = await repository.queryPositions({ ...args, stockKey: 'SYNTHETIC-12x1' });
  const claims = await repository.queryClaims({ ...args, positionId: 'ADAPTER-c61f7e82-S' });
  const passed = [source, claim, product].every(row => row?._version === 'V1' && row.reservedUsable === 9)
    && source.onHand === 19 && source.obsolete === undefined && product.onHand === 19 && product.available === 10
    && products.totalCount === 2 && products.items[0]?._id === 'ADAPTER-c61f7e82-P'
    && next.items[0]?._id === 'ADAPTER-c61f7e82-Q' && next.items[0]?.available === null
    && positions.totalCount === 1 && claims.totalCount === 1 && !('stockCommitVersion' in products.items[0]);
  return { passed, readOnly: true, countContract: { defaultType: typeof withoutCount.totalCount, explicitCount: withCount.totalCount },
    actual: { source, claim, product }, pages: { products, next, positions, claims },
    limitation: 'No actual timeout injection/full protocol recovery/production migration or activation.' };
});


// Admin diagnostic harness. Four new synthetic rows retained; no deletes or business writes.
export const verifyStockSdkAdapter = webMethod(Permissions.Admin, async () => {
  const collection = 'StockProtocolTest';
  const ids = { source: 'ADAPTER-c61f7e82-S', claim: 'ADAPTER-c61f7e82-C', product: 'ADAPTER-c61f7e82-P', second: 'ADAPTER-c61f7e82-Q' };
  const store = stockAdapterFactory({ items, company: 'NCT', collections: [collection] });
  for (const id of Object.values(ids)) {
    if (await store.read(collection, id)) throw Error('Adapter fixture already exists; inspect, do not reset/replay.');
  }
  const common = { company: 'NCT', title: 'Current stock adapter synthetic test', status: 'ACTIVE', stockKey: 'SYNTHETIC-12x1', barcode: 'ADAPTER-C61F7E82', name: 'Adapter synthetic', packing: '12x1', ea: 12, _version: 'V0' };
  await store.insert(collection, { ...common, _id: ids.source, probeKind: 'StockPositions', onHand: 20, reservedUsable: 10, isolated: 0, available: 10, obsolete: 'REMOVE-ME' });
  await store.insert(collection, { ...common, _id: ids.claim, probeKind: 'StockClaims', positionId: ids.source, taskId: 'SYNTHETIC-CUSTOMER', customerId: 'SYNTHETIC', reservedUsable: 10, isolatedAttributed: 0 });
  await store.insert(collection, { ...common, _id: ids.product, probeKind: 'StockProducts', onHand: 20, reservedUsable: 10, isolated: 0, available: 10 });
  await store.insert(collection, { ...common, _id: ids.second, probeKind: 'StockProducts', barcode: 'ADAPTER-C61F7E82-Z', onHand: null, reservedUsable: null, isolated: 0, available: null });
  const trace = [];
  for (const [id, fields] of [[ids.source, { onHand: 19, reservedUsable: 9 }], [ids.claim, { reservedUsable: 9 }], [ids.product, { onHand: 19, reservedUsable: 9 }]]) {
    const before = await store.read(collection, id), after = { ...before, ...fields, _version: 'V1' };
    delete after.obsolete;
    await store.compareAndSet(collection, id, 'V0', after);
    const actual = await store.read(collection, id);
    if (actual._version !== 'V1' || actual.reservedUsable !== 9 || actual.obsolete !== undefined) throw Error('Adapter image mismatch.');
    trace.push({ id, version: actual._version, reservedUsable: actual.reservedUsable, obsoleteRemoved: actual.obsolete === undefined });
  }
  let staleRejected = false;
  try {
    const before = await store.read(collection, ids.source);
    await store.compareAndSet(collection, ids.source, 'V0', { ...before, _version: 'OLD', onHand: 999 });
  } catch (e) { staleRejected = String(e.message || e).includes('version conflict'); }
  if (!staleRejected) throw Error('Stale adapter request was not rejected.');
  const mappedItems = { query: logical => {
    if (!['StockPositions', 'StockClaims', 'StockProducts'].includes(logical)) throw Error('Unexpected probe collection');
    return items.query(collection).eq('probeKind', logical).startsWith('_id', 'ADAPTER-c61f7e82-');
  } };
  const repository = stockQueryFactory({ items: mappedItems, company: 'NCT' });
  const args = { company: 'NCT', page: 0, pageSize: 1, status: 'ACTIVE', consistentRead: true };
  const products = await repository.queryProducts({ ...args, search: 'ADAPTER-C61F7E82', order: ['barcode', '_id'] });
  const next = await repository.queryProducts({ ...args, page: 1, search: 'ADAPTER-C61F7E82', order: ['barcode', '_id'] });
  const positions = await repository.queryPositions({ ...args, stockKey: common.stockKey });
  const claims = await repository.queryClaims({ ...args, positionId: ids.source });
  const passed = products.totalCount === 2 && products.items[0]?._id === ids.product
    && next.items[0]?._id === ids.second && next.items[0]?.available === null
    && positions.totalCount === 1 && claims.totalCount === 1
    && products.items[0].onHand === 19 && !('stockCommitVersion' in products.items[0]);
  return { passed, staleRejected, trace, pages: { products, next, positions, claims }, retainedIds: ids,
    limitation: 'Actual adapter/query only. No protocol lock deletion, timeout injection, production data or activation.' };
});


