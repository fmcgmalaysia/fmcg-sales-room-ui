'use strict';
const { preparePackingHoldTransition } = require('./borrowing-stock-plan.cjs');
const { copy, utf8Bytes } = require('./segmented-plan.cjs');
// Original SELECT/CANCEL reservation only. Neither Loaded nor invoice nor actual
// physical dispatch is inferred from this change in legacy shipment intent.
function prepareSalesShipmentHolds({ company, event, priorShipment, products, generation }) {
  const shipment = event?.details?.shipment;
  if (!['NCT', 'GHR'].includes(company) || event?.action !== 'CUSTOMER_SHIPMENT_CHANGED' || event.result !== 'SAVED'
    || !event._id || event._id !== event.title || !event.initiatedByStaffId || !event.activityTime
    || shipment?.company !== company || !['REQUESTED', 'CANCELLED'].includes(shipment.status)
    || !Array.isArray(shipment.lines) || !shipment.lines.length || !Array.isArray(products) || !products.length
    || shipment.status === 'REQUESTED' && (priorShipment || event.details.beforeRevision)
    || shipment.status === 'CANCELLED' && (priorShipment?.status !== 'REQUESTED' || priorShipment.revision !== event.details.beforeRevision
      || priorShipment.id !== shipment.id || JSON.stringify(priorShipment.lines) !== JSON.stringify(shipment.lines))) throw Error('Original exact shipment reservation transition required');
  const coverage = new Map(shipment.lines.map(line => [line.taskId, 0])), writes = [], states = [];
  if (coverage.size !== shipment.lines.length) throw Error('Distinct shipment hold task coverage required');
  for (const product of products) {
    const covered = shipment.lines.filter(line => product.state.tasks.some(t => t.id === line.taskId));
    if (!covered.length || product.rows.planFormat !== 'SEGMENTED_V2') throw Error('Exact current shipment hold product required');
    const holds = copy(product.state.packingHolds);
    for (const line of covered) {
      const task = product.state.tasks.find(t => t.id === line.taskId);
      if (task.customerId !== shipment.customerId || task.orderId !== line.orderId || task.sourceLineId !== line.sourceLineId
        || !Number.isSafeInteger(line.quantity) || line.quantity < 1) throw Error('Original shipment hold demand conflict');
      coverage.set(task.id, coverage.get(task.id) + 1);
      const delta = shipment.status === 'REQUESTED' ? line.quantity : -line.quantity;
      holds.heldByTask[task.id] += delta;
    }
    const mapped = preparePackingHoldTransition({ ...product, event, generation, packingHolds: holds });
    states.push(mapped.state);
    writes.push(...mapped.plan.writes.filter(w => w.after.action !== 'CUSTOMER_SHIPMENT_CHANGED'));
  }
  if ([...coverage.values()].some(n => n !== 1)) throw Error('Complete shipment hold product coverage required');
  writes.unshift({ collection: company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', before: null, after: { ...copy(event), company } });
  if (new Set(writes.map(w => w.collection + ':' + w.after._id)).size !== writes.length || writes.length > 10000
    || utf8Bytes(JSON.stringify({ writes })) > 8 * 1024 * 1024) throw Error('Shipment hold segmented policy');
  return { plan: { writes }, states };
}
module.exports = { prepareSalesShipmentHolds };
