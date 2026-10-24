'use strict';

const { hash } = require('./commit-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const financeFields = Object.freeze({ CLOSE_ACCOUNT: ['closure', 'check'], REOPEN_ACCOUNT: ['closure', 'check'],
  DOCUMENT_ISSUE_REPORT: ['check'], DOCUMENT_ISSUE_REVIEW: ['check'], AMOUNTS: ['amounts', 'check'], CN_NOT_APPLICABLE: ['cnNotApplicable', 'check'],
  CHECK: ['check'], PLAN: ['plan', 'planUpdated'], RECOGNIZE_CREDIT: ['creditRecognition', 'check'], SHORTAGE_CLAIM: ['quantityClaims', 'check'],
  PAYMENT_REVIEW: [], REVIEW_LEGACY: [], TAKE_OWNERSHIP: [], RETURN_PROCUREMENT: [], PAYMENT_PROCESSING: [], PAYMENT_UNKNOWN: [], PAYMENT_RESOLVED: [] });
const procurementActions = new Set(['REVIEW_LEGACY', 'TAKE_OWNERSHIP', 'RETURN_PROCUREMENT', 'PAYMENT_PROCESSING', 'PAYMENT_UNKNOWN', 'PAYMENT_RESOLVED']);
// Private ORIGINAL non-file Account prepare only. No bank/file/stock action is
// inferred from a financial decision, and no actual legacy apply is called.
async function prepareAccountOrderRecord({ company, staff, requestId, input, rows, before, createAccountSettlementOperations, now }) {
  if (!['NCT', 'GHR'].includes(company) || !Object.hasOwn(financeFields, input?.action) || !Array.isArray(rows)
    || rows.some(row => row.company !== company) || new Set(rows.map(row => row.id)).size !== rows.length
    || typeof createAccountSettlementOperations !== 'function' || typeof now !== 'function'
    || before && (before._id !== input.id || before.company !== company || !before._version)) throw Error('Original non-file Account order snapshot required');
  if (before?.details?.audit?.some(event => event.id === hash(company,requestId,staff.memberId,'FINANCE'))) throw Error('Preexisting original Account audit without current receipt requires review');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private Account record boundary');
  let captured, reads = 0;
  const store = {
    read: async (c, id) => {
      if (c === journal) return copy(scratch.get(id) || null);
      if (c !== 'PurchaseOrders' || id !== input.id) throw Error('Account record read scope violation'); return copy(before || null);
    },
    insert: async (c, row) => {
      if (c === journal && row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || !row.details.plan?.record || row.details.plan.upload || row.details.plan.trash
          || row.details.plan.extraUploads?.length) throw Error('Unexpected Account record preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (c !== journal || row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Account apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      if (c !== journal || scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Account lock removal allowed'); scratch.delete(id);
    }
  };
  const operations = createAccountSettlementOperations({ store, now, names: { [company]: { activity: journal } },
    documentService: async () => { throw Error('External Account file operation forbidden'); }, listOrders: async (c, employee) => {
      if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected Account apply/read'); return copy(rows);
    } });
  try { await operations.save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original Account boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  const record = captured?.record, audit = captured?.audit;
  if (!record || !audit || reads !== 1 || scratch.size || record._id !== input.id || record.title !== input.id || record.company !== company
    || captured.expected !== (before ? hash(before) : null) || captured.expectedVersion !== input.version || audit.actorStaffId !== staff.staffId
    || audit.action !== 'ACCOUNT_' + input.action || !same(record.details.audit.at(-1), audit)
    || !same(record.details.audit.slice(0, -1), before?.details?.audit || [])) throw Error('Original Account record/audit identity conflict');
  const permitted = new Set(['finance', 'taskIds', 'createdAt', 'createdBy', 'updatedAt', 'audit',
    ...(procurementActions.has(input.action) ? ['procurementHandoff'] : []), ...(input.action === 'PAYMENT_REVIEW' ? ['paymentHandoff', 'chasePayment'] : []),
    ...(input.action.startsWith('DOCUMENT_ISSUE_') ? ['documentIssues'] : []), ...(input.action === 'DOCUMENT_ISSUE_REVIEW' ? ['documents'] : [])]);
  const fixed = (value, allowed) => Object.fromEntries(Object.entries(value || {}).filter(([k]) => !allowed.has(k)));
  if (before && !same(fixed(before, new Set(['details'])), fixed(record, new Set(['details'])))
    || !same(fixed(before?.details, permitted), fixed(record.details, permitted))
    || !same(fixed(before?.details?.finance, new Set(financeFields[input.action])), fixed(record.details.finance, new Set(financeFields[input.action])))) throw Error('Account decision cannot change payments, stock, files or unrelated fields');
  return { plan: { writes: [{ collection: 'PurchaseOrders', before: copy(before || null), after: record }] }, audit,
    expectedVersion: captured.expectedVersion, expectedBasis: captured.expectedBasis };
}
function createAccountRecordPreparation({ company, readMember, readStaffRecords, requireAccountStaff, readOrders, store, protocol, createAccountSettlementOperations, now }) {
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requireAccountStaff, readOrders, createAccountSettlementOperations, now].some(f => typeof f !== 'function')
    || typeof store?.read !== 'function' || typeof protocol?.readSnapshot !== 'function') throw Error('Server Account preparation dependencies required');
  return async request => {
    if (request?.company !== company || !Object.hasOwn(financeFields, request.input?.action)) throw Error('Supported company non-file Account request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireAccountStaff(member, []);
    const staff = { ...requireAccountStaff(member, await readStaffRecords()), memberId: member._id };
    const snapshot = await protocol.readSnapshot(async () => {
      const rows = await readOrders(company, staff), before = await store.read('PurchaseOrders', request.input.id);
      return prepareAccountOrderRecord({ company, staff, requestId: request.requestId, input: request.input, rows, before, createAccountSettlementOperations, now });
    });
    return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
  };
}
module.exports = { prepareAccountOrderRecord, createAccountRecordPreparation };
