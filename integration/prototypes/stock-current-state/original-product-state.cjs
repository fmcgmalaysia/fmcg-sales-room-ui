'use strict';

const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { createPackingHoldSnapshot } = require('./packing-hold-snapshot.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const count = value => Number.isSafeInteger(value) && value >= 0;
// Server-owned ORIGINAL facts plus exact current ownership rows. Shared by Purchase
// and Warehouse candidates, NOT a new staff entitlement or a legacy inc fallback.
function originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld }) {
  const key = stockKey(identity);
  if (identity.company !== company || context.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
  const matching = context.tasks.filter(t => t.barcode === identity.barcode && t.packing === identity.packing && t.ea === identity.ea);
  if (matching.some(t => t.company && t.company !== company)) throw Error('Source company conflict');
  const demands = matching.filter(t => !t.procurementSource && !t.specialPurchase);
  const candidates = matching.filter(t => t.po && t.procurement?.totalCtn > 0);
  const allocations = readAllocations(context.activity), shipments = readCustomerShipments(context.activity);
  if (shipments.some(s => s.company !== company)) throw Error('Shipment company conflict');
  const sources = candidates.map(source => {
    const po = orders.filter(p => p.company === company && p.taskIds.includes(source.id));
    const ownerTaskId = source.customerDemandTaskId || source.id;
    if (source.specialPurchase || po.length !== 1 || po[0].number !== source.po || source.procurement.draftPlan
      || !demands.some(t => t.id === ownerTaskId) || !count(source.procurement.customerCtn)
      || source.procurement.customerCtn > source.procurement.totalCtn
      || source.warehouse && source.warehouse.hasPhysicalReceipt !== true && source.warehouse.accepted > 0) throw Error('Confirmed source PO and customer share required');
    const dispatchedByTask = {};
    for (const shipment of shipments.filter(s => s.status === 'DISPATCHED')) for (const line of shipment.lines) {
      const n = line.sources.find(s => s.sourceTaskId === source.id)?.quantity || 0;
      if (n) dispatchedByTask[line.taskId] = (dispatchedByTask[line.taskId] || 0) + n;
    }
    return { ...identity, id: source.id, ownerTaskId, poId: po[0].id, orderId: source.orderId, sourceLineId: source.sourceLineId,
      poValid: true, reviewRequired: false, receiptPolicy: allocations.some(a => a.sourceTaskId === source.id) ? 'EXPLICIT_ONLY' : 'OWNER_DEMAND',
      ownerShare: source.procurement.customerCtn, planned: source.procurement.totalCtn,
      accepted: source.warehouse?.hasPhysicalReceipt === true ? source.warehouse.accepted : 0, dispatchedByTask };
  });
  const holds = createPackingHoldSnapshot({ readPackingLists, packingHeld })({ company, activity: context.activity, taskIds: demands.map(t => t.id) });
  const legacyHeld = shipments.filter(s => ['REQUESTED', 'INVOICED'].includes(s.status));
  for (const shipment of legacyHeld) for (const line of shipment.lines) if (Object.hasOwn(holds.heldByTask, line.taskId)) holds.heldByTask[line.taskId] += line.quantity;
  holds.version = hash(holds.version, legacyHeld.map(s => [s.id, s.revision]).sort((a, b) => a[0].localeCompare(b[0])));
  return { identity, demands, sources, buildState: rows => {
    const positions = new Map(rows.positions.map(p => [p.sourceTaskId, p]));
    const tasks = demands.map(t => ({ ...identity, id: t.id, customerId: t.customerId, orderId: t.orderId, sourceLineId: t.sourceLineId,
      requested: t.requested ?? t.ord, dispatched: sources.reduce((n, s) => n + (s.dispatchedByTask[t.id] || 0), 0) }));
    return { ...identity, complete: true, revision: rows.product?.revision || 0, tasks, packingHolds: holds,
      sources: sources.map(s => {
        const p = positions.get(s.id), claims = {};
        for (const c of rows.claims.filter(c => c.positionId === hash(company, key, 'PURCHASE_SOURCE', s.id))) {
          if (Object.hasOwn(claims, c.taskId) || !count(c.reservedUsable)) throw Error('Known unique current claims required');
          claims[c.taskId] = c.reservedUsable;
        }
        return { ...s, replacementReceived: p?.replacementReceived ?? 0, supplierReturned: p?.supplierReturned ?? 0,
          onHand: p?.onHand ?? 0, isolated: p?.isolated ?? 0, available: p?.available ?? 0, claims };
      }), relations: rows.transfers.map(r => clone(r.details.relation)) };
  } };
}
module.exports = { originalProductState };
