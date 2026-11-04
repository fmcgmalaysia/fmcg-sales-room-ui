const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { currentNativeSetupContract, reviewCurrentNativeSetup } = require('../prototypes/stock-current-state/native-setup-review.cjs');
const { stockKey } = require('../prototypes/stock-current-state/current-model.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
function snapshot() {
 return currentNativeSetupContract().entries.map(entry => ({ id: entry.id, fieldsComplete: true, indexesComplete: true, permissionsComplete: true,
  fields: Object.fromEntries(Object.entries(entry.fields).map(([name, type]) => [name, type === 'OBJECT_OR_NULL' ? 'OBJECT' : type])),
  permissions: { read: 'ADMIN', insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN' },
  limits: { regular: 3, unique: 1 }, indexes: entry.indexes.map(index => ({ ...structuredClone(index), source: 'USER', type: 'REGULAR', status: 'ACTIVE' })) }));
}
const codes = result => result.issues.map(issue => issue.code);

test('shipment dates are date-only while receipt/submission timestamps retain time for both companies', () => {
 const collections = snapshot();
 for (const id of ['NCTOrders', 'NCTOrders1']) {
  const row = collections.find(entry => entry.id === id);
  assert.equal(row.fields.estimatedShipmentDate, 'DATE_ONLY');
  assert.equal(row.fields.masterReceivedTime, 'DATE');
  assert.equal(row.fields.salesSubmissionTime, 'DATE');
 }
 assert.equal(reviewCurrentNativeSetup({ collections }).metadataMatches, true);
 collections.find(entry => entry.id === 'NCTOrders').fields.estimatedShipmentDate = 'DATE';
 assert.ok(reviewCurrentNativeSetup({ collections }).issues.some(issue => issue.collection === 'NCTOrders' && issue.field === 'estimatedShipmentDate'));
});
test('review plan has three new private tables, seven additive existing scopes and only feasible three-field regular index candidates', () => {
 const contract = currentNativeSetupContract();
 assert.equal(contract.entries.length, 10); assert.equal(contract.entries.filter(row => row.kind === 'NEW_PRIVATE').length, 3);
 assert.equal(contract.entries.filter(row => row.kind === 'EXISTING_AUGMENT').length, 7);
 assert.equal(contract.addUniqueIndexes, false); assert.equal(contract.preserveUnlistedDefinitions, true); assert.equal(contract.semanticTypesOnly, true);
 for (const row of contract.entries) {
  assert.ok(row.indexes.length <= 3); assert.equal(new Set(row.indexes.map(index => index.name)).size, row.indexes.length);
  for (const index of row.indexes) { assert.ok(index.fields.length <= 3); for (const field of index.fields) assert.ok(row.fields[field.path]); }
  assert.equal(row.fields._version, undefined); assert.equal(row.fields._id, undefined);
 }
 contract.entries[0].fields.company = 'WRONG'; assert.equal(currentNativeSetupContract().entries[0].fields.company, 'TEXT');
});

test('matching normalized mock metadata remains ONLY review parity, never native roundtrip, deployment or activation evidence', () => {
 const collections = snapshot(); collections[0].fields.unrelatedExistingField = 'TEXT';
 collections[0].indexes[0].name = 'EXISTING_EQUIVALENT_NAME';
 collections[0].indexes[0].fields = collections[0].indexes[0].fields.map(field => ({ order: field.order, path: field.path }));
 collections[3].permissions = { read: 'PUBLIC', insert: 'PUBLIC' }; // Existing journal ACL is not a grant to change it.
 const before = structuredClone(collections), result = reviewCurrentNativeSetup({ collections });
 assert.equal(result.metadataMatches, true); assert.equal(result.issueCount, 0); assert.equal(result.semanticTypesOnly, true);
 assert.equal(result.nativeRoundtripsAccepted, false); assert.equal(result.deploymentAllowed, false); assert.equal(result.activationReady, false);
 assert.equal(result.capturedRowsAudited, 0); assert.deepEqual(collections, before);
});

test('missing collections, unknown completeness, missing fields/types and private public/member permissions cannot pass', () => {
 const absent = reviewCurrentNativeSetup(); assert.equal(absent.metadataMatches, false); assert.equal(absent.issueCount, 10);
 const collections = snapshot(); delete collections[0].fieldsComplete; delete collections[1].indexesComplete; delete collections[2].permissionsComplete;
 collections[0].fields.receiptAccepted = 'TEXT'; collections[1].permissions.update = 'MEMBER'; delete collections[2].fields.nextBorrowSequence;
 const result = reviewCurrentNativeSetup({ collections }); assert.equal(result.metadataMatches, false);
 for (const code of ['COMPLETE_NATIVE_METADATA_UNCONFIRMED', 'COMPLETE_PRIVATE_PERMISSION_READBACK_UNCONFIRMED', 'FIELD_MISSING_OR_TYPE_CONFLICT', 'PRIVATE_PERMISSION_UNCONFIRMED']) assert.ok(codes(result).includes(code));
});

test('actual shared PO list normalization requires the shared PO version in the setup contract', async () => {
 const { createCurrentPurchaseTables } = require('../prototypes/stock-current-state/current-purchase-tables.cjs');
 const contract = currentNativeSetupContract(), entry = contract.entries.find(row => row.id === 'PurchaseOrders');
 assert.deepEqual(entry.fields, { company: 'TEXT', stockCommitVersion: 'TEXT' });
 for (const company of ['NCT', 'GHR']) {
  const normalized = [];
  const read = createCurrentPurchaseTables({ company, readOriginalTable: async table => table === 'PurchaseOrders'
   ? [{ _id: 'PO', company, stockCommitVersion: 'PO-V1' }, { _id: 'OTHER', company: company === 'NCT' ? 'GHR' : 'NCT' }] : [],
   store: { normalizeListedRow: (table, row) => { normalized.push(table); assert.ok(row.stockCommitVersion); return row; } } });
  const rows = await read(company, { memberId: 'M', staffId: 'S' });
  assert.deepEqual(normalized, ['PurchaseOrders']); assert.equal(rows.PurchaseOrders.length, 1);
 }
 const collections = snapshot(); delete collections.find(row => row.id === 'PurchaseOrders').fields.stockCommitVersion;
 const result = reviewCurrentNativeSetup({ collections });
 assert.ok(result.issues.some(issue => issue.collection === 'PurchaseOrders' && issue.field === 'stockCommitVersion'));
});

test('actual occupied/failed index slots, unavailable quotas, non-active indexes and name conflicts refuse without delete or overwrite', () => {
 const collections = snapshot(), journal = collections.find(row => row.id === 'NCTActivity');
 journal.indexes = [1, 2, 3].map(i => ({ name: 'OLD_' + i, source: 'USER', type: 'REGULAR', status: i === 3 ? 'FAILED' : 'ACTIVE',
  fields: [{ path: 'originalField' + i, order: 'ASC' }] }));
 const products = collections.find(row => row.id === 'StockProducts'); products.indexes[0].status = 'BUILDING'; delete products.limits;
 const claims = collections.find(row => row.id === 'StockClaims'); claims.indexes[0].fields[1].path = 'wrongField';
 const before = structuredClone(collections), result = reviewCurrentNativeSetup({ collections });
 for (const code of ['INDEX_SLOTS_INSUFFICIENT_NO_DELETE', 'INDEX_NOT_ACTIVE', 'ACTUAL_INDEX_QUOTA_UNKNOWN', 'INDEX_NAME_CONFLICT_NO_OVERWRITE']) assert.ok(codes(result).includes(code));
 assert.deepEqual(collections, before);
});

test('automatic indexes do not count as durable installation acceptance or occupy manual quota', () => {
 const collections = snapshot(), claims = collections.find(row => row.id === 'StockClaims'); claims.indexes.forEach(index => { index.source = 'AUTO'; });
 const result = reviewCurrentNativeSetup({ collections });
 assert.equal(codes(result).filter(code => code === 'REQUIRED_DURABLE_INDEX_MISSING').length, 3);
 assert.equal(codes(result).includes('INDEX_SLOTS_INSUFFICIENT_NO_DELETE'), false);
 assert.equal(result.metadataMatches, false);
});

test('index candidate values are checked in UTF8 bytes without imposing a new product limit, truncating data or exposing values', () => {
 const identity = { company: 'NCT', barcode: '955', packing: '饼'.repeat(400), ea: 24 }, key = stockKey(identity);
 assert.ok(key.length < 982); assert.ok(Buffer.byteLength(key) > 982); // Existing identity model accepts it, native indexed length is a DIFFERENT constraint.
 const capturedRows = [{ collection: 'StockPositions', row: { company: 'NCT', stockKey: key, status: 'ACTIVE' } }];
 const before = structuredClone(capturedRows), result = reviewCurrentNativeSetup({ collections: snapshot(), capturedRows });
 assert.ok(codes(result).includes('INDEXED_VALUE_REQUIRES_REVIEW_NO_TRUNCATION')); assert.equal(result.metadataMatches, false);
 assert.deepEqual(capturedRows, before); assert.doesNotMatch(JSON.stringify(result), /饼|955/);
 const collection = 'StockPositions', allowed = 982 - Buffer.byteLength(collection);
 assert.equal(reviewCurrentNativeSetup({ collections: snapshot(), capturedRows: [{ collection, row: { stockKey: 'x'.repeat(allowed) } }] }).metadataMatches, true);
 assert.equal(reviewCurrentNativeSetup({ collections: snapshot(), capturedRows: [{ collection, row: { stockKey: 'x'.repeat(allowed + 1) } }] }).metadataMatches, false);
});

test('large review returns bounded value-free issues and does not silently truncate the count', () => {
 const result = reviewCurrentNativeSetup({ collections: snapshot(), capturedRows: Array.from({ length: 300 }, () =>
  ({ collection: 'StockClaims', row: { stockKey: 'PRIVATE'.repeat(200) } })) });
 assert.equal(result.issueCount, 300); assert.equal(result.issues.length, 100); assert.equal(result.issuesTruncated, true);
 assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test('malformed scopes, duplicate metadata, over-wide indexes or invalid quotas are not repaired', () => {
 assert.throws(() => reviewCurrentNativeSetup({ collections: [{}] }), /scope/);
 const duplicates = snapshot(); duplicates.push(duplicates[0]); assert.throws(() => reviewCurrentNativeSetup({ collections: duplicates }), /distinct/);
 const invalid = snapshot(); invalid[0].indexes[0].fields.push({ path: 'fourth', order: 'ASC' }); assert.throws(() => reviewCurrentNativeSetup({ collections: invalid }), /index metadata/);
 for (const invalidField of ['name', 'status']) { const malformed = snapshot(); delete malformed[0].indexes[0][invalidField]; assert.throws(() => reviewCurrentNativeSetup({ collections: malformed }), /index metadata/); }
 const unknown = snapshot(); unknown[0].limits.regular = -1; assert.ok(codes(reviewCurrentNativeSetup({ collections: unknown })).includes('ACTUAL_INDEX_QUOTA_UNKNOWN'));
 assert.throws(() => reviewCurrentNativeSetup({ capturedRows: [{ collection: 'StaffMasterAccess', row: {} }] }), /captured stock/);
});

test('field plan covers actual scoped/batched/current UI/relation query fields, not an assumed replacement query', async () => {
 const { readScopedCurrentProduct } = require('../prototypes/stock-current-state/scoped-current-reader.cjs');
 const { createReceiptReadSnapshot } = require('../prototypes/stock-current-state/receipt-read-snapshot.cjs');
 const { createCurrentQuery } = require('../prototypes/stock-current-state/current-query.cjs');
 const { createBorrowCurrentQuery } = require('../prototypes/stock-current-state/borrow-current-query.cjs');
 const company = 'NCT', identity = { company, barcode: '955', packing: '24 x 320ML', ea: 24 }, key = stockKey(identity);
 const id = hash(company, key, 'PURCHASE_SOURCE', 'SOURCE'), queries = [], usedFields = [];
 const position = { _id: id, company, stockKey: key, sourceTaskId: 'SOURCE', _version: 'V', revision: 1, status: 'ACTIVE',
  receiptAccepted: 10, borrowRepaidCumulative: 0, onHand: 10, isolated: 0, available: 10, reservedUsable: 0, dispatched: 0 };
 const product = { _id: hash(company, key), company, stockKey: key, _version: 'V', revision: 1, status: 'ACTIVE',
  lifecycleVersion: 2, nextBorrowSequence: 1, onHand: 10, isolated: 0, available: 10, reservedUsable: 0 };
 const rows = { StockPositions: [position], StockProducts: [product] }, items = { query: collection => {
  const filters = []; let limit = 100, offset = 0;
  const field = (name, value) => { usedFields.push([collection, name]); return value; };
  const q = { eq: (name, value) => { field(name); filters.push(row => Array.isArray(row[name]) ? row[name].includes(value) : row[name] === value); return q; },
   gt: (name, value) => { field(name); filters.push(row => row[name] > value); return q; },
   hasSome: (name, values) => { field(name); filters.push(row => values.includes(row[name])); return q; },
   ascending: (...names) => { names.forEach(name => field(name)); return q; }, limit: value => { limit = value; return q; },
   skip: value => { offset = value; return q; }, find: async () => { queries.push(collection); const found = (rows[collection] || []).filter(row => filters.every(fn => fn(row)));
    return { items: structuredClone(found.slice(offset, offset + limit)), totalCount: found.length }; } }; return q;
 } };
 const store = { read: async (collection, address) => structuredClone((rows[collection] || []).find(row => row._id === address) || null),
  readMany: async (collection, ids) => Promise.all(ids.map(id => store.read(collection, id))), normalizeListedRow: (_, row) => structuredClone(row) };
 const scope = { sourceTaskIds: ['SOURCE'], demandTaskIds: ['TASK'], correctionSourceIds: ['SOURCE'], claimPairs: [{ sourceTaskId: 'SOURCE', taskId: 'TASK' }] };
 await readScopedCurrentProduct({ company, identity, items, store, transferIndexVersion: 2, ...scope });
 await createReceiptReadSnapshot({ company, products: [{ identity, stockScope: scope }], items, store, transferIndexVersion: 2 });
 const query = createCurrentQuery({ company, items }), args = { company, page: 0, pageSize: 50, status: 'ACTIVE', consistentRead: true };
 await query.queryProducts({ ...args, search: '', order: ['barcode', '_id'] }); await query.queryPositions({ ...args, stockKey: key });
 await query.queryClaims({ ...args, taskId: 'TASK' }); await query.queryClaims({ ...args, positionId: id });
 const control = { company, mode: 'ACTIVE', generation: 1, pending: null, transferIndexVersion: 2 };
 await createBorrowCurrentQuery({ company, items, protocol: { readSnapshot: async fn => ({ rows: await fn(control), generation: 1 }) },
  authenticate: async () => ({ memberId: 'MEMBER', staffId: 'PURCHASE' }) })(company, { taskId: 'TASK' });
 const contract = new Map(currentNativeSetupContract().entries.map(entry => [entry.id, entry]));
 for (const [collection, field] of usedFields) assert.ok(field === '_id' || contract.get(collection)?.fields[field], collection + '.' + field);
 for (const name of ['stockKey', 'positionId', 'dispatchedCumulative', 'replacementSourceId', 'repaidQuantity', 'participantTaskIds']) assert.ok(usedFields.some(([, field]) => field === name), name);
 assert.ok(queries.length > 5);
});

test('pure review is not bundled into privileged stock runtime or an installer and has no SDK/native writes', () => {
 const source = fs.readFileSync(require.resolve('../prototypes/stock-current-state/native-setup-review.cjs'), 'utf8');
 assert.doesNotMatch(source, /@wix\/data|items\.(insert|patch|remove)|webMethod|fetch\(|execFile/);
 const manifest = require('../prototypes/stock-current-state/current-install-manifest.json');
 assert.equal(manifest.modules.some(row => row.source.includes('native-setup-review')), false);
});
