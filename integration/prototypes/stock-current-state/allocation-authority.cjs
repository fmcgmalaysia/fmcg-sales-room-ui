'use strict';

const { originalProductState } = require('./original-product-state.cjs');
const { validateOriginalAllocation } = require('./original-allocation-validation.cjs');
// Ordinary free-stock assignment only. Moving existing customer reservations is
// handled by approved borrowing/cancellation, NOT unrestricted legacy redistribution.
function createAllocationAuthority({ readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, createPlannerAllocationOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
  now = () => new Date() }) {
  for (const fn of [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    createPlannerAllocationOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld]) {
    if (typeof fn !== 'function') throw Error('Existing Purchase allocation dependency required');
  }
  return async ({ company, requestId, input }) => {
    if (!['NCT', 'GHR'].includes(company) || !/^[a-f0-9-]{36}$/i.test(requestId || '')
      || input?.action !== 'ALLOCATE' || typeof input.sourceTaskId !== 'string' || !input.sourceTaskId) throw Error('Valid allocation request required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id };
    const context = await readContext(company, staff);
    if (context.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
      || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
    const validated = await validateOriginalAllocation({ createPlannerAllocationOperations, company, staff, requestId,
      input, workspace: context, activity: context.activity, now });
    const source = context.tasks.find(t => t.id === validated.event.details.sourceTaskId);
    if (!source) throw Error('Allocation source unavailable');
    const identity = { company, barcode: source.barcode, packing: source.packing, ea: source.ea };
    const records = await readPurchaseRecords(company, staff);
    const orders = projectPurchaseOrders({ company, workspace: context, records });
    const product = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld });
    if (!product.sources.some(s => s.id === source.id && s.accepted === validated.event.details.accepted)) throw Error('Allocation receipt authority mismatch');
    return { kind: 'ALLOCATE', memberId: member._id, identity, event: validated.event,
      expectedVersion: validated.expectedVersion, buildState: product.buildState };
  };
}
module.exports = { createAllocationAuthority };
