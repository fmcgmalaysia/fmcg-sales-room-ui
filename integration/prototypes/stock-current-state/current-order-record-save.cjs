'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { preparePurchaseOrderRecord } = require('./purchase-order-record-plan.cjs');
const { prepareAccountOrderRecord } = require('./account-order-record-plan.cjs');
const { hash } = require('./commit-proof.cjs');
// PRIVATE bindings of original non-file PO metadata writers, not new financial
// policy or public endpoints. Both share the same company fence as stock saves.
function createOrderRecordSave({ company, store, protocol, coverage, authorityDependencies: d }, department) {
  const purchase = department === 'PURCHASE', authorize = purchase ? d?.requirePurchaseStaff : d?.requireAccountStaff;
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof store?.read !== 'function'
    || [d?.readMember, d?.readStaffRecords, authorize, d?.now,
      ...(purchase ? [d?.readContext, d?.readPurchaseRecords, d?.createPurchaseOrderOperations]
        : [d?.readOrders, d?.createAccountSettlementOperations])].some(fn => typeof fn !== 'function')) {
    throw Error('Private original order record dependencies required');
  }
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, protocol, coverage,
      writer: purchase ? 'PURCHASE_ORDER_RECORD' : 'ACCOUNT_PURCHASE_RECORD',
      authenticate: async () => {
        const member = await d.readMember();
        if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') authorize(member, []);
        staff = { ...authorize(member, await d.readStaffRecords()), memberId: member._id };
        return { memberId: staff.memberId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Order record actor changed');
        const snapshot = await protocol.readSnapshot(async () => {
          if (purchase) {
            const context = await d.readContext(company, staff), records = await d.readPurchaseRecords(company, staff);
            return (await preparePurchaseOrderRecord({ company, staff, requestId: command.requestId, input: command.input,
              context, records, createPurchaseOrderOperations: d.createPurchaseOrderOperations, now: d.now })).plan;
          }
          const rows = await d.readOrders(company, staff), before = await store.read('PurchaseOrders', command.input.id);
          return (await prepareAccountOrderRecord({ company, staff, requestId: command.requestId, input: command.input,
            rows, before, createAccountSettlementOperations: d.createAccountSettlementOperations, now: d.now })).plan;
        });
        return { plan: snapshot.rows, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    // Original audit is retained in the shared PO record, even after later saves.
    // Replays must find ONE exact receipt, not infer success from latest row state.
    const receipt = await protocol.readSnapshot(() => store.read('PurchaseOrders', request.input.id));
    const row = receipt.rows, auditId = hash(company, request.requestId, staff.memberId, purchase ? 'PO_AUDIT' : 'FINANCE');
    const matches = Array.isArray(row?.details?.audit) ? row.details.audit.filter(event => event.id === auditId) : [];
    const audit = matches[0], action = purchase ? ({ ACK_PAYMENT: 'PAYMENT_NOTIFICATION_ACKNOWLEDGED',
      REQUEST_PAYMENT: 'PROCUREMENT_REQUEST_PAYMENT', SUBMIT_FINANCE: 'PROCUREMENT_SUBMIT_FINANCE',
      WITHDRAW_FINANCE: 'PROCUREMENT_WITHDRAW_FINANCE', REQUEST_RETURN: 'PROCUREMENT_REQUEST_RETURN',
      DOCUMENT_ISSUE_RESPONSE: 'SUPPLIER_DOCUMENT_ISSUE_RESPONSE', TERM: 'PAYMENT_TERM_CHANGED' }[request.input.action])
      : 'ACCOUNT_' + request.input.action;
    if (!row?._version || row._id !== request.input.id || row.title !== row._id || row.company !== company
      || matches.length !== 1 || audit.action !== action || audit.actorStaffId !== staff.staffId
      || audit.result !== 'SAVED' || typeof audit.time !== 'string' || !Number.isFinite(Date.parse(audit.time))) {
      throw Error('Committed original order record receipt requires review');
    }
    return { ...result, company, poId: row._id, savedAt: audit.time };
  };
}
const createCurrentPurchaseOrderRecordSave = dependencies => createOrderRecordSave(dependencies, 'PURCHASE');
const createCurrentAccountOrderRecordSave = dependencies => createOrderRecordSave(dependencies, 'ACCOUNT');
module.exports = { createCurrentPurchaseOrderRecordSave, createCurrentAccountOrderRecordSave };
