'use strict';
const copy = value => JSON.parse(JSON.stringify(value));
// Capture ORIGINAL preparation only. Does not invoice, dispatch, allocate files,
// call FX or perform a business write. Real invoice entry remains disabled.
async function validateOriginalShipment({ company, staff, requestId, input, context, createCustomerFulfilmentOperations,
  currentAllocationVersion, now }) {
  if (!['NCT', 'GHR'].includes(company) || context?.company !== company || !Array.isArray(context.activity)
    || !['SELECT', 'CANCEL', 'DISPATCH'].includes(input?.action) || typeof createCustomerFulfilmentOperations !== 'function'
    || typeof now !== 'function' || context.stockAllocationView === 'CURRENT_V2' && currentAllocationVersion !== 2) throw Error('Original non-invoice shipment validation dependencies required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  const scratch = new Map(), boundary = new Error('Private original shipment prepare boundary'); let captured, reads = 0;
  const scope = c => { if (c !== journal) throw Error('Original shipment journal scope violation'); };
  const store = { read: async (c, id) => { scope(c); return copy(scratch.get(id) || null); },
    insert: async (c, row) => {
      scope(c);
      if (row.action === 'PURCHASE_OPERATION_PREPARED' && row.details?.kind === 'PREPARED') {
        if (captured || scratch.size !== 1 || row.details.plan?.event?.action !== 'CUSTOMER_SHIPMENT_CHANGED') throw Error('Unexpected original shipment preparation');
        captured = copy(row.details.plan); throw boundary;
      }
      if (row.action !== 'PURCHASE_OPERATION_LOCK' || row.details?.kind !== 'LOCK' || scratch.size) throw Error('Legacy shipment apply forbidden');
      scratch.set(row._id, copy(row)); return copy(row);
    }, remove: async (c, id) => { scope(c); if (scratch.get(id)?.action !== 'PURCHASE_OPERATION_LOCK') throw Error('Only private shipment lock release allowed'); scratch.delete(id); } };
  const save = createCustomerFulfilmentOperations({ store, names: { [company]: { activity: journal } }, now,
    readRates: async () => { throw Error('Real invoice/FX not authorized by current shipment validator'); },
    readContext: async (c, actor) => { if (c !== company || actor.memberId !== staff.memberId || ++reads !== 1) throw Error('Unexpected shipment context/apply'); return copy(context); } });
  try { await save({ company, staff: copy(staff), requestId, input: copy(input) }); throw Error('Original shipment prepare boundary not reached'); }
  catch (error) { if (error !== boundary) throw error; }
  const event = captured?.event, shipment = event?.details?.shipment;
  const status = { SELECT: 'REQUESTED', CANCEL: 'CANCELLED', DISPATCH: 'DISPATCHED' }[input.action];
  if (!event || reads !== 1 || scratch.size || event._id !== event.title || event.result !== 'SAVED'
    || event.initiatedByStaffId !== staff.staffId || shipment?.company !== company || shipment.status !== status
    || event.description !== shipment.id || event.image !== shipment.customerId || staff.customerId && staff.customerId !== shipment.customerId) throw Error('Original shipment event identity conflict');
  return captured;
}
module.exports = { validateOriginalShipment };
