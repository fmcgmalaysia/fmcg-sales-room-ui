'use strict';

const { stockKey } = require('./current-model.cjs');
const { hash } = require('./commit-proof.cjs');
const copy = row => JSON.parse(JSON.stringify(row));
// Call only INSIDE a shared readSnapshot. Exact reads decode SDK/version metadata;
// list queries establish complete bounded identity sets, including CLOSED rows.
async function readCurrentProduct({ company, identity, items, store, metrics }) {
  const key = stockKey(identity), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  if (!['NCT', 'GHR'].includes(company) || identity.company !== company) throw Error('Current product company required');
  async function exact(collection, id) {
    metrics.exactReads++;
    const row = await store.read(collection, id);
    if (row && row._id !== id) throw Error('Current exact row identity conflict');
    return copy(row);
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
  const positions = await completeRows('StockPositions', 14);
  const claims = await completeRows('StockClaims', 60);
  const transfers = await completeRows(journal, 30, 'STOCK_TRANSFER_CURRENT');
  const product = await exact('StockProducts', hash(company, key));
  const knownRows = [...positions, ...claims, ...transfers, ...(product ? [product] : [])];
  if (knownRows.some(row => row.company !== company || row.stockKey !== key || !row._version || row.reviewRequired === true || row.reviewCodes?.length)
    || !product && (positions.length || claims.length || transfers.length)) throw Error('Current product requires review; no legacy quantity fallback');
  return { complete: true, positions, claims, transfers, product };
}
module.exports = { readCurrentProduct };
