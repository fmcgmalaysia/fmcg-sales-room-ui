'use strict';

// Bounded current-row preparation candidate. Authority callback is SERVER-owned and
// must retain existing permission/PO/packing/finance checks. No production imports.
const { stockKey } = require('./current-model.cjs');
const { hash } = require('./commit-proof.cjs');
const { prepareBorrowApproval, prepareBorrowReturn, prepareBorrowingReceipt } = require('./borrowing-stock-plan.cjs');
const copy = row => JSON.parse(JSON.stringify(row));
function createBorrowingStockReader({ company, items, store, protocol, readAuthority }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || typeof readAuthority !== 'function') throw Error('Server borrowing dependencies required');
  return async () => {
    const metrics = { exactReads: 0, queries: 0 };
    const snapshot = await protocol.readSnapshot(async () => {
      const authority = await readAuthority();
      const identity = authority?.identity || authority?.state;
      if (!identity || identity.company !== company || !['APPROVE', 'RETURN', 'RECEIVE'].includes(authority.kind)
        || !authority.state && typeof authority.buildState !== 'function') throw Error('Verified borrowing authority required');
      const key = stockKey(identity), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
      async function exact(collection, id) {
        metrics.exactReads++;
        return copy(await store.read(collection, id));
      }
      async function completeRows(collection, max, action) {
        let q = items.query(collection).eq('company', company).eq('stockKey', key);
        if (action) q = q.eq('action', action);
        const page = await q.ascending('_id').limit(max + 1).find({ consistentRead: true, returnTotalCount: true });
        metrics.queries++;
        if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0
          || page.totalCount > max || page.items.length !== page.totalCount
          || new Set(page.items.map(row => row._id)).size !== page.items.length) throw Error('Incomplete bounded borrowing snapshot');
        const rows = [];
        for (const listed of page.items) {
          if (typeof listed._id !== 'string' || !listed._id || listed.company !== company || listed.stockKey !== key
            || action && listed.action !== action) throw Error('Borrowing query scope conflict');
          const row = await exact(collection, listed._id);
          if (!row || row.company !== company || row.stockKey !== key || action && row.action !== action) throw Error('Borrowing snapshot changed');
          rows.push(row);
        }
        return rows;
      }
      // CLOSED stable IDs and closed relations are intentionally included.
      const positions = await completeRows('StockPositions', 14);
      const claims = await completeRows('StockClaims', 60);
      const transfers = await completeRows(journal, 30, 'STOCK_TRANSFER_CURRENT');
      const product = await exact('StockProducts', hash(company, key));
      const rows = { complete: true, positions, claims, transfers, product };
      if (typeof authority.buildState === 'function') authority.state = authority.buildState(rows);
      return { authority, rows };
    });
    const { authority, rows } = snapshot.rows;
    const args = { state: authority.state, rows, event: authority.event, generation: snapshot.generation };
    const result = authority.kind === 'RECEIVE' ? prepareBorrowingReceipt(args)
      : (authority.kind === 'APPROVE' ? prepareBorrowApproval : prepareBorrowReturn)({ ...args, input: authority.input });
    return { ...result, generation: snapshot.generation, metrics };
  };
}
module.exports = { createBorrowingStockReader };
