'use strict';
// Private OFFLINE setup review only. Semantic types are NOT Wix wire enums.
// Native metadata must first be captured/normalized with retained provenance.
// This helper has no SDK/DB capability, never installs or grants activation.
const { Buffer } = require('node:buffer');
const copy = value => JSON.parse(JSON.stringify(value));
const group = (type, names) => Object.fromEntries(names.split(' ').map(name => [name, type]));
const text = names => group('TEXT', names), number = names => group('NUMBER', names);
const index = (name, ...fields) => ({ name, fields: fields.map(path => ({ path, order: 'ASC' })) });
function currentNativeSetupContract() {
 const common = { ...text('company stockCommitVersion status stockKey'), ...number('schemaVersion revision checkpointGeneration') };
 const identity = { ...text('barcode name packing'), ea: 'NUMBER' };
 const productActive = index('SC_ACTIVE_PRODUCT', 'company', 'stockKey', 'status');
 const entries = [
  { id: 'StockPositions', kind: 'NEW_PRIVATE', fields: { ...common, ...identity,
    ...text('sourceKind sourceId sourceTaskId poId poNumber'), reviewCodes: 'TEXT_ARRAY',
    ...number('receiptAccepted replacementReceived supplierReturned dispatched borrowRepaidCumulative onHand isolated reservedUsable available') },
   indexes: [productActive] },
  { id: 'StockClaims', kind: 'NEW_PRIVATE', fields: { ...common,
    ...text('positionId taskId customerId orderId sourceLineId'), reviewCodes: 'TEXT_ARRAY',
    ...number('reservedUsable isolatedAttributed dispatchedCumulative') },
   indexes: [productActive, index('SC_SOURCE_DISPATCH', 'company', 'positionId', 'dispatchedCumulative'),
    index('SC_TASK_ACTIVE', 'company', 'taskId', 'status')] },
  { id: 'StockProducts', kind: 'NEW_PRIVATE', fields: { ...common, ...identity, reviewCodes: 'TEXT_ARRAY', reviewRequired: 'BOOLEAN',
    ...number('onHand isolated reservedUsable available lifecycleVersion nextBorrowSequence') },
   indexes: [index('SC_PRODUCT_PAGE', 'company', 'status', 'barcode')] }
 ];
 for (const id of ['NCTActivity', 'NCTActivity1']) entries.push({ id, kind: 'EXISTING_AUGMENT',
  fields: { ...common, ...text('mode action lenderSourceId replacementSourceId'),
   ...number('generation transferIndexVersion repaidQuantity'), pending: 'OBJECT_OR_NULL',
   participantTaskIds: 'TEXT_ARRAY', details: 'OBJECT', activityTime: 'DATE' },
  indexes: [productActive, index('SC_REPAID_SOURCE', 'company', 'replacementSourceId', 'repaidQuantity'),
   index('SC_TASK_REL', 'company', 'participantTaskIds', 'status')] });
 for (const id of ['NCTTasks', 'NCTTasks1']) entries.push({ id, kind: 'EXISTING_AUGMENT',
  fields: { ...text('company stockCommitVersion'), ...number('stockCounterSchema stockDispatchedCumulative stockCounterGeneration'), lastCostCaptureTime: 'DATE' }, indexes: [] });
 for (const id of ['NCTOrders', 'NCTOrders1']) entries.push({ id, kind: 'EXISTING_AUGMENT',
  fields: { ...text('company stockCommitVersion'), estimatedShipmentDate: 'DATE_ONLY', masterReceivedTime: 'DATE', salesSubmissionTime: 'DATE' }, indexes: [] });
 // Shared PO metadata is an existing conditional co-writer, not a new finance
 // feature. Its exact company/version fields must be installed and initialized
 // too; otherwise current Purchase list normalization and PO updates both refuse.
 entries.push({ id: 'PurchaseOrders', kind: 'EXISTING_AUGMENT', fields: text('company stockCommitVersion'), indexes: [] });
 return { schema: 'STOCK_NATIVE_SETUP_REVIEW_V1', semanticTypesOnly: true, entries,
  preserveUnlistedDefinitions: true, addUniqueIndexes: false,
  unresolved: ['Native metadata provenance and type normalization', 'Native compound/array queries and typed roundtrips',
   'Residual predicate and _id sorting cost', 'Case-insensitive contains search cost', 'Actual300line capacity',
   'All legacy writers drained/fenced', 'Migration and operational recovery'] };
}
// Caller-owned normalized readback, NOT a trusted web request or native proof.
// Metadata parity is necessary, never sufficient for deployment/ACTIVE.
function reviewCurrentNativeSetup({ collections = [], capturedRows = [] } = {}) {
 if (!Array.isArray(collections) || collections.length > 20 || !Array.isArray(capturedRows) || capturedRows.length > 10000) {
  throw Error('Bounded private setup readback required');
 }
 const contract = currentNativeSetupContract(), wanted = new Map(contract.entries.map(row => [row.id, row]));
 const actual = new Map(), issues = []; let issueCount = 0, auditedRows = 0;
 const issue = (code, collection, field) => { issueCount++; if (issues.length < 100) issues.push({ code, collection, ...(field ? { field } : {}) }); };
 for (const row of collections) {
  if (!row || !wanted.has(row.id) || actual.has(row.id)) throw Error('Exact distinct setup collection scope required');
  actual.set(row.id, row);
 }
 const equalIndex = (left, right) => Array.isArray(left?.fields) && left.fields.length === right.fields.length
  && left.fields.every((field, offset) => field.path === right.fields[offset].path && field.order === right.fields[offset].order);
 for (const required of contract.entries) {
  const observed = actual.get(required.id);
  if (!observed) { issue('COLLECTION_READBACK_MISSING', required.id); continue; }
  if (observed.fieldsComplete !== true || observed.indexesComplete !== true) issue('COMPLETE_NATIVE_METADATA_UNCONFIRMED', required.id);
  if (!observed.fields || typeof observed.fields !== 'object' || Array.isArray(observed.fields) || Object.keys(observed.fields).length > 500) throw Error('Normalized field metadata required');
  for (const [field, type] of Object.entries(required.fields)) {
   // Nullable object is a stored-value rule, not a distinct CMS schema enum.
   if (observed.fields[field] !== (type === 'OBJECT_OR_NULL' ? 'OBJECT' : type)) issue('FIELD_MISSING_OR_TYPE_CONFLICT', required.id, field);
  }
  if (required.kind === 'NEW_PRIVATE' && observed.permissionsComplete !== true) issue('COMPLETE_PRIVATE_PERMISSION_READBACK_UNCONFIRMED', required.id);
  if (required.kind === 'NEW_PRIVATE') for (const operation of ['read', 'insert', 'update', 'remove']) {
   if (observed.permissions?.[operation] !== 'ADMIN') issue('PRIVATE_PERMISSION_UNCONFIRMED', required.id, operation);
  }
  if (!Array.isArray(observed.indexes) || observed.indexes.length > 50) throw Error('Complete normalized index metadata required');
  if (new Set(observed.indexes.map(row => row?.name)).size !== observed.indexes.length) throw Error('Duplicate index metadata');
  let regular = 0, unique = 0;
  for (const current of observed.indexes) {
   if (!current || typeof current.name !== 'string' || !current.name || current.name.length > 128
    || !['ACTIVE', 'BUILDING', 'FAILED', 'DROPPING'].includes(current.status)
    || !['USER', 'SYSTEM', 'AUTO'].includes(current.source) || !['REGULAR', 'UNIQUE'].includes(current.type)
    || !Array.isArray(current.fields) || !current.fields.length || current.fields.length > (current.type === 'UNIQUE' ? 1 : 3)
    || current.fields.some(field => typeof field?.path !== 'string' || !['ASC', 'DESC'].includes(field.order))
    || new Set(current.fields.map(field => field.path)).size !== current.fields.length) throw Error('Valid bounded index metadata required');
   // Failed/BUILDING USER indexes occupy slots too. Never discard/delete them.
   if (current.source === 'USER') { if (current.type === 'REGULAR') regular++; else unique++; }
  }
  let adds = 0;
  for (const desired of required.indexes) {
   const durable = observed.indexes.find(current => current.source === 'USER' && current.type === 'REGULAR' && equalIndex(current, desired));
   if (!durable) { adds++; issue('REQUIRED_DURABLE_INDEX_MISSING', required.id, desired.name); }
   else if (durable.status !== 'ACTIVE') issue('INDEX_NOT_ACTIVE', required.id, desired.name);
   const collision = observed.indexes.find(current => current.name === desired.name && !equalIndex(current, desired));
   if (collision) issue('INDEX_NAME_CONFLICT_NO_OVERWRITE', required.id, desired.name);
  }
  if (required.indexes.length) {
   const limits = observed.limits;
   if (!Number.isSafeInteger(limits?.regular) || limits.regular < 0 || !Number.isSafeInteger(limits?.unique) || limits.unique < 0) issue('ACTUAL_INDEX_QUOTA_UNKNOWN', required.id);
   else if (regular + adds > limits.regular || unique > limits.unique) issue('INDEX_SLOTS_INSUFFICIENT_NO_DELETE', required.id);
  }
 }
 for (const entry of capturedRows) {
  if (!entry || !wanted.has(entry.collection) || !entry.row || typeof entry.row !== 'object' || Array.isArray(entry.row)) throw Error('Private captured stock row required');
  auditedRows++;
  const required = wanted.get(entry.collection), paths = new Set(required.indexes.flatMap(row => row.fields.map(field => field.path)));
  for (const field of paths) {
   const value = entry.row[field], values = Array.isArray(value) ? value : [value];
   // Conservative review against documented982-byte indexed scalar+collection
   // limit, not a business truncation policy or a native positive acceptance.
   if (values.some(item => typeof item === 'string' && Buffer.byteLength(item, 'utf8') + Buffer.byteLength(entry.collection, 'utf8') > 982)) {
    issue('INDEXED_VALUE_REQUIRES_REVIEW_NO_TRUNCATION', entry.collection, field);
   }
  }
 }
 return { schema: contract.schema, metadataMatches: issueCount === 0, issueCount, issues,
  issuesTruncated: issueCount > issues.length, collectionsReviewed: actual.size, capturedRowsAudited: auditedRows,
  semanticTypesOnly: true, nativeRoundtripsAccepted: false, deploymentAllowed: false, activationReady: false,
  requires: copy(contract.unresolved) };
}
module.exports = { currentNativeSetupContract, reviewCurrentNativeSetup };
