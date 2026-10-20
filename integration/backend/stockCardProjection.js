import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { stockPosition } from 'backend/inventoryExceptions.js';

const quantity = value => Number.isSafeInteger(value) && value >= 0;
const identity = task => {
  if (!task.barcode || !task.packing || !Number.isSafeInteger(task.ea) || task.ea <= 0) {
    throw Error('Stock product identity requires review.');
  }
  return JSON.stringify([String(task.barcode), String(task.packing), task.ea]);
};

// Candidate read model only. No store, mutation or inferred opening balance.
// Call with an authenticated, company-scoped server workspace and its complete activity.
export function projectStockCard(context) {
  if (!['NCT', 'GHR'].includes(context?.company) || !Array.isArray(context.tasks) || !Array.isArray(context.activity)) {
    throw Error('Stock company workspace is required.');
  }
  const tasks = new Map();
  for (const task of context.tasks) {
    if (!task.id || tasks.has(task.id)) throw Error('Stock source identity requires review.');
    tasks.set(task.id, task);
  }
  const allocations = readAllocations(context.activity);
  const shipments = readCustomerShipments(context.activity);
  if (shipments.some(row => row.company !== context.company)) throw Error('Stock shipment company mismatch.');
  const groups = new Map();
  for (const source of context.tasks) {
    // A transferred customer allocation is not another physical supplier receipt.
    // Do not drop archived customer tasks that still carry real physical stock.
    if (source.warehouse?.hasPhysicalReceipt !== true) continue;
    const key = identity(source);
    const stock = stockPosition(source.id, source.warehouse.accepted, context.activity);
    const issues = [];
    if (stock.cases.some(row => row.company !== context.company)) throw Error('Stock exception company mismatch.');
    const allocation = allocations.find(row => row.sourceTaskId === source.id);
    const claims = new Map((allocation?.targets || []).map(row => [row.taskId, row.quantity]));
    const dispatched = new Map(), shipmentHeld = new Map();
    for (const shipment of shipments.filter(row => row.status !== 'CANCELLED')) {
      for (const line of shipment.lines) {
        const amount = line.sources.find(row => row.sourceTaskId === source.id)?.quantity || 0;
        const target = shipment.status === 'DISPATCHED' ? dispatched : shipmentHeld;
        target.set(line.taskId, (target.get(line.taskId) || 0) + amount);
      }
    }
    const reservations = [];
    for (const taskId of new Set([...claims.keys(), ...dispatched.keys(), ...shipmentHeld.keys()])) {
      const target = tasks.get(taskId);
      if (!target || identity(target) !== key || target.procurementSource || target.specialPurchase) {
        issues.push('ALLOCATION_TARGET_REQUIRES_REVIEW');
      }
      const shipped = dispatched.get(taskId) || 0;
      const allocated = claims.get(taskId) || 0;
      const held = shipmentHeld.get(taskId) || 0;
      if (shipped + held > allocated) issues.push('SHIPMENT_EXCEEDS_ALLOCATION');
      // Support holds are a subset of a planner claim, never an extra deduction.
      reservations.push({ taskId, allocated, dispatched: shipped, shipmentHeld: held,
        remaining: Math.max(0, allocated - shipped, held) });
    }
    const reserved = reservations.reduce((sum, row) => sum + row.remaining, 0);
    const unassigned = Math.max(0, stock.availablePhysical - reserved);
    const shortage = Math.max(0, reserved - stock.availablePhysical);
    if (shortage) issues.push('RESERVED_STOCK_SHORTAGE');
    // An absent explicit allocation is not evidence that customer-specific goods are free.
    // Keep this reconciliation gate until source ownership is explicitly established.
    if (!allocation && stock.availablePhysical > 0) issues.push('OWNERSHIP_NOT_CONFIRMED');
    const ownerId = source.customerDemandTaskId || source.id;
    const owner = tasks.get(ownerId);
    if (!source.specialPurchase && unassigned > 0) {
      const demand = owner?.requested ?? owner?.ord;
      const share = source.procurement?.customerCtn;
      const ownerSent = dispatched.get(ownerId) || 0;
      const ownRemaining = Math.max(0, (claims.get(ownerId) || 0) - ownerSent);
      // Empty targets alone do not release the existing Warehouse own-source entitlement.
      // Unknown legacy source shares require reconciliation instead of guessed free stock.
      const expected = quantity(demand) ? Math.max(0, Math.min(demand, quantity(share) ? share : demand) - ownerSent) : null;
      if (expected === null || expected > ownRemaining) issues.push('OWNERSHIP_NOT_CONFIRMED');
    }
    const cached = source.warehouse.stock?.availablePhysical;
    if (cached !== undefined && cached !== stock.availablePhysical) issues.push('STOCK_SNAPSHOT_MISMATCH');
    const row = { sourceTaskId: source.id, customerDemandTaskId: source.customerDemandTaskId || source.id,
      po: source.po || '', received: stock.received, replacementReceived: stock.replacementReceived,
      dispatched: stock.shipped, excluded: stock.excluded, unresolvedHeld: stock.held,
      usableOnHand: stock.availablePhysical, reserved, unassigned, shortage, reservations,
      available: issues.length ? null : unassigned, issues: [...new Set(issues)] };
    if (!groups.has(key)) groups.set(key, { key: JSON.stringify([context.company, key]), company: context.company,
      barcode: source.barcode, name: source.name || '', packing: source.packing, ea: source.ea, sources: [], incoming: 0 });
    groups.get(key).sources.push(row);
  }
  // Pending P.O.s remain separate from usable stock. No catalogue-only rows are created.
  for (const source of context.tasks) {
    if (!source.po || source.procurement?.draftPlan || !quantity(source.procurement?.totalCtn)) continue;
    const group = groups.get(identity(source));
    if (group) group.incoming += Math.max(0, source.procurement.totalCtn - (source.warehouse?.hasPhysicalReceipt === true ? source.warehouse.accepted : 0));
  }
  const items = [...groups.values()].map(group => {
    const sum = field => group.sources.reduce((total, source) => total + source[field], 0);
    return { ...group, received: sum('received'), dispatched: sum('dispatched'), usableOnHand: sum('usableOnHand'),
      reserved: sum('reserved'), shortage: sum('shortage'), unassigned: sum('unassigned'),
      available: group.sources.some(source => source.available === null) ? null : sum('available'),
      reviewRequired: group.sources.some(source => source.issues.length > 0) };
  }).sort((a, b) => String(a.barcode).localeCompare(String(b.barcode)) || a.key.localeCompare(b.key));
  return { company: context.company, items, reviewRequired: items.some(row => row.reviewRequired) };
}
