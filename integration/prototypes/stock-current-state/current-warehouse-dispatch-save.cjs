'use strict';
const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { readCurrentWarehouseShipmentWorkspace } = require('./warehouse-shipment-workspace.cjs');
const { validateOriginalShipment } = require('./original-shipment-validation.cjs');
const { prepareWarehouseDispatch } = require('./warehouse-dispatch-plan.cjs');
const { hash } = require('./commit-proof.cjs');
// PRIVATE original fulfilment staffContext callback, not browser permissions.
function createCurrentWarehouseDispatchSave({ company, items, store, protocol, coverage, authenticateOriginalWarehouse,
  readContext, createCustomerFulfilmentOperations, currentAllocationVersion, now = () => new Date(), ...dependencies }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentAllocationVersion !== 2
    || typeof authenticateOriginalWarehouse !== 'function' || typeof readContext !== 'function'
    || typeof createCustomerFulfilmentOperations !== 'function') throw Error('Private original Warehouse dispatch dependencies required');
  return async request => {
    let staff;
    const result = await createCurrentStockSave({ company, writer: 'SHIPMENT', protocol, coverage,
      authenticate: async () => {
        staff = await authenticateOriginalWarehouse(company);
        if (!staff?.memberId || !staff.staffId || staff.canDispatchShipment !== true || staff.customerId
          || request?.input?.action !== 'DISPATCH') throw Error('Original Warehouse dispatch grant required');
        return { memberId: staff.memberId,staffId:staff.staffId };
      }, prepare: async command => {
        const metrics = { exactReads: 0, queries: 0 };
        const snapshot = await protocol.readSnapshot(async control => {
          const current = await readCurrentWarehouseShipmentWorkspace({ ...dependencies, company, items, store, staff, control,
            context: await readContext(company, staff), metrics });
          const validated = await validateOriginalShipment({ company, staff, requestId: command.requestId, input: command.input,
            context: current.context, createCustomerFulfilmentOperations, currentAllocationVersion, now });
          const shipment = validated.event.details.shipment, ids = new Set(shipment.lines.map(l => l.taskId));
          const products = [...current.products.values()].filter(p => p.state.tasks.some(t => ids.has(t.id)));
          const taskRows = products.flatMap(p => p.rows.taskRows.filter(t => ids.has(t._id)));
          return prepareWarehouseDispatch({ event: validated.event,
            priorShipment: dependencies.readCustomerShipments(current.context.activity).find(s => s.id === shipment.id),
            products, taskRows, generation: control.generation, planFormat: 'SEGMENTED_V2' });
        });
        return { ...snapshot.rows, memberId: staff.memberId, generation: snapshot.generation, metrics };
      } })(request);
    if (result.ok !== true) return result;
    const snapshot = await protocol.readSnapshot(() => store.read(company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', hash(company, request.requestId, staff.memberId, 'SHIPMENT_EVENT')));
    const event = snapshot.rows;
    if (!event?._version || event.company !== company || event.action !== 'CUSTOMER_SHIPMENT_CHANGED' || event.result !== 'SAVED'
      || event.initiatedByStaffId !== staff.staffId || event.details?.shipment?.status !== 'DISPATCHED'
      || event.details.shipment.id !== request.input.id) throw Error('Committed physical dispatch receipt unconfirmed');
    return { ...result, company, shipmentId: event.details.shipment.id, status: 'DISPATCHED' };
  };
}
function createCurrentWarehouseShipmentRead({ company, protocol, authenticateOriginalWarehouse, readContext,
  readOriginalCustomerFulfilment, currentFulfilmentVersion, ...dependencies }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2' || currentFulfilmentVersion !== 2
    || [authenticateOriginalWarehouse, readContext, readOriginalCustomerFulfilment].some(fn => typeof fn !== 'function')) throw Error('Private original Warehouse shipment read dependencies required');
  return async requestCompany => {
    if (requestCompany !== company) throw Error('Warehouse shipment read company conflict');
    const staff = await authenticateOriginalWarehouse(company);
    const snapshot = await protocol.readSnapshot(async control => {
      const current = await readCurrentWarehouseShipmentWorkspace({ ...dependencies, company, protocol, control, staff, context: await readContext(company, staff) });
      // Original public gateway still applies its original financial redaction.
      const result = await readOriginalCustomerFulfilment(company, staff, '', current.context);
      if (result?.company !== company) throw Error('Original Warehouse shipment response company changed');
      return { ...result, staff:{...result.staff,staffId:staff.staffId,memberId:staff.memberId}, stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation } };
    });
    return snapshot.rows;
  };
}
module.exports = { createCurrentWarehouseDispatchSave, createCurrentWarehouseShipmentRead };
