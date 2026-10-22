'use strict';

const { stockKey } = require('./current-model.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const { validateOriginalReceipt } = require('./original-receipt-validation.cjs');
// Server-only authority preparation. Caller must execute this INSIDE readSnapshot
// and recheck expectedVersion under the fenced lock before committing its plan.
function createWarehouseAuthority({ readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, projectWarehouseOrders, createWarehouseOperations,
  readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation, now = () => new Date() }) {
  for (const fn of [readMember, readStaffRecords, requireWarehouseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, projectWarehouseOrders, createWarehouseOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld]) {
    if (typeof fn !== 'function') throw Error('Existing Warehouse authority dependency required');
  }
  return async ({ company, requestId, input }) => {
    if (!['NCT', 'GHR'].includes(company) || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || !input || !['RECEIVE', 'CORRECT'].includes(input.action)) throw Error('Valid Warehouse receipt request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requireWarehouseStaff(member, []);
    const staff = { ...requireWarehouseStaff(member, await readStaffRecords()), memberId: member._id };
    const context = await readContext(company, staff);
    if (context.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
      || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
    const records = await readPurchaseRecords(company, staff);
    const purchaseOrders = projectPurchaseOrders({ company, workspace: context, records });
    const orders = projectWarehouseOrders({ company, purchaseOrders, tasks: context.tasks, activity: context.activity });
    const validated = await validateOriginalReceipt({ createWarehouseOperations, company, staff, requestId,
      input, orders, activity: context.activity, now });
    const products = new Map();
    for (const line of validated.event.details.lines) {
      const task = context.tasks.find(t => t.id === line.taskId);
      if (!task) throw Error('Receipt source unavailable');
      const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea }, key = stockKey(identity);
      if (!products.has(key)) products.set(key, originalProductState({ company, context, orders: purchaseOrders, identity,
        readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation }));
      const source = products.get(key).sources.find(s => s.id === line.taskId);
      if (!source || source.poId !== validated.event.description || source.accepted !== line.beforeAccepted
        || source.planned !== line.planned) throw Error('Original receipt and source authority differ');
    }
    return { kind: 'RECEIVE', memberId: member._id, validated,
      products: [...products.values()].map(p => ({ identity: p.identity, buildState: p.buildState })) };
  };
}
module.exports = { createWarehouseAuthority };
