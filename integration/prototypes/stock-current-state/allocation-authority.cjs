'use strict';

const { originalProductState } = require('./original-product-state.cjs');
const { validateOriginalAllocation } = require('./original-allocation-validation.cjs');
const { currentAllocationContext } = require('./current-allocation-context.cjs');
// Ordinary free-stock assignment only. Moving existing customer reservations is
// handled by approved borrowing/cancellation, NOT unrestricted legacy redistribution.
function createAllocationAuthority({ readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, createPlannerAllocationOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation,
  readCurrentTaskRows, allocationViewVersion, currentPlan = false, now = () => new Date() }) {
  if (typeof currentPlan !== 'boolean') throw Error('Explicit server allocation mode required');
  if (currentPlan && allocationViewVersion !== 2) throw Error('Verified original CURRENT allocation view required');
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
    if (currentPlan && (!Array.isArray(input.targets) || input.targets.length > 300
      || input.targets.some(t => typeof t.taskId !== 'string' || !t.taskId))) throw Error('Bounded original allocation targets required');
    const validated = currentPlan ? null : await validateOriginalAllocation({ createPlannerAllocationOperations, company, staff, requestId,
      input, workspace: context, activity: context.activity, now });
    const source = context.tasks.find(t => t.id === (validated?.event.details.sourceTaskId || input.sourceTaskId));
    if (!source) throw Error('Allocation source unavailable');
    const identity = { company, barcode: source.barcode, packing: source.packing, ea: source.ea };
    const records = await readPurchaseRecords(company, staff);
    const orders = projectPurchaseOrders({ company, workspace: context, records });
    const product = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation });
    if (!product.sources.some(s => s.id === source.id && (!validated || s.accepted === validated.event.details.accepted))) throw Error('Allocation receipt authority mismatch');
    return { kind: 'ALLOCATE', memberId: member._id, identity, event: validated?.event,
      expectedVersion: validated?.expectedVersion, buildState: product.buildState,
      stockScope: { sourceTaskIds: [source.id], demandTaskIds: currentPlan ? input.targets.map(t => t.taskId) : [],
        claimPairs: currentPlan ? input.targets.map(t => ({ sourceTaskId: source.id, taskId: t.taskId })) : [] },
      readTaskRows: typeof readCurrentTaskRows === 'function' ? rows => readCurrentTaskRows(company, product.scopeTaskIds(rows), staff) : null,
      prepareFromState: currentPlan ? async state => {
        const workspace = currentAllocationContext({ state, context, readAllocations });
        const result = await validateOriginalAllocation({ createPlannerAllocationOperations, company, staff, requestId, input,
          workspace, activity: context.activity, now });
        if (result.event.details.accepted !== state.sources.find(s => s.id === source.id)?.accepted) throw Error('Allocation accepted receipt authority changed');
        return result;
      } : null };
  };
}
module.exports = { createAllocationAuthority };
