'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { requireOriginalSalesDelegation } = require('./sales-delegation.cjs');
const { readCurrentSalesWorkspace } = require('./sales-current-workspace.cjs');
const { validateOriginalShipment } = require('./original-shipment-validation.cjs');
const { prepareSalesShipmentHolds } = require('./sales-shipment-hold-plan.cjs');
const { hash } = require('./commit-proof.cjs');
// PRIVATE existing source bearer gateway only, not SiteMember identity input.
function createCurrentSalesShipmentSave({ company, items, store, protocol, coverage, authenticateOriginalDelegation,
  readContext, createCustomerFulfilmentOperations, currentAllocationVersion, now = () => new Date(), ...dependencies }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentAllocationVersion !== 2
    || typeof authenticateOriginalDelegation !== 'function' || typeof readContext !== 'function'
    || typeof createCustomerFulfilmentOperations !== 'function') throw Error('Private original current Sales shipment dependencies required');
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'SHIPMENT', protocol, coverage,
      authenticate: async () => {
        staff = await authenticateOriginalDelegation(company, request); requireOriginalSalesDelegation(staff, request?.input?.customerId);
        if (!['SELECT', 'CANCEL'].includes(request.input.action)) throw Error('Original non-invoice Sales shipment action required');
        return { memberId: staff.memberId,staffId:staff.staffId };
      }, prepare: async command => {
        const metrics = { queries: 0, exactReads: 0 };
        const snapshot = await protocol.readSnapshot(async control => {
          const original = await readContext(company, staff);
          const current = await readCurrentSalesWorkspace({ ...dependencies, company, items, store, staff, control, context: original, metrics });
          const validated = await validateOriginalShipment({ company, staff, requestId: command.requestId, input: command.input,
            context: current.context, createCustomerFulfilmentOperations, currentAllocationVersion, now });
          const shipment = validated.event.details.shipment;
          const ids = new Set(shipment.lines.map(line => line.taskId));
          const products = [...current.products.values()].filter(p => p.state.tasks.some(t => ids.has(t.id)));
          const priorShipment = command.input.action === 'CANCEL' ? dependencies.readCustomerShipments(current.context.activity).find(s => s.id === shipment.id) : null;
          return prepareSalesShipmentHolds({ company, event: validated.event, priorShipment, products, generation: control.generation });
        });
        return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation, metrics };
      } })(request);
    if (result.ok !== true) return result;
    const record = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', hash(company, request.requestId, staff.memberId, 'SHIPMENT_EVENT')));
    const event = record.rows, shipment = event?.details?.shipment;
    if (!event?._version || event.company !== company || event.action !== 'CUSTOMER_SHIPMENT_CHANGED' || event.result !== 'SAVED'
      || event.initiatedByStaffId !== staff.staffId || shipment?.company !== company || shipment.customerId !== staff.customerId
      || shipment.status !== (request.input.action === 'SELECT' ? 'REQUESTED' : 'CANCELLED')) throw Error('Committed shipment receipt identity unconfirmed');
    return { ...result, company, shipmentId: shipment.id, status: shipment.status };
  };
}
module.exports = { createCurrentSalesShipmentSave };
