'use strict';

const { originalProductState } = require('./original-product-state.cjs');
const { readCurrentProduct } = require('./current-product-reader.cjs');
const { currentAllocationContext } = require('./current-allocation-context.cjs');
const { prepareProcurementTransition } = require('./borrowing-stock-plan.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
async function validateOriginalShortage({ createShortageOperations, company, staff, requestId, input, workspace, now }) {
  if (!['NCT', 'GHR'].includes(company) || workspace?.company !== company || !Array.isArray(workspace.activity)
    || typeof createShortageOperations !== 'function' || typeof now !== 'function') throw Error('Original shortage context required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', scratch = new Map(), boundary = new Error('Private shortage prepare boundary');
  let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Shortage context scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    all: async c => { scope(c); return copy(workspace.activity); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'PURCHASE_SHORTAGE_DECIDED') throw Error('Unexpected shortage prepare');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Shortage apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private shortage lock removal allowed'); scratch.delete(id);
    }
  };
  const save = createShortageOperations({ store, now, names: { [company]: { activity: journal } }, readWorkspace: async (c, employee) => {
    if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected shortage apply/read'); return copy(workspace);
  } });
  try { await save({ company, staff: copy(staff), requestId, input: { ...copy(input), action: 'SHORTAGE' } }); throw Error('Original shortage boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  if (!captured || reads !== 1 || scratch.size) throw Error('Original shortage preparation incomplete');
  return captured;
}
function createShortageStockPreparation(deps) {
  const { company, readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, createShortageOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld,
    protocol, items, store, now } = deps;
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
    projectPurchaseOrders, createShortageOperations, readAllocations, readCustomerShipments, readPackingLists, packingHeld, now].some(f => typeof f !== 'function')
    || typeof protocol?.readSnapshot !== 'function' || typeof items?.query !== 'function' || typeof store?.read !== 'function') throw Error('Server shortage dependencies required');
  return async request => {
    if (request?.company !== company || typeof request.input?.taskId !== 'string' || !request.input.taskId) throw Error('Known company shortage task required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = { ...requirePurchaseStaff(member, await readStaffRecords()), memberId: member._id }, metrics = { queries: 0, exactReads: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const context = await readContext(company, staff), task = context?.tasks?.find(t => t.id === request.input.taskId);
      if (context?.company !== company || !task) throw Error('Original shortage task unavailable');
      const identity = { company, barcode: task.barcode, packing: task.packing, ea: task.ea };
      const orders = projectPurchaseOrders({ company, workspace: context, records: await readPurchaseRecords(company, staff) });
      const builder = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld });
      const rows = await readCurrentProduct({ company, identity, items, store, metrics }), state = builder.buildState(rows);
      const workspace = currentAllocationContext({ state, context, readAllocations });
      const validated = await validateOriginalShortage({ createShortageOperations, company, staff, requestId: request.requestId, input: request.input, workspace, now });
      if (validated.event.initiatedByStaffId !== staff.staffId || validated.event.imageAltText !== task.id
        || validated.event.description !== task.orderId || validated.event.image !== task.sourceLineId) throw Error('Original shortage event identity conflict');
      return { state, rows, event: validated.event };
    });
    const { state, rows, event } = snapshot.rows;
    return { ...prepareProcurementTransition({ state, after: state, rows, event, generation: snapshot.generation }),
      memberId: staff.memberId, generation: snapshot.generation, metrics };
  };
}
module.exports = { validateOriginalShortage, createShortageStockPreparation };
