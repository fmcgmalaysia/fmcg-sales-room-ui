'use strict';
const { originalProductState } = require('./original-product-state.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { approveBorrow, validate } = require('./borrowing-model.cjs');
// Pure quote, not approval. Reuse the actual approval rules rather than a second
// UI definition of free stock/future capacity. No event/plan/storage mutation.
function quoteBorrowOptions({ state, borrowerTaskId, blockedTaskIds = [], maxPairs = 2000 }) {
  validate(state);
  if (!Number.isSafeInteger(maxPairs) || maxPairs < 1 || !Array.isArray(blockedTaskIds)) throw Error('Bounded borrowing quote scope required');
  const borrower = state.tasks.find(t => t.id === borrowerTaskId);
  if (!borrower) throw Error('Customer borrowing demand unavailable');
  const futures = state.sources.filter(s => s.ownerTaskId === borrowerTaskId && s.ownerShare > s.accepted);
  const donors = state.sources.filter(s => s.ownerTaskId && s.ownerTaskId !== borrowerTaskId && (s.claims[s.ownerTaskId] || 0) > 0);
  if (futures.length * donors.length > maxPairs) throw Error('Borrowing option fanout requires a narrower scope');
  let id = 'READ_ONLY_BORROW_QUOTE'; while (state.relations.some(r => r.id === id)) id += '_';
  const options = [];
  for (const future of futures) for (const donor of donors) {
    if (blockedTaskIds.includes(borrowerTaskId) || blockedTaskIds.includes(donor.ownerTaskId)) continue;
    const possible = quantity => {
      try {
        approveBorrow(state, { expectedRevision: state.revision, id, quantity, borrowerTaskId,
          lenderSourceId: donor.id, replacementSourceId: future.id, approvedBy: 'READ_ONLY_QUOTE', reason: 'Read-only eligibility check' });
        return true;
      } catch (error) {
        if (['Eligible unheld borrower required', 'Packing task holds lender allocation',
          'Insufficient eligible stock, demand or future supply'].includes(error.message)) return false;
        throw error;
      }
    };
    if (!possible(1)) continue;
    let low = 1, high = 9999;
    while (low < high) { const mid = Math.floor((low + high + 1) / 2); if (possible(mid)) low = mid; else high = mid - 1; }
    options.push({ borrowerTaskId, lenderTaskId: donor.ownerTaskId, lenderSourceId: donor.id,
      replacementSourceId: future.id, lenderPoId: donor.poId, replacementPoId: future.poId, maximumQuantity: low });
  }
  return { expectedRevision: state.revision, options };
}
// Private original Purchase gateway composition. The browser supplies a task ID,
// never a staff member, approved PO flag, quantity balance or replacement promise.
function createPurchaseBorrowOptions({ company, items, store, protocol, authorityDependencies: deps, maxPairs = 2000 }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2'
    || typeof protocol.readSnapshot !== 'function' || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || [deps?.readMember, deps?.readStaffRecords, deps?.requirePurchaseStaff, deps?.readContext, deps?.readPurchaseRecords,
      deps?.projectPurchaseOrders, deps?.readCurrentTaskRows].some(fn => typeof fn !== 'function')) throw Error('Private Purchase options dependencies required');
  return async (requestCompany, input = {}) => {
    if (requestCompany !== company || typeof input.borrowerTaskId !== 'string' || !input.borrowerTaskId || input.borrowerTaskId.length > 128) throw Error('Exact Purchase borrower task required');
    const member = await deps.readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') deps.requirePurchaseStaff(member, []);
    const staff = { ...deps.requirePurchaseStaff(member, await deps.readStaffRecords()), memberId: member._id };
    const snapshot = await protocol.readSnapshot(async control => {
      if (control.company !== company || control.mode !== 'ACTIVE' || control.pending || control.transferIndexVersion !== 2
        || !control.writerBuild) throw Error('Current borrowing options unavailable');
      const context = await deps.readContext(company, staff), borrower = context?.tasks?.find(t => t.id === input.borrowerTaskId && !t.procurementSource && !t.specialPurchase);
      if (!borrower) throw Error('Customer borrowing demand unavailable');
      const identity = { company, barcode: borrower.barcode, packing: borrower.packing, ea: borrower.ea };
      const orders = deps.projectPurchaseOrders({ company, workspace: context, records: await deps.readPurchaseRecords(company, staff) });
      const product = originalProductState({ ...deps, company, context, orders, identity });
      const rows = await readScopedCurrentProduct({ company, identity, items, store, transferIndexVersion: control.transferIndexVersion,
        sourceTaskIds: product.sources.filter(s => s.ownerTaskId === borrower.id && s.ownerShare > s.accepted).map(s => s.id), demandTaskIds: [borrower.id] });
      if (!rows.product) throw Error('Current borrowing product checkpoint missing');
      rows.taskRows = await deps.readCurrentTaskRows(company, product.scopeTaskIds(rows), staff); rows.generation = control.generation;
      const quoted = quoteBorrowOptions({ state: product.buildState(rows), borrowerTaskId: borrower.id, maxPairs,
        blockedTaskIds: context.tasks.filter(t => t.salesInvoiceLocked || t.salesInvoiceNumber).map(t => t.id) });
      const labels = new Map(context.tasks.map(t => [t.id, t]));
      return { schema: 'CURRENT_BORROW_OPTIONS_V2', company, borrowerTaskId: borrower.id, ...quoted,
        options: quoted.options.map(option => ({ ...option, lenderPoNumber: labels.get(option.lenderSourceId)?.po,
          replacementPoNumber: labels.get(option.replacementSourceId)?.po,
          lenderCustomerId: labels.get(option.lenderTaskId)?.customerId })),
        stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation } };
    });
    return snapshot.rows;
  };
}
module.exports = { quoteBorrowOptions, createPurchaseBorrowOptions };
