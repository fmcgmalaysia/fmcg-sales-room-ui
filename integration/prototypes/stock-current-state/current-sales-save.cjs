'use strict';

const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { readCurrentSalesWorkspace } = require('./sales-current-workspace.cjs');
const { stockKey } = require('./current-model.cjs');
const { validateOriginalSales } = require('./original-sales-validation.cjs');
const { prepareSalesDemand } = require('./borrowing-stock-plan.cjs');
const { requireOriginalSalesDelegation } = require('./sales-delegation.cjs');
const {hash}=require('./commit-proof.cjs');
// PRIVATE composition after original customerFulfilmentGateway authentication.
// Never expose this as a SiteMember method taking browser staff/customer claims.
function createCurrentSalesDemandSave({ company, items, store, protocol, coverage, authenticateOriginalDelegation,
  readContext, readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders,
  createSalesOrderAdjustmentOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
  readPreparation, projectPreparation, readPlans, planVersion, now = () => new Date() }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2'
    || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Private current Sales dependencies required');
  for (const fn of [authenticateOriginalDelegation, readContext, readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders,
    createSalesOrderAdjustmentOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPlans, planVersion, now]) {
    if (typeof fn !== 'function') throw Error('Original Sales authority dependency required');
  }
  return async request => {
    // Per-call capture: parallel delegated requests must never share an actor.
    let staff;
    const save = createCurrentStockSave({ company, writer: 'SALES_DEMAND', protocol, coverage,
      authenticate: async () => {
        staff = await authenticateOriginalDelegation(company, request);
        requireOriginalSalesDelegation(staff, request?.input?.customerId);
        if (request.input.action !== 'ADJUST') throw Error('Original authenticated Sales customer delegation required');
        return { memberId: staff.memberId,staffId:staff.staffId };
      }, prepare: async command => {
        if (command.memberId !== staff.memberId) throw Error('Sales delegated actor changed');
        const metrics = { exactReads: 0, queries: 0 };
        const snapshot = await protocol.readSnapshot(async control => {
          const context = await readContext(company, staff);
          if (context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
            || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Original Sales company context required');
          const task = context.tasks.find(t => t.id === command.input.taskId && t.customerId === staff.customerId
            && t.orderId === command.input.orderId && !t.procurementSource && !t.specialPurchase && !t.archived);
          if (!task) throw Error('Select an active customer order line.');
          const current = await readCurrentSalesWorkspace({ company, context, staff, control, items, store, metrics,
            readCurrentTaskRows, readPurchaseRecords, projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
          const product = current.products.get(stockKey({ ...task, company }));
          if (!product) throw Error('Current Sales task product missing');
          const { state, rows } = product;
          const validated = await validateOriginalSales({ company, staff, requestId: command.requestId, input: command.input,
            context: current.context, createSalesOrderAdjustmentOperations, readPlans, planVersion, now });
          return { state, rows, validated };
        });
        const { state, rows, validated } = snapshot.rows;
        return { ...prepareSalesDemand({ state, rows, event: validated.event, generation: snapshot.generation }),
          memberId: staff.memberId, generation: snapshot.generation, metrics };
      } });
    const result=await save(request);if(result.ok!==true)return result;
    const id=hash(company,request.requestId,staff.memberId,'SALES_ORDER_ADJUSTMENT');
    const snapshot=await protocol.readSnapshot(()=>store.read(company==='NCT'?'NCTActivity':'NCTActivity1',id)),event=snapshot.rows;
    if(!event?._version||event.company!==company||event._id!==id||event.title!==id||event.action!=='SALES_ORDER_ADJUSTMENT_SAVED'||event.result!=='SAVED'
      ||event.initiatedByStaffId!==staff.staffId||event.image!==staff.customerId||event.imageAltText!==request.input.taskId||event.details?.customerId!==staff.customerId
      ||event.details.orderId!==request.input.orderId||event.details.mode!==request.input.mode||!Number.isSafeInteger(event.details.requested)||event.details.requested<1)throw Error('Committed original Sales adjustment receipt unconfirmed');
    return{...result,company,taskId:event.imageAltText,requested:event.details.requested};
  };
}
module.exports = { createCurrentSalesDemandSave };
