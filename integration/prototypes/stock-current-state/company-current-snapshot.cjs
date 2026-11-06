'use strict';

// Private explicit shadow/maintenance snapshot, NOT a normal page read. Operator
// supplies measured read budgets; exceeding them refuses rather than truncates.
async function readCompanyCurrentSnapshot({ company, items, store, protocol, limits, pageSize = 100 }) {
  const names = ['positions', 'claims', 'products', 'transfers'];
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function' || typeof store?.read !== 'function'
    || typeof protocol?.readSnapshot !== 'function' || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    || !limits || names.some(k => !Number.isSafeInteger(limits[k]) || limits[k] < 1)) throw Error('Explicit private snapshot read budgets required');
  const metrics = { queries: 0, exactReads: 0 };
  const snapshot = await protocol.readSnapshot(async () => {
    const result = { company, complete: true };
    for (const [name, collection, action] of [['positions', 'StockPositions'], ['claims', 'StockClaims'], ['products', 'StockProducts'],
      ['transfers', company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', 'STOCK_TRANSFER_CURRENT']]) {
      const rows = [], seen = new Set(); let expected = null;
      do {
        let query = items.query(collection).eq('company', company);
        if (action) query = query.eq('action', action);
        const page = await query.ascending('_id').skip(rows.length).limit(pageSize).find({ consistentRead: true, returnTotalCount: true });
        metrics.queries++;
        if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || page.totalCount > limits[name]
          || expected !== null && expected !== page.totalCount || page.items.length !== Math.min(pageSize, page.totalCount - rows.length)) throw Error('Incomplete or over-budget current company snapshot');
        expected = page.totalCount;
        for (const listed of page.items) {
          if (typeof listed._id !== 'string' || !listed._id || seen.has(listed._id) || listed.company !== company || action && listed.action !== action) throw Error('Company snapshot list scope conflict');
          seen.add(listed._id); metrics.exactReads++;
          const row = await store.read(collection, listed._id);
          if (!row || row._id !== listed._id || row.company !== company || action && row.action !== action) throw Error('Company snapshot exact read changed');
          rows.push(JSON.parse(JSON.stringify(row)));
        }
      } while (rows.length < expected);
      result[name] = rows;
    }
    return result;
  });
  return { ...snapshot.rows, generation: snapshot.generation, metrics };
}
module.exports = { readCompanyCurrentSnapshot };
