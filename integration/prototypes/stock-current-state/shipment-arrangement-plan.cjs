'use strict';

const copy = value => JSON.parse(JSON.stringify(value));
// Original authenticated Sales gateway must supply staff/context under the common
// fence. This seam grants no authority and never calls legacy apply. Batches/date
// remain intent metadata; no stock movement, demand cancellation or allocation.
async function prepareShipmentArrangement({ company, staff, requestId, input, context,
  createSalesShipmentDateOperations, createShipmentPlanOperations, now }) {
  const date = input?.action === 'ORDER_DATE', batch = input?.action === 'PLAN';
  const factory = date ? createSalesShipmentDateOperations : createShipmentPlanOperations;
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || !date && !batch || typeof factory !== 'function' || typeof now !== 'function') throw Error('Original Sales arrangement context required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', expectedAction = date ? 'SALES_SHIPMENT_DATE_SAVED' : 'CUSTOMER_SHIPMENT_PLAN_SAVED';
  const scratch = new Map(), boundary = new Error('Private Sales arrangement boundary'); let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Sales arrangement scope violation'); };
  const store = {
    read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== expectedAction) throw Error('Unexpected Sales arrangement preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Sales arrangement apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => {
      scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private Sales arrangement lock removal allowed'); scratch.delete(id);
    }
  };
  const save = factory({ store, names: { [company]: { activity: journal } }, now, readContext: async (c, employee) => {
    if (c !== company || employee.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected Sales arrangement apply/read'); return copy(context);
  } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original Sales arrangement boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  const event = captured?.event;
  if (!event || reads !== 1 || scratch.size || event._id !== event.title || event.result !== 'SAVED'
    || event.initiatedByStaffId !== staff.staffId || event.image !== input.customerId
    || date && (event.description !== input.orderId || event.details.submissionId !== input.submissionId)
    || batch && (event.details.plan?.company !== company || event.details.plan.orderId !== input.orderId)) throw Error('Original Sales arrangement identity conflict');
  return { plan: { writes: [{ collection: journal, before: null, after: { ...event, company } }] }, event, expectedVersion: input.version };
}
module.exports = { prepareShipmentArrangement };
