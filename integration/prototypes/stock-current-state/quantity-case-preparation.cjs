'use strict';

const { originalProductState } = require('./original-product-state.cjs');
const { readCurrentProduct } = require('./current-product-reader.cjs');
const { prepareProcurementTransition } = require('./borrowing-stock-plan.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
async function validateOriginalQuantityCase({ createQuantityCaseOperations, company, staff, requestId, input, context, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.activity)
    || !Array.isArray(context.tasks) || typeof createQuantityCaseOperations !== 'function' || typeof now !== 'function') throw Error('Original quantity decision context required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private quantity decision boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Quantity decision scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    all: async c => { scope(c); return copy(context.activity); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'PURCHASE_QUANTITY_CASE_DECIDED') throw Error('Unexpected quantity decision preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Quantity decision apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private quantity decision lock removal allowed'); scratch.delete(id);
    }
  };
  const save = createQuantityCaseOperations({ store, now, names: { [company]: { activity: journal } }, readWorkspace: async (c, employee) => {
    if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected quantity decision apply/read'); return copy(context);
  } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original quantity decision boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original quantity decision preparation incomplete');
  return captured;
}
// Original Purchase permission and quantity-case projector remain the authority.
// A decision is not Sales cancellation, stock release, physical return or repayment.
function createQuantityCasePreparation(deps) {
  const { company, readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    createQuantityCaseOperations, projectQuantityCases, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
    readPreparation, projectPreparation, protocol, items, store, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, createQuantityCaseOperations, projectQuantityCases, readAllocations, readCustomerShipments, readPackingLists,
    packingHeld, now].some(f => typeof f !== 'function') || typeof protocol?.readSnapshot !== 'function'
    || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Server quantity decision dependencies required');
  return async request => {
    if (request?.company !== company || request.input?.action !== 'DECIDE' || typeof request.input.id !== 'string' || !request.input.id) throw Error('Known company quantity decision required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id, canDecideQuantityCase: true };
    const metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const context = await readContext(company, staff);
      if (context?.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)) throw Error('Original quantity company context required');
      const selected = projectQuantityCases(context, context.activity).filter(row => row.id === request.input.id);
      if (selected.length !== 1) throw Error('Exact original quantity case required');
      const item = selected[0], task = context.tasks.find(t => t.id === item.taskId);
      if (!task) throw Error('Original quantity source task unavailable');
      const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea };
      const orders = projectPurchaseOrders({ company, workspace: context, records: await readPurchaseRecords(company, staff) });
      const builder = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists,
        packingHeld, readPreparation, projectPreparation });
      const rows = await readCurrentProduct({ company, identity, items, store, metrics }), state = builder.buildState(rows);
      const validated = await validateOriginalQuantityCase({ createQuantityCaseOperations, company, staff, requestId: request.requestId, input: request.input, context, now });
      if (validated.event.initiatedByStaffId !== staff.staffId || validated.event.description !== item.customerDemandTaskId
        || validated.event.imageAltText !== item.taskId || validated.event.details.caseId !== item.id) throw Error('Original quantity decision event conflict');
      return { state, rows, event: validated.event };
    });
    return { ...prepareProcurementTransition({ ...snapshot.rows, after: snapshot.rows.state, generation: snapshot.generation }),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { validateOriginalQuantityCase, createQuantityCasePreparation };
