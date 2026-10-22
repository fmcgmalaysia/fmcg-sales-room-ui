'use strict';

const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { createPackingHoldSnapshot } = require('./packing-hold-snapshot.cjs');
const { legacyPreparationGuard } = require('./legacy-preparation-guard.cjs');
const { currentTaskContext } = require('./current-task-context.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const count = value => Number.isSafeInteger(value) && value >= 0;
// Server-owned ORIGINAL facts plus exact current ownership rows. Shared by Purchase
// and Warehouse candidates, NOT a new staff entitlement or a legacy inc fallback.
function originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readPreparation, projectPreparation }) {
  const key = stockKey(identity);
  if (identity.company !== company || context.company !== company || !Array.isArray(context.tasks)
    || !Array.isArray(context.activity) || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
  const matching = context.tasks.filter(t => t.barcode === identity.barcode && t.packing === identity.packing && t.ea === identity.ea);
  if (matching.some(t => t.company && t.company !== company)) throw Error('Source company conflict');
  const demands = matching.filter(t => !t.procurementSource && !t.specialPurchase);
  const name = matching.find(t => typeof t.name === 'string' && t.name.trim())?.name || '';
  const candidates = matching.filter(t => t.po && t.procurement?.totalCtn > 0);
  const allocations = readAllocations(context.activity), shipments = readCustomerShipments(context.activity);
  if (shipments.some(s => s.company !== company)) throw Error('Shipment company conflict');
  const sources = candidates.map(source => {
    // ORIGINAL projector emits an explicit fixed customerCtn when shares exist.
    // Ordinary PO plans instead expose its already-computed expectedExtra. This
    // is the same original source/customer split, not a history/zero guess. An
    // explicitly unknown fixed share remains unknown and must still refuse.
    const customerShare=Object.hasOwn(source.procurement,'customerCtn')?source.procurement.customerCtn:
      count(source.procurement.expectedExtra)&&source.procurement.expectedExtra<=source.procurement.totalCtn
        ?source.procurement.totalCtn-source.procurement.expectedExtra:null;
    const po = orders.filter(p => p.company === company && p.taskIds.includes(source.id));
    const candidateOwner = source.customerDemandTaskId || source.id;
    const ownerTaskId = demands.some(t => t.id === candidateOwner) ? candidateOwner : null;
    if (po.length !== 1 || po[0].number !== source.po || source.procurement.draftPlan
      || ownerTaskId === null && customerShare !== 0 || !count(customerShare)
      || customerShare > source.procurement.totalCtn
      || source.warehouse && source.warehouse.hasPhysicalReceipt !== true && source.warehouse.accepted > 0) throw Error('Confirmed source PO and customer share required');
    const dispatchedByTask = {};
    for (const shipment of shipments.filter(s => s.status === 'DISPATCHED')) for (const line of shipment.lines) {
      const n = line.sources.find(s => s.sourceTaskId === source.id)?.quantity || 0;
      if (n) dispatchedByTask[line.taskId] = (dispatchedByTask[line.taskId] || 0) + n;
    }
    return { ...identity, id: source.id, ownerTaskId, poId: po[0].id, orderId: source.orderId, sourceLineId: source.sourceLineId,
      poValid: true, reviewRequired: false, receiptPolicy: ownerTaskId === null || allocations.some(a => a.sourceTaskId === source.id) ? 'EXPLICIT_ONLY' : 'OWNER_DEMAND',
      ownerShare: customerShare, planned: source.procurement.totalCtn,
      accepted: source.warehouse?.hasPhysicalReceipt === true ? source.warehouse.accepted : 0, dispatchedByTask };
  });
  const holds = createPackingHoldSnapshot({ readPackingLists, packingHeld })({ company, activity: context.activity, taskIds: demands.map(t => t.id) });
  const legacyHeld = shipments.filter(s => ['REQUESTED', 'INVOICED'].includes(s.status));
  for (const shipment of legacyHeld) for (const line of shipment.lines) if (Object.hasOwn(holds.heldByTask, line.taskId)) holds.heldByTask[line.taskId] += line.quantity;
  const legacy = legacyPreparationGuard({ company, context, taskIds: demands.map(t => t.id), readPreparation, projectPreparation });
  holds.legacyBlockedByTask = legacy.blockedByTask;
  holds.version = hash(holds.version, legacyHeld.map(s => [s.id, s.revision]).sort((a, b) => a[0].localeCompare(b[0])), legacy.version);
  const scopeTaskIds = rows => {
    if (!Array.isArray(rows.sourceTaskIds) || !Array.isArray(rows.claims) || !Array.isArray(rows.transfers)) throw Error('Complete operational task scope required');
    return [...new Set([...(rows.demandTaskIds || []), ...sources.filter(s => rows.sourceTaskIds.includes(s.id)).map(s => s.ownerTaskId).filter(Boolean),
      ...rows.claims.map(c => c.taskId), ...rows.transfers.flatMap(r => [r.details.relation.borrowerTaskId, r.details.relation.lenderTaskId])])];
  };
  return { identity, demands, sources, scopeTaskIds, buildState: rows => {
    if (rows.product?.lifecycleVersion != null && rows.product.lifecycleVersion !== 2) throw Error('Unknown product lifecycle checkpoint');
    const currentLifecycle = rows.product?.lifecycleVersion === 2;
    const scoped = rows.scope === 'CURRENT_ACTIVE_PRODUCT';
    if (scoped && (!currentLifecycle || !Array.isArray(rows.sourceTaskIds))) throw Error('Scoped lifecycle checkpoint required');
    const positions = new Map(rows.positions.map(p => [p.sourceTaskId, p]));
    const selectedSources = scoped ? sources.filter(s => rows.sourceTaskIds.includes(s.id)) : sources;
    if (scoped && rows.sourceTaskIds.some(id => !selectedSources.some(s => s.id === id))) throw Error('Current source authority missing');
    const neededTasks = new Set(scoped ? scopeTaskIds(rows) : []);
    let selectedDemands = scoped ? demands.filter(t => neededTasks.has(t.id)) : demands;
    if (scoped && [...neededTasks].some(id => !selectedDemands.some(t => t.id === id))) throw Error('Current demand authority missing');
    if (scoped) selectedDemands = currentTaskContext({ company, context: { company, tasks: selectedDemands },
      taskRows: rows.taskRows, generation: rows.generation }).tasks;
    const currentDispatched = source => Object.fromEntries(rows.claims.filter(c => c.positionId === hash(company, key, 'PURCHASE_SOURCE', source.id))
      .filter(c => c.dispatchedCumulative > 0).map(c => [c.taskId, c.dispatchedCumulative]));
    const selected = selectedSources.map(s => scoped ? { ...s, dispatchedByTask: currentDispatched(s) } : s);
    const tasks = selectedDemands.map(t => {
      const inScope = selected.reduce((n, s) => n + (s.dispatchedByTask[t.id] || 0), 0);
      if (scoped && (t.stockCounterSchema !== 2 || !t.stockCommitVersion || !count(t.stockDispatchedCumulative)
        || t.stockDispatchedCumulative < inScope)) throw Error('Current task dispatch checkpoint required');
      return { ...identity, id: t.id, customerId: t.customerId, orderId: t.orderId, sourceLineId: t.sourceLineId,
        requested: t.requested ?? t.ord, dispatched: scoped ? t.stockDispatchedCumulative : inScope,
        ...(scoped ? { dispatchedOutsideScope: t.stockDispatchedCumulative - inScope } : {}) };
    });
    const selectedHolds = scoped ? { ...holds,
      heldByTask: Object.fromEntries(tasks.map(t => [t.id, holds.heldByTask[t.id]])),
      legacyBlockedByTask: Object.fromEntries(tasks.map(t => [t.id, holds.legacyBlockedByTask[t.id]])) } : holds;
    return { ...identity, name: rows.product?.name || name, complete: true, revision: rows.product?.revision || 0, tasks, packingHolds: selectedHolds,
      ...(scoped ? { scope: 'CURRENT_ACTIVE_PRODUCT' } : {}),
      ...(currentLifecycle ? { lifecycleVersion: 2, nextBorrowSequence: rows.product.nextBorrowSequence } : {}),
      sources: selected.map(s => {
        const p = positions.get(s.id), claims = {}, isolatedClaims = {};
        for (const c of rows.claims.filter(c => c.positionId === hash(company, key, 'PURCHASE_SOURCE', s.id))) {
          if (Object.hasOwn(claims, c.taskId) || !count(c.reservedUsable) || !count(c.isolatedAttributed)) throw Error('Known unique current claims required');
          claims[c.taskId] = c.reservedUsable;
          if (c.isolatedAttributed > 0) isolatedClaims[c.taskId] = c.isolatedAttributed;
        }
        return { ...s, replacementReceived: p?.replacementReceived ?? 0, supplierReturned: p?.supplierReturned ?? 0,
          ...(currentLifecycle ? { borrowRepaidCumulative: p ? p.borrowRepaidCumulative : 0 } : {}),
          onHand: p?.onHand ?? 0, isolated: p?.isolated ?? 0, available: p?.available ?? 0, claims,
          ...(Object.keys(isolatedClaims).length ? { isolatedClaims } : {}) };
      }), relations: rows.transfers.map(r => clone(r.details.relation)) };
  } };
}
module.exports = { originalProductState };
