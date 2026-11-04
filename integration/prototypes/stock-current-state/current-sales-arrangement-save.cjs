'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { requireOriginalSalesDelegation } = require('./sales-delegation.cjs');
const { prepareShipmentArrangement } = require('./shipment-arrangement-plan.cjs');
const { hash } = require('./commit-proof.cjs');
// PRIVATE original source gateway composition. Dates and shipment batches remain
// intent metadata: one original event, no stock/demand/PO/packing mutation.
function createCurrentSalesArrangementSave({ company, store, protocol, coverage, authenticateOriginalDelegation,
  readContext, createSalesShipmentDateOperations, createShipmentPlanOperations, now = () => new Date() }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || typeof store?.read !== 'function'
    || [authenticateOriginalDelegation, readContext, createSalesShipmentDateOperations, createShipmentPlanOperations, now].some(fn => typeof fn !== 'function')) {
    throw Error('Private original Sales arrangement dependencies required');
  }
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'SHIPMENT_PLAN', protocol, coverage,
      authenticate: async () => {
        staff = await authenticateOriginalDelegation(company, request);
        requireOriginalSalesDelegation(staff, request?.input?.customerId);
        if (!['PLAN', 'ORDER_DATE'].includes(request.input.action)) throw Error('Original Sales arrangement action required');
        return { memberId: staff.memberId,staffId:staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Sales delegated actor changed');
        const snapshot = await protocol.readSnapshot(async () => prepareShipmentArrangement({ company, staff,
          requestId: command.requestId, input: command.input, context: await readContext(company, staff),
          createSalesShipmentDateOperations, createShipmentPlanOperations, now }));
        return { plan: snapshot.rows.plan, memberId: staff.memberId, generation: snapshot.generation };
      } })(request);
    if (result.ok !== true) return result;
    const date = request.input.action === 'ORDER_DATE', journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    const receipt = await protocol.readSnapshot(() => store.read(journal,
      hash(company, request.requestId, staff.memberId, date ? 'SALES_SHIPMENT_DATE' : 'SHIPMENT_PLAN_EVENT')));
    const event = receipt.rows;
    if (!event?._version || event.company !== company || event.title !== event._id || event.result !== 'SAVED'
      || event.initiatedByStaffId !== staff.staffId || event.image !== staff.customerId
      || event.action !== (date ? 'SALES_SHIPMENT_DATE_SAVED' : 'CUSTOMER_SHIPMENT_PLAN_SAVED')
      || date && (event.description !== request.input.orderId || event.details?.customerId !== staff.customerId
        || event.details?.submissionId !== request.input.submissionId || event.details?.date !== request.input.date)
      || !date && (event.details?.plan?.company !== company || event.details?.plan?.customerId !== staff.customerId
        || event.details?.plan?.orderId !== request.input.orderId || event.details?.plan?.id !== event.description)) {
      throw Error('Committed Sales arrangement receipt identity unconfirmed');
    }
    return date ? { ...result, company, orderId: event.description, customerId: staff.customerId,
      date: event.details.date, revision: event.title, savedAt: event.activityTime, by: event.initiatedByStaffName }
      : { ...result, company, planId: event.description };
  };
}
module.exports = { createCurrentSalesArrangementSave };
