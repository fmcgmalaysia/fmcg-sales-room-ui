'use strict';

// Server authority candidate using existing auth, PO projection, allocation/shipment
// parsers and packing rules. No browser-supplied staff/poValid/complete fields accepted.
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { transferId } = require('./borrowing-stock-plan.cjs');
const { createPackingHoldSnapshot } = require('./packing-hold-snapshot.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const count = value => Number.isSafeInteger(value) && value >= 0;
function createBorrowingAuthority({ readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readTransfer, now = () => new Date() }) {
  for (const fn of [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, readTransfer]) if (typeof fn !== 'function') throw Error('Existing server authority dependency required');
  const packingSnapshot = createPackingHoldSnapshot({ readPackingLists, packingHeld });
  return async ({ company, requestId, kind, input }) => {
    if (!['NCT', 'GHR'].includes(company) || !['APPROVE', 'RETURN'].includes(kind) || !input
      || !/^[a-f0-9-]{36}$/i.test(requestId || '') || !count(input.expectedRevision)
      || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000
      || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 9999) throw Error('Valid stock transfer request required');
    const ids = kind === 'APPROVE' ? [input.borrowerTaskId, input.lenderSourceId, input.replacementSourceId] : [input.relationId];
    if (ids.some(id => typeof id !== 'string' || !id || id.length > 128)) throw Error('Stable stock transfer identities required');
    const member = await readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') requirePurchaseStaff(member, []);
    const staff = requirePurchaseStaff(member, await readStaffRecords());
    // Existing auth grants Purchase/Super Admin/Top Management, not a newly invented Planner role.
    const context = await readContext(company, { ...staff, memberId: member._id });
    if (context.company !== company || !Array.isArray(context.tasks) || !Array.isArray(context.activity)
      || new Set(context.tasks.map(t => t.id)).size !== context.tasks.length) throw Error('Authoritative company context required');
    let relation = null, relationKey = null;
    if (kind === 'RETURN') {
      const record = await readTransfer(company, input.relationId);
      if (!record || record._id !== transferId(company, input.relationId) || record.company !== company
        || record.action !== 'STOCK_TRANSFER_CURRENT' || record.details?.relation?.id !== input.relationId) throw Error('Existing transfer unavailable');
      relation = record.details.relation;
      relationKey = record.stockKey;
    }
    const borrowerId = relation?.borrowerTaskId || input.borrowerTaskId;
    const borrower = context.tasks.find(t => t.id === borrowerId);
    if (!borrower || borrower.procurementSource || borrower.specialPurchase) throw Error('Customer demand task required');
    const identity = { company, barcode: borrower.barcode, packing: borrower.packing, ea: borrower.ea }, key = stockKey(identity);
    if (relation && relationKey !== key) throw Error('Transfer product identity conflict');
    const matching = context.tasks.filter(t => t.barcode === identity.barcode && t.packing === identity.packing && t.ea === identity.ea);
    if (matching.some(t => t.company && t.company !== company)) throw Error('Source company conflict');
    const demands = matching.filter(t => !t.procurementSource && !t.specialPurchase);
    const candidates = matching.filter(t => t.po && t.procurement?.totalCtn > 0);
    const records = await readPurchaseRecords(company, staff);
    const orders = projectPurchaseOrders({ company, workspace: context, records });
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
    const donorId = relation?.lenderSourceId || input.lenderSourceId, futureId = relation?.replacementSourceId || input.replacementSourceId;
    const donor = sources.find(s => s.id === donorId), future = sources.find(s => s.id === futureId);
    if (!donor || !future || future.ownerTaskId !== borrowerId) throw Error('Matching lender and borrower POs required');
    const affected = [borrower, demands.find(t => t.id === donor.ownerTaskId)];
    if (affected.some(t => !t || t.salesInvoiceNumber || t.salesInvoiceLocked)) throw Error('Invoiced customer allocation requires its existing correction workflow');
    const holds = packingSnapshot({ company, activity: context.activity, taskIds: demands.map(t => t.id) });
    const legacyHeld = shipments.filter(s => ['REQUESTED', 'INVOICED'].includes(s.status));
    for (const shipment of legacyHeld) for (const line of shipment.lines) if (Object.hasOwn(holds.heldByTask, line.taskId)) holds.heldByTask[line.taskId] += line.quantity;
    holds.version = hash(holds.version, legacyHeld.map(s => [s.id, s.revision]).sort((a, b) => a[0].localeCompare(b[0])));
    const safeInput = kind === 'APPROVE'
      ? { expectedRevision: input.expectedRevision, id: hash(company, requestId, member._id, 'BORROW'), quantity: input.quantity,
        lenderSourceId: donorId, replacementSourceId: futureId, borrowerTaskId: borrowerId, approvedBy: staff.staffId, reason: input.reason.trim() }
      : { expectedRevision: input.expectedRevision, relationId: input.relationId, quantity: input.quantity, approvedBy: staff.staffId, reason: input.reason.trim() };
    const eventId = hash(company, requestId, member._id, kind === 'APPROVE' ? 'BORROW_APPROVED' : 'BORROW_RETURNED');
    const event = { _id: eventId, title: eventId, description: safeInput.id || safeInput.relationId,
      action: kind === 'APPROVE' ? 'STOCK_TRANSFER_APPROVED' : 'STOCK_TRANSFER_RETURNED', result: 'SAVED',
      activityTime: now().toISOString(), actorType: 'STAFF', initiatedByStaffId: staff.staffId, initiatedByStaffName: staff.staffName,
      details: { company, [kind === 'APPROVE' ? 'approval' : 'return']: safeInput } };
    return { kind, identity, input: safeInput, event, memberId: member._id,
      buildState: rows => {
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
            return { ...s, onHand: p?.onHand ?? 0, isolated: p?.isolated ?? 0, available: p?.available ?? 0, claims };
          }), relations: rows.transfers.map(r => clone(r.details.relation)) };
      } };
  };
}
module.exports = { createBorrowingAuthority };
