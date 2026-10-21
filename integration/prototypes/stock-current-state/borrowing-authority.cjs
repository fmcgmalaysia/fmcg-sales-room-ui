'use strict';

// Server authority candidate using existing auth, PO projection, allocation/shipment
// parsers and packing rules. No browser-supplied staff/poValid/complete fields accepted.
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { transferId } = require('./borrowing-stock-plan.cjs');
const { originalProductState } = require('./original-product-state.cjs');
const count = value => Number.isSafeInteger(value) && value >= 0;
function createBorrowingAuthority({ readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords,
  projectPurchaseOrders, readAllocations, readCustomerShipments, readPackingLists, packingHeld, readTransfer, now = () => new Date() }) {
  for (const fn of [readMember, readStaffRecords, requirePurchaseStaff, readContext, readPurchaseRecords, projectPurchaseOrders,
    readAllocations, readCustomerShipments, readPackingLists, packingHeld, readTransfer]) if (typeof fn !== 'function') throw Error('Existing server authority dependency required');
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
    const records = await readPurchaseRecords(company, staff);
    const orders = projectPurchaseOrders({ company, workspace: context, records });
    const product = originalProductState({ company, context, orders, identity, readAllocations, readCustomerShipments, readPackingLists, packingHeld });
    const { sources, demands } = product;
    const donorId = relation?.lenderSourceId || input.lenderSourceId, futureId = relation?.replacementSourceId || input.replacementSourceId;
    const donor = sources.find(s => s.id === donorId), future = sources.find(s => s.id === futureId);
    if (!donor || !future || future.ownerTaskId !== borrowerId) throw Error('Matching lender and borrower POs required');
    const affected = [borrower, demands.find(t => t.id === donor.ownerTaskId)];
    if (affected.some(t => !t || t.salesInvoiceNumber || t.salesInvoiceLocked)) throw Error('Invoiced customer allocation requires its existing correction workflow');
    const safeInput = kind === 'APPROVE'
      ? { expectedRevision: input.expectedRevision, id: hash(company, requestId, member._id, 'BORROW'), quantity: input.quantity,
        lenderSourceId: donorId, replacementSourceId: futureId, borrowerTaskId: borrowerId, approvedBy: staff.staffId, reason: input.reason.trim() }
      : { expectedRevision: input.expectedRevision, relationId: input.relationId, quantity: input.quantity, approvedBy: staff.staffId, reason: input.reason.trim() };
    const eventId = hash(company, requestId, member._id, kind === 'APPROVE' ? 'BORROW_APPROVED' : 'BORROW_RETURNED');
    const event = { _id: eventId, title: eventId, description: safeInput.id || safeInput.relationId,
      action: kind === 'APPROVE' ? 'STOCK_TRANSFER_APPROVED' : 'STOCK_TRANSFER_RETURNED', result: 'SAVED',
      activityTime: now().toISOString(), actorType: 'STAFF', initiatedByStaffId: staff.staffId, initiatedByStaffName: staff.staffName,
      details: { company, [kind === 'APPROVE' ? 'approval' : 'return']: safeInput } };
    return { kind, identity, input: safeInput, event, memberId: member._id, buildState: product.buildState };
  };
}
module.exports = { createBorrowingAuthority };
