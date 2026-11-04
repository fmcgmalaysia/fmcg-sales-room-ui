'use strict';
const { hash } = require('./commit-proof.cjs');
const { transferId } = require('./borrowing-stock-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
const text = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
// Purchase-only relation detail/outstanding read. CLOSED relationship history does
// not enter the active query. One current row per relationship, no task archive flag.
function createBorrowCurrentQuery({ company, items, protocol, authenticate }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof protocol?.readSnapshot !== 'function'
    || typeof authenticate !== 'function') throw Error('Private Purchase relation dependencies required');
  return async (requestCompany, input = {}) => {
    const view = input.view ?? 'TASK', taskId = view === 'OUTSTANDING' ? null : input.taskId, pageSize = input.pageSize ?? 25, cursor = input.cursor;
    if (requestCompany !== company || !['TASK', 'OUTSTANDING'].includes(view) || view === 'TASK' && !text(taskId, 128)
      || view === 'OUTSTANDING' && input.taskId !== undefined || !count(pageSize) || pageSize < 1 || pageSize > 50
      || cursor != null && (!/^[a-f0-9]{32}$/.test(cursor.version || '') || !count(cursor.offset) || cursor.offset % pageSize)) throw Error('Bounded task relation request required');
    const actor = await authenticate(company);
    if (!actor?.memberId || !actor.staffId) throw Error('Original Purchase authorization required');
    const offset = cursor?.offset || 0, journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
    const snapshot = await protocol.readSnapshot(async control => {
      // Index marker may be installed only after complete private migration/parity
      // verifies all current rows. Missing index must NOT look like zero relations.
      if (control?.company !== company || control.mode !== 'ACTIVE' || control.pending || ![1, 2].includes(control.transferIndexVersion)) throw Error('Borrowing relation index not verified');
      let query = items.query(journal).eq('company', company).eq('action', 'STOCK_TRANSFER_CURRENT').eq('status', 'ACTIVE');
      if (taskId) query = query.eq('participantTaskIds', taskId);
      const page = await query.ascending('_id').skip(offset).limit(pageSize).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || !count(page.totalCount) || offset > page.totalCount
        || page.items.length !== Math.min(pageSize, page.totalCount - offset) || new Set(page.items.map(row => row._id)).size !== page.items.length) throw Error('Incomplete relation page');
      return { total: page.totalCount, items: page.items.map(row => {
        const r = row.details?.relation, participants = r && [r.borrowerTaskId, r.lenderTaskId];
        if (row.company !== company || row.action !== 'STOCK_TRANSFER_CURRENT' || row.status !== 'ACTIVE'
          || !r || row._id !== transferId(company, r.id) || !text(r.id, 128) || !text(r.borrowerTaskId, 128) || !text(r.lenderTaskId, 128)
          || r.borrowerTaskId === r.lenderTaskId || taskId && !participants.includes(taskId) || JSON.stringify(row.participantTaskIds) !== JSON.stringify(participants)
          || !text(r.lenderSourceId, 128) || !text(r.replacementSourceId, 128) || !count(r.quantity) || !r.quantity || !count(r.repaid)
          || !count(r.returned ?? 0) || r.repaid + (r.returned || 0) >= r.quantity || !count(row.revision)
          || !count(row.checkpointGeneration) || row.checkpointGeneration > control.generation) throw Error('Current relationship requires review');
        if (control.transferIndexVersion === 2 && (row.lenderSourceId !== r.lenderSourceId
          || row.replacementSourceId !== r.replacementSourceId || row.repaidQuantity !== r.repaid)) throw Error('Current relationship source index requires review');
        // No private plan/version, cost, arbitrary details or old history payload.
        return { id: r.id, borrowerTaskId: r.borrowerTaskId, lenderTaskId: r.lenderTaskId, lenderSourceId: r.lenderSourceId,
          replacementSourceId: r.replacementSourceId, quantity: r.quantity, repaid: r.repaid, returned: r.returned || 0,
          remaining: r.quantity - r.repaid - (r.returned || 0), revision: row.revision };
      }) };
    });
    const version = hash('CURRENT_BORROW_RELATIONS_V1', company, snapshot.generation, view, taskId, pageSize);
    if (cursor && cursor.version !== version) throw Error('Borrowing changed while paging; refresh');
    return { schema: 'CURRENT_BORROW_RELATIONS_V1', company, view, taskId, generation: snapshot.generation, version, offset,
      ...snapshot.rows, halo: snapshot.rows.total > 0,
      nextCursor: offset + snapshot.rows.items.length < snapshot.rows.total ? { version, offset: offset + snapshot.rows.items.length } : null };
  };
}
module.exports = { createBorrowCurrentQuery };
