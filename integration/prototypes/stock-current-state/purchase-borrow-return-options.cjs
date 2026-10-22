'use strict';
const { createBorrowingAuthority } = require('./borrowing-authority.cjs');
const { readScopedCurrentProduct } = require('./scoped-current-reader.cjs');
const { returnUnusedBorrow, validate } = require('./borrowing-model.cjs');
// A remaining debt is NOT proof that its physical cartons can be returned. Quote
// the actual unchanged return rules using current claims/holds/dispatch counters.
function quoteUnusedBorrowReturn({ state, relationId }) {
  validate(state);
  const relation = state.relations.find(r => r.id === relationId);
  if (!relation) throw Error('Current borrowing relationship unavailable');
  const remaining = relation.quantity - relation.repaid - (relation.returned || 0);
  const possible = quantity => {
    try { returnUnusedBorrow(state, { expectedRevision: state.revision, relationId, quantity,
      approvedBy: 'READ_ONLY_QUOTE', reason: 'Read-only unused return eligibility' }); return true; }
    catch (error) {
      if (['Approved unused borrowing return required', 'Borrowed stock already used or held'].includes(error.message)) return false;
      throw error;
    }
  };
  let low = 0, high = Math.min(remaining, 9999);
  while (low < high) { const mid = Math.floor((low + high + 1) / 2); if (possible(mid)) low = mid; else high = mid - 1; }
  return { relationId, borrowerTaskId: relation.borrowerTaskId, lenderTaskId: relation.lenderTaskId,
    lenderSourceId: relation.lenderSourceId, replacementSourceId: relation.replacementSourceId,
    remaining, maximumQuantity: low, expectedRevision: state.revision };
}
function createPurchaseBorrowReturnOptions({ company, items, store, protocol, authorityDependencies: deps }) {
  if (!['NCT', 'GHR'].includes(company) || protocol?.planFormat !== 'SEGMENTED_V2'
    || typeof protocol.readSnapshot !== 'function' || typeof items?.query !== 'function' || typeof store?.read !== 'function') {
    throw Error('Private Purchase unused return dependencies required');
  }
  const authority = createBorrowingAuthority(deps);
  return async (requestCompany, input = {}) => {
    if (requestCompany !== company || typeof input.relationId !== 'string' || !input.relationId || input.relationId.length > 128) {
      throw Error('Exact current borrowing relationship required');
    }
    const member = await deps.readMember();
    if (!member?._id || !member.loginEmail || member.status !== 'APPROVED') deps.requirePurchaseStaff(member, []);
    deps.requirePurchaseStaff(member, await deps.readStaffRecords());
    const snapshot = await protocol.readSnapshot(async control => {
      if (control.company !== company || control.mode !== 'ACTIVE' || control.pending || control.transferIndexVersion !== 2
        || !control.writerBuild) throw Error('Current unused return quote unavailable');
      // In-memory ORIGINAL authority/event only, INSIDE the barrier. No write,
      // journal lock or real request. Actual save reauthorizes and revalidates.
      const current = await authority({ company, requestId: '00000000-0000-4000-8000-000000000000', kind: 'RETURN',
        input: { relationId: input.relationId, expectedRevision: 0, quantity: 1, reason: 'Read-only unused return eligibility' } });
      if (typeof current.readTaskRows !== 'function') throw Error('Private current return task reader required');
      const rows = await readScopedCurrentProduct({ ...current.stockScope, company, identity: current.identity,
        items, store, transferIndexVersion: control.transferIndexVersion });
      if (!rows.product) throw Error('Current borrowing product checkpoint missing');
      rows.taskRows = await current.readTaskRows(rows); rows.generation = control.generation;
      return { schema: 'CURRENT_BORROW_RETURN_OPTIONS_V2', company,
        ...quoteUnusedBorrowReturn({ state: current.buildState(rows), relationId: input.relationId }),
        stockCurrent: { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: control.writerBuild, stockGeneration: control.generation } };
    });
    return snapshot.rows;
  };
}
module.exports = { quoteUnusedBorrowReturn, createPurchaseBorrowReturnOptions };
