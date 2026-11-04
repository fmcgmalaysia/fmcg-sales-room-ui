'use strict';

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
module.exports = { verifyNativeTypedRoundtrip };
