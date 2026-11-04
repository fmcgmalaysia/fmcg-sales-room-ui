'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { prepareAccountOriginalAuxiliary } = require('./account-original-auxiliary-plan.cjs');
const { hash } = require('./commit-proof.cjs');
// These ORIGINAL co-writers must use the SAME barrier, not a competing finance
// workflow. This private adapter grants no role and performs no file/bank action.
function createCurrentAccountAuxiliarySave({ company, store, protocol, coverage, authorityDependencies: d }) {
  if (!['NCT','GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof store?.read !== 'function'
    || [d?.readMember,d?.readStaffRecords,d?.requireAccountStaff,d?.readOrders,d?.createAccountReviewOperations,d?.createSupplierCreditOperations,d?.now].some(fn => typeof fn !== 'function')) throw Error('Original Account auxiliary private dependencies required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  return async request => {
    if (!['INVOICE_CHECK','APPLY_CREDIT'].includes(request?.input?.action)) throw Error('Original Account auxiliary action required');
    const credit = request.input.action === 'APPLY_CREDIT'; let staff;
    const result = await createCurrentStockSave({ company, writer: 'ACCOUNT_PURCHASE_RECORD', protocol, coverage,
      authenticate: async () => {
        const member = await d.readMember(); if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') d.requireAccountStaff(member, []);
        staff = { ...d.requireAccountStaff(member, await d.readStaffRecords()), memberId: member._id }; return { memberId: staff.memberId, staffId: staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Original Account auxiliary actor changed');
        const snapshot = await protocol.readSnapshot(async () => prepareAccountOriginalAuxiliary({ company, staff, requestId: command.requestId, input: command.input,
          rows: await d.readOrders(company, staff), before: credit ? null : await store.read('PurchaseOrders', command.input.id),
          creditBefore: credit ? await store.read(journal, hash(company, command.requestId, staff.memberId, 'CREDIT')) : null,
          createAccountReviewOperations: d.createAccountReviewOperations, createSupplierCreditOperations: d.createSupplierCreditOperations, now: d.now }));
        return { plan: snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    const id = hash(company, request.requestId, staff.memberId, credit ? 'CREDIT' : 'ACCOUNT_REVIEW');
    const receipt = await protocol.readSnapshot(() => store.read(credit ? journal : 'PurchaseOrders', credit ? id : request.input.id));
    const row = receipt.rows, matches = !credit && Array.isArray(row?.details?.audit) ? row.details.audit.filter(event => event.id === id) : [];
    const event = credit ? row : matches[0], at = credit ? event?.activityTime : event?.time;
    if (!row?._version || row.company !== company || credit && (row._id !== id || row.title !== id || row.action !== 'SUPPLIER_CREDIT_APPLIED'
      || row.result !== 'SAVED' || row.initiatedByStaffId !== staff.staffId || row.details?.company !== company || row.details.sourceId !== request.input.sourceId
      || row.details.targetId !== request.input.id || row.details.cents !== request.input.cents)
      || !credit && (row._id !== request.input.id || row.title !== row._id || matches.length !== 1 || event.action !== 'SUPPLIER_INVOICE_CHECK_CHANGED'
        || event.result !== 'SAVED' || event.actorStaffId !== staff.staffId)
      || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw Error('Original Account auxiliary receipt requires review');
    return { ...result, company, poId: request.input.id, savedAt: at };
  };
}
module.exports = { createCurrentAccountAuxiliarySave };
