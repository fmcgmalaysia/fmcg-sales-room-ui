// Private schema administration. No item access, permissions mutation, delete, publish or ACTIVE.
import { collections, indexes } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
const currentNativeSetupContract = () => ({"schema":"STOCK_NATIVE_SETUP_REVIEW_V1","semanticTypesOnly":true,"entries":[{"id":"StockPositions","kind":"NEW_PRIVATE","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","barcode":"TEXT","name":"TEXT","packing":"TEXT","ea":"NUMBER","sourceKind":"TEXT","sourceId":"TEXT","sourceTaskId":"TEXT","poId":"TEXT","poNumber":"TEXT","reviewCodes":"TEXT_ARRAY","receiptAccepted":"NUMBER","replacementReceived":"NUMBER","supplierReturned":"NUMBER","dispatched":"NUMBER","borrowRepaidCumulative":"NUMBER","onHand":"NUMBER","isolated":"NUMBER","reservedUsable":"NUMBER","available":"NUMBER"},"indexes":[{"name":"SC_ACTIVE_PRODUCT","fields":[{"path":"company","order":"ASC"},{"path":"stockKey","order":"ASC"},{"path":"status","order":"ASC"}]}]},{"id":"StockClaims","kind":"NEW_PRIVATE","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","positionId":"TEXT","taskId":"TEXT","customerId":"TEXT","orderId":"TEXT","sourceLineId":"TEXT","reviewCodes":"TEXT_ARRAY","reservedUsable":"NUMBER","isolatedAttributed":"NUMBER","dispatchedCumulative":"NUMBER"},"indexes":[{"name":"SC_ACTIVE_PRODUCT","fields":[{"path":"company","order":"ASC"},{"path":"stockKey","order":"ASC"},{"path":"status","order":"ASC"}]},{"name":"SC_SOURCE_DISPATCH","fields":[{"path":"company","order":"ASC"},{"path":"positionId","order":"ASC"},{"path":"dispatchedCumulative","order":"ASC"}]},{"name":"SC_TASK_ACTIVE","fields":[{"path":"company","order":"ASC"},{"path":"taskId","order":"ASC"},{"path":"status","order":"ASC"}]}]},{"id":"StockProducts","kind":"NEW_PRIVATE","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","barcode":"TEXT","name":"TEXT","packing":"TEXT","ea":"NUMBER","reviewCodes":"TEXT_ARRAY","reviewRequired":"BOOLEAN","onHand":"NUMBER","isolated":"NUMBER","reservedUsable":"NUMBER","available":"NUMBER","lifecycleVersion":"NUMBER","nextBorrowSequence":"NUMBER"},"indexes":[{"name":"SC_PRODUCT_PAGE","fields":[{"path":"company","order":"ASC"},{"path":"status","order":"ASC"},{"path":"barcode","order":"ASC"}]}]},{"id":"NCTActivity","kind":"EXISTING_AUGMENT","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","mode":"TEXT","action":"TEXT","lenderSourceId":"TEXT","replacementSourceId":"TEXT","generation":"NUMBER","transferIndexVersion":"NUMBER","repaidQuantity":"NUMBER","pending":"OBJECT_OR_NULL","participantTaskIds":"TEXT_ARRAY","details":"OBJECT","activityTime":"DATE"},"indexes":[{"name":"SC_ACTIVE_PRODUCT","fields":[{"path":"company","order":"ASC"},{"path":"stockKey","order":"ASC"},{"path":"status","order":"ASC"}]},{"name":"SC_REPAID_SOURCE","fields":[{"path":"company","order":"ASC"},{"path":"replacementSourceId","order":"ASC"},{"path":"repaidQuantity","order":"ASC"}]},{"name":"SC_TASK_REL","fields":[{"path":"company","order":"ASC"},{"path":"participantTaskIds","order":"ASC"},{"path":"status","order":"ASC"}]}]},{"id":"NCTActivity1","kind":"EXISTING_AUGMENT","fields":{"company":"TEXT","stockCommitVersion":"TEXT","status":"TEXT","stockKey":"TEXT","schemaVersion":"NUMBER","revision":"NUMBER","checkpointGeneration":"NUMBER","mode":"TEXT","action":"TEXT","lenderSourceId":"TEXT","replacementSourceId":"TEXT","generation":"NUMBER","transferIndexVersion":"NUMBER","repaidQuantity":"NUMBER","pending":"OBJECT_OR_NULL","participantTaskIds":"TEXT_ARRAY","details":"OBJECT","activityTime":"DATE"},"indexes":[{"name":"SC_ACTIVE_PRODUCT","fields":[{"path":"company","order":"ASC"},{"path":"stockKey","order":"ASC"},{"path":"status","order":"ASC"}]},{"name":"SC_REPAID_SOURCE","fields":[{"path":"company","order":"ASC"},{"path":"replacementSourceId","order":"ASC"},{"path":"repaidQuantity","order":"ASC"}]},{"name":"SC_TASK_REL","fields":[{"path":"company","order":"ASC"},{"path":"participantTaskIds","order":"ASC"},{"path":"status","order":"ASC"}]}]},{"id":"NCTTasks","kind":"EXISTING_AUGMENT","fields":{"company":"TEXT","stockCommitVersion":"TEXT","stockCounterSchema":"NUMBER","stockDispatchedCumulative":"NUMBER","stockCounterGeneration":"NUMBER","lastCostCaptureTime":"DATE"},"indexes":[]},{"id":"NCTTasks1","kind":"EXISTING_AUGMENT","fields":{"company":"TEXT","stockCommitVersion":"TEXT","stockCounterSchema":"NUMBER","stockDispatchedCumulative":"NUMBER","stockCounterGeneration":"NUMBER","lastCostCaptureTime":"DATE"},"indexes":[]},{"id":"NCTOrders","kind":"EXISTING_AUGMENT","fields":{"company":"TEXT","stockCommitVersion":"TEXT","estimatedShipmentDate":"DATE","masterReceivedTime":"DATE","salesSubmissionTime":"DATE"},"indexes":[]},{"id":"NCTOrders1","kind":"EXISTING_AUGMENT","fields":{"company":"TEXT","stockCommitVersion":"TEXT","estimatedShipmentDate":"DATE","masterReceivedTime":"DATE","salesSubmissionTime":"DATE"},"indexes":[]},{"id":"PurchaseOrders","kind":"EXISTING_AUGMENT","fields":{"company":"TEXT","stockCommitVersion":"TEXT"},"indexes":[]}],"preserveUnlistedDefinitions":true,"addUniqueIndexes":false,"unresolved":["Native metadata provenance and type normalization","Native compound/array queries and typed roundtrips","Residual predicate and _id sorting cost","Case-insensitive contains search cost","Actual300line capacity","All legacy writers drained/fenced","Migration and operational recovery"]});
const { createNativeSchemaInstaller } = (() => {
// Additive schema administration only. No records, permissions, deletes or ACTIVE.

const wireType = type => ({ DATE: 'DATETIME', TEXT_ARRAY: 'ARRAY_STRING', OBJECT_OR_NULL: 'OBJECT' }[type] || type);
const copy = value => JSON.parse(JSON.stringify(value));
const stable = value => JSON.stringify(value, function (key, item) {
 if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]));
 return item;
});
function createNativeSchemaInstaller({ collections, indexes }) {
 if (typeof collections?.getDataCollection !== 'function' || typeof collections?.updateDataCollectionField !== 'function'
  || typeof indexes?.listIndexes !== 'function' || typeof indexes?.createIndex !== 'function') throw Error('Native metadata SDK required');
 const scope = new Map(currentNativeSetupContract().entries.map(entry => [entry.id, entry]));
 function request(input, kind) {
  const keys = kind === 'inspect' ? ['collection'] : ['collection', kind === 'field' ? 'key' : 'name', 'revision'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))
   || keys.some(key => !Object.hasOwn(input, key)) || !scope.has(input.collection)) throw Error('Exact bounded schema scope required');
  return scope.get(input.collection);
 }
 async function read(id) {
  const collection = await collections.getDataCollection(id, { consistentRead: true });
  if (collection?._id !== id || !Array.isArray(collection.fields) || collection.fields.length > 500
   || !['string', 'number'].includes(typeof collection.revision) || !collection.permissions
   || new Set(collection.fields.map(field => field.key)).size !== collection.fields.length) throw Error('Complete native collection metadata required');
  const response = await indexes.listIndexes(id, { paging: { limit: 100, offset: 0 } });
  if (!Array.isArray(response?.indexes) || response.indexes.length > 50 || response.pagingMetadata?.hasNext === true
   || response.pagingMetadata?.tooManyToCount === true
   || (response.pagingMetadata?.total != null && response.pagingMetadata.total !== response.indexes.length)) throw Error('Complete native index metadata required');
  return { collection, indexes: response.indexes };
 }
 function guardPrivate(entry, collection) {
  if (entry.kind === 'NEW_PRIVATE' && ['read', 'insert', 'update', 'remove'].some(op => collection.permissions[op] !== 'ADMIN')) {
   throw Error('Saved Admin-only collection permissions required; installer never changes them');
  }
 }
 function fieldsCompatible(entry, collection) {
  for (const field of collection.fields) if (Object.hasOwn(entry.fields, field.key) && field.type !== wireType(entry.fields[field.key])) {
   throw Error('Existing field type conflict; no overwrite: ' + field.key);
  }
 }
 function preserve(before, after, addedKey) {
  for (const key of ['permissions', 'dataPermissions', 'displayName', 'displayField', 'plugins', 'collectionType']) {
   if (stable(before[key]) !== stable(after[key])) throw Error('Unrelated collection metadata changed: ' + key);
  }
  const prior = new Map(before.fields.map(field => [field.key, field]));
  for (const field of after.fields) if (prior.has(field.key)) {
   if (stable(prior.get(field.key)) !== stable(field)) throw Error('Existing field metadata changed: ' + field.key);
   prior.delete(field.key);
  } else if (field.key !== addedKey) throw Error('Unexpected added field');
  if (prior.size || after.fields.length !== before.fields.length + (addedKey ? 1 : 0)) throw Error('Field preservation failed');
 }
 const equalIndex = (current, desired) => current.unique === false && current.caseInsensitive === false
  && stable(current.fields) === stable(desired.fields);
 async function inspect(input) {
  const entry = request(input, 'inspect'), snapshot = await read(entry.id);
  guardPrivate(entry, snapshot.collection); fieldsCompatible(entry, snapshot.collection);
  return { schema: 'STOCK_NATIVE_SCHEMA_ADMIN_V1', ...snapshot,
   missingFields: Object.entries(entry.fields).filter(([key]) => !snapshot.collection.fields.some(field => field.key === key))
    .map(([key, type]) => ({ key, type: wireType(type), displayName: key })),
   requiredIndexes: copy(entry.indexes), activationAllowed: false };
 }
 async function addField(input) {
  const entry = request(input, 'field');
  if (!Object.hasOwn(entry.fields, input.key)) throw Error('Field outside fixed setup contract');
  const before = await read(entry.id); guardPrivate(entry, before.collection); fieldsCompatible(entry, before.collection);
  if (String(before.collection.revision) !== String(input.revision)) throw Error('Fresh collection revision required');
  if (before.collection.fields.some(field => field.key === input.key)) return { changed: false, reason: 'ALREADY_PRESENT', ...before };
  // Single-field API, NOT UpdateDataCollection; no ACL or complete-schema replacement.
  // Exceptions/unknown outcomes propagate. Caller must inspect, never auto-retry.
  await collections.updateDataCollectionField(entry.id, { field: { key: input.key, displayName: input.key, type: wireType(entry.fields[input.key]) } });
  const after = await read(entry.id); preserve(before.collection, after.collection, input.key);
  if (after.collection.fields.find(field => field.key === input.key)?.type !== wireType(entry.fields[input.key])
   || stable(before.indexes) !== stable(after.indexes)) throw Error('New field readback or index preservation failed');
  return { changed: true, ...after, activationAllowed: false };
 }
 async function addIndex(input) {
  const entry = request(input, 'index'), desired = entry.indexes.find(index => index.name === input.name);
  if (!desired) throw Error('Index outside fixed setup contract');
  const before = await read(entry.id); guardPrivate(entry, before.collection); fieldsCompatible(entry, before.collection);
  if (String(before.collection.revision) !== String(input.revision)) throw Error('Fresh collection revision required');
  if (desired.fields.some(field => !before.collection.fields.some(current => current.key === field.path))) throw Error('Install indexed fields first');
  const existing = before.indexes.find(index => index.source === 'USER' && equalIndex(index, desired));
  if (existing) return { changed: false, reason: 'INDEX_EXISTS', ...before, activationAllowed: false };
  if (before.indexes.some(index => index.name === desired.name)) throw Error('Index name conflict; never replace or drop');
  const limits = before.collection.capabilities?.indexLimits;
  if (!Number.isSafeInteger(limits?.regular) || !Number.isSafeInteger(limits?.total)
   || before.indexes.filter(index => index.source === 'USER' && !index.unique).length >= limits.regular
   || before.indexes.filter(index => index.source === 'USER').length >= limits.total) throw Error('Native index quota insufficient or unknown');
  await indexes.createIndex(entry.id, { ...copy(desired), unique: false, caseInsensitive: false });
  const after = await read(entry.id); preserve(before.collection, after.collection);
  for (const prior of before.indexes) if (!after.indexes.some(index => stable(index) === stable(prior))) throw Error('Existing index changed');
  if (after.indexes.length !== before.indexes.length + 1 || !after.indexes.some(index => index.name === desired.name && equalIndex(index, desired))) throw Error('New index readback failed; inspect without retry');
  return { changed: true, ...after, activationAllowed: false };
 }
 return { inspect, addField, addIndex };
}
return { createNativeSchemaInstaller, wireType };
})();
const setup = createNativeSchemaInstaller({ collections, indexes });
export const inspectStockSchema = webMethod(Permissions.Admin, input => setup.inspect(input));
export const addStockSchemaField = webMethod(Permissions.Admin, input => setup.addField(input));
export const addStockSchemaIndex = webMethod(Permissions.Admin, input => setup.addIndex(input));
