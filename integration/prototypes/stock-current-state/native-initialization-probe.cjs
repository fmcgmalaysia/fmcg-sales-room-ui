'use strict';

// ISOLATED CANDIDATE ONLY. A fresh exact grant is required before installing or
// invoking this mutation test. These TWO new synthetic records are retained.
// No business collection, lock, delete, reset, retry, mode or schema capability.
async function verifyNativeInitialization({ items, input }) {
 const confirmation = 'TWO_RETAINED_SYNTHETIC_ROWS_NO_DELETE';
 if (!input || typeof input !== 'object' || Array.isArray(input)
  || Object.keys(input).length !== 1 || input.confirmation !== confirmation
  || ['query', 'insert', 'patch'].some(method => typeof items?.[method] !== 'function')) {
  throw Error('Explicit bounded initialization probe input required');
 }
 const collection = 'StockProtocolTest';
 const ids = ['SPT-INIT-3c82f6a5-58d4-46ef-ae09-1dd52bc460f1', 'SPT-INIT-58eb46cb-1ebf-48bc-b416-936bb23793c0'];
 const own = (row, field) => Object.prototype.hasOwnProperty.call(row, field);
 const metadata = new Set(['_createdDate', '_updatedDate', '_owner', '_ownerId']);
 const fields = ['stockCommitVersion', 'stockCounterSchema', 'stockDispatchedCumulative', 'stockCounterGeneration'];
 const checks = [], operationsAttempted = { reads: 0, inserts: 0, patches: 0 };
 let stage = 'PREFLIGHT', mutationAttempted = false;
 // Stable typed private comparison. A date and its ISO-looking string must NOT
 // compare equal. Reject unsupported values instead of silently dropping fields.
 const canonical = value => {
  if (Object.prototype.toString.call(value) === '[object Date]') {
   if (!Number.isFinite(value.getTime())) throw Error('Invalid native date');
   return ['DATE', value.toISOString()];
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return [typeof value, value];
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', value];
  if (Array.isArray(value)) return ['array', value.map(canonical)];
  if (value && Object.prototype.toString.call(value) === '[object Object]') {
   return ['object', Object.keys(value).sort().map(key => [key, canonical(value[key])])];
  }
  throw Error('Unsupported native evidence value');
 };
 const image = row => JSON.stringify(canonical(row));
 const businessImage = row => image(Object.fromEntries(Object.entries(row).filter(([key]) => !metadata.has(key))));
 const date = row => {
  if (Object.prototype.toString.call(row?._updatedDate) !== '[object Date]' || !Number.isFinite(row._updatedDate.getTime())) {
   throw Error('Native Date updated timestamp required');
  }
  return row._updatedDate.toISOString();
 };
 const read = async id => {
  if (!ids.includes(id) || ++operationsAttempted.reads > 10) throw Error('Read budget exceeded');
  const page = await items.query(collection).eq('_id', id).limit(2).find({ consistentRead: true, returnTotalCount: true });
  if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0
   || page.totalCount > 1 || page.totalCount !== page.items.length || page.items.some(row => row?._id !== id)) {
   throw Error('Exact complete native read required');
  }
  return page.items[0] || null;
 };
 const requireFreshFixture = (row, index) => {
  if (!row || row._id !== ids[index] || row.title !== 'Retained missing-version initialization probe ' + (index + 1)
   || row.quantity !== (index ? 60 : 50) || own(row, '_version') || fields.some(field => own(row, field))
   || (index ? row.company !== 'NCT' : own(row, 'company'))) throw Error('Untouched exact synthetic fixture required');
  date(row); image(row);
 };
 // WQL exists:false ALSO matches null. The strict private pre-read above is a
 // separate guard, not evidence of strict native absence semantics. This test
 // evaluates the conjunction with the actual native Date; it cannot fence an
 // unfenced whole-company legacy writer or establish timestamp ABA guarantees.
 const condition = (before, index, timestamp = date(before)) => ({
  company: index ? { $eq: 'NCT' } : { $exists: false },
  stockCommitVersion: { $exists: false },
  _updatedDate: { $eq: { $date: timestamp } }
 });
 const initialFields = version => ({ company: 'NCT', stockCommitVersion: version,
  stockCounterSchema: 2, stockDispatchedCumulative: 0, stockCounterGeneration: 0 });
 const patch = async (id, changed, predicate) => {
  if (!ids.includes(id) || ++operationsAttempted.patches > 7) throw Error('Patch budget exceeded');
  mutationAttempted = true;
  let request = items.patch(collection, id);
  for (const [key, value] of Object.entries(changed)) request = request.setField(key, value);
  try { await request.run({ condition: predicate }); return 'ACCEPTED'; }
  catch (error) {
   // A timeout/permission/schema failure is NOT a successful conflict test.
   if (error?.code === 'WDE0193' || /^WDE0193(?:\s|:|$)/.test(String(error?.message || ''))) return 'REJECTED_CONDITION';
   return 'UNCONFIRMED';
  }
 };
 const rejectedWithoutChange = async (label, before, index, predicate) => {
  stage = label;
  const result = await patch(ids[index], initialFields('UNEXPECTED-' + label), predicate);
  const after = await read(ids[index]);
  if (result !== 'REJECTED_CONDITION' || image(after) !== image(before)) throw Error('Refusal or exact unchanged image unconfirmed');
  checks.push(label);
 };
 const acceptExactChange = (before, after, changed) => {
  date(after);
  if (businessImage(after) !== businessImage({ ...before, ...changed })) throw Error('Exact synthetic business image changed');
 };
 const report = ok => ({ ok, schema: 'STOCK_NATIVE_INITIALIZATION_PROBE_V1', stage, collection,
  checks: [...checks], operationsAttempted: { ...operationsAttempted }, mutationAttempted,
  retainedSyntheticRecords: true, deletionAttempted: false, replayAllowed: false,
  businessInitializationAccepted: false, activationReady: false,
  limitation: 'Isolated SDK conjunction check only; no business migration, writer quiescence, timestamp ABA, production capacity or recovery acceptance.' });
 try {
  // If either fixed ID exists, STOP without writes. Do not adopt, repair, replay
  // or reset any prior/unknown outcome. Insert remains the unique-ID race guard.
  const occupied = [await read(ids[0]), await read(ids[1])];
  if (occupied.some(Boolean)) throw Error('Fixed fixture occupied; review retained evidence');
  stage = 'CREATE_TWO_RETAINED_FIXTURES';
  for (let index = 0; index < 2; index++) {
   const row = { _id: ids[index], title: 'Retained missing-version initialization probe ' + (index + 1), quantity: index ? 60 : 50 };
   if (index) row.company = 'NCT';
   operationsAttempted.inserts++; mutationAttempted = true;
   await items.insert(collection, row);
  }
  const first = await read(ids[0]), second = await read(ids[1]);
  requireFreshFixture(first, 0); requireFreshFixture(second, 1);
  await rejectedWithoutChange('WRONG_DATE_REJECTED', first, 0,
   condition(first, 0, new Date(first._updatedDate.getTime() + 1).toISOString()));
  stage = 'INITIALIZE_ABSENT_COMPANY';
  const firstFields = initialFields('INIT-ABSENT-COMPANY');
  const initialized = await patch(ids[0], firstFields, condition(first, 0)), firstAfter = await read(ids[0]);
  if (initialized !== 'ACCEPTED') throw Error('First initialization unconfirmed');
  acceptExactChange(first, firstAfter, firstFields); checks.push(stage);
  await rejectedWithoutChange('LATE_INITIALIZATION_REJECTED', firstAfter, 0, condition(first, 0));
  stage = 'INTERVENING_SYNTHETIC_LEGACY_EDIT';
  const edited = await patch(ids[1], { quantity: 61 }, condition(second, 1)), secondAfter = await read(ids[1]);
  if (edited !== 'ACCEPTED') throw Error('Intervening synthetic edit unconfirmed');
  acceptExactChange(second, secondAfter, { quantity: 61 });
  if (secondAfter._updatedDate.getTime() <= second._updatedDate.getTime()) throw Error('Timestamp did not advance; no stale-snapshot conclusion');
  checks.push(stage);
  await rejectedWithoutChange('STALE_BEFORE_EDIT_REJECTED', secondAfter, 1, condition(second, 1));
  stage = 'COMPETING_INITIALIZATIONS';
  const versions = ['INIT-EXISTING-COMPANY-A', 'INIT-EXISTING-COMPANY-B'];
  const competing = await Promise.all(versions.map(version => patch(ids[1], initialFields(version), condition(secondAfter, 1))));
  const final = await read(ids[1]);
  if (competing.filter(result => result === 'ACCEPTED').length !== 1
   || competing.filter(result => result === 'REJECTED_CONDITION').length !== 1) throw Error('One confirmed winner required');
  const winner = versions[competing.indexOf('ACCEPTED')];
  acceptExactChange(secondAfter, final, initialFields(winner)); checks.push(stage);
  stage = 'ISOLATED_CONJUNCTION_CONFIRMED'; return report(true);
 } catch (_) {
  return { ...report(false), error: 'Initialization probe unconfirmed. Retain any created records; no reset, retry, deletion or business recovery was performed.' };
 }
}
module.exports = { verifyNativeInitialization };
