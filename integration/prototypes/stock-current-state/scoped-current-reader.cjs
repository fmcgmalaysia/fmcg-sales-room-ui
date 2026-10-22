'use strict';

// Server-only candidate. Call inside common readSnapshot, with migration-verified
// transfer index version from private control, never from the browser. No history
// fallback and no ACTIVE switch. Output is operational scope, not full history.
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { copy } = require('./segmented-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
async function readScopedCurrentProduct({ company, identity, items, store, transferIndexVersion,
  sourceTaskIds = [], demandTaskIds = [], claimPairs = [], correctionSourceIds = [], pageSize = 50, maxRowsPerSet = 2000,
  metrics = { queries: 0, exactReads: 0 } }) {
  const key = stockKey(identity), journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1';
  if (!['NCT', 'GHR'].includes(company) || identity.company !== company || typeof items?.query !== 'function'
    || typeof store?.read !== 'function' || transferIndexVersion !== 2) throw Error('Verified scoped current dependencies/index required');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger(maxRowsPerSet) || maxRowsPerSet < 1
    || !Array.isArray(sourceTaskIds) || !Array.isArray(demandTaskIds) || !Array.isArray(correctionSourceIds) || !Array.isArray(claimPairs)
    || sourceTaskIds.length + demandTaskIds.length + correctionSourceIds.length + claimPairs.length > maxRowsPerSet
    || [...sourceTaskIds, ...demandTaskIds, ...correctionSourceIds].some(id => typeof id !== 'string' || !id)
    || claimPairs.some(p => !p || typeof p.sourceTaskId !== 'string' || !p.sourceTaskId || typeof p.taskId !== 'string' || !p.taskId)) throw Error('Explicit bounded current scope required');
  function known(row, collection, id) {
    if (!row || row._id !== id || row.company !== company || row.stockKey !== key || !row._version
      || !count(row.revision) || !['ACTIVE', 'CLOSED'].includes(row.status) || row.reviewRequired === true || row.reviewCodes?.length) throw Error('Known exact current row required');
    if (collection === 'StockPositions' && (!['receiptAccepted', 'borrowRepaidCumulative', 'onHand', 'isolated', 'available', 'reservedUsable', 'dispatched'].every(f => count(row[f]))
      || row.borrowRepaidCumulative > row.receiptAccepted || row.onHand !== row.isolated + row.available + row.reservedUsable)) throw Error('Source current checkpoint requires review');
    if (collection === 'StockClaims' && (!count(row.dispatchedCumulative) || !count(row.reservedUsable) || !count(row.isolatedAttributed)
      || id !== hash(company, row.positionId, row.taskId))) throw Error('Claim current checkpoint requires review');
    if (collection === journal) {
      const r = row.details?.relation;
      if (row.action !== 'STOCK_TRANSFER_CURRENT' || !r || row._id !== hash(company, 'STOCK_TRANSFER_CURRENT', r.id)
        || row.replacementSourceId !== r.replacementSourceId || row.lenderSourceId !== r.lenderSourceId || row.repaidQuantity !== r.repaid
        || !count(r.quantity) || !r.quantity || !count(r.repaid) || !count(r.returned || 0) || r.repaid + (r.returned || 0) > r.quantity
        || row.status !== (r.quantity === r.repaid + (r.returned || 0) ? 'CLOSED' : 'ACTIVE')
        || !Array.isArray(row.participantTaskIds) || row.participantTaskIds.length !== 2
        || !row.participantTaskIds.includes(r.borrowerTaskId) || !row.participantTaskIds.includes(r.lenderTaskId)) throw Error('Transfer current index conflict');
    }
    return row;
  }
  const cache = new Map();
  async function exact(collection, id) {
    const address = collection + '/' + id;
    if (!cache.has(address)) {
      metrics.exactReads++;
      const row = await store.read(collection, id);
      cache.set(address, row ? copy(known(row, collection, id)) : null);
    }
    return cache.get(address);
  }
  // Cursor queries are complete sets, not first-page sums. Count changes, missing
  // pages, duplicates, overflow and network errors all stop before preparation.
  async function querySet(collection, filters) {
    const result = []; let cursor = null, total;
    do {
      let q = items.query(collection).eq('company', company).eq('stockKey', key);
      for (const [method, field, value] of filters) q = q[method](field, value);
      if (cursor) q = q.gt('_id', cursor);
      metrics.queries++;
      const page = await q.ascending('_id').limit(pageSize).find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || !count(page.totalCount) || page.totalCount > maxRowsPerSet
        || total !== undefined && page.totalCount !== total - result.length
        || page.items.length !== Math.min(pageSize, page.totalCount)) throw Error('Incomplete scoped current set');
      if (total === undefined) total = page.totalCount;
      for (const listed of page.items) {
        if (typeof listed?._id !== 'string' || !listed._id || cursor && listed._id <= cursor) throw Error('Scoped current cursor conflict');
        const row = await exact(collection, listed._id);
        if (!row || filters.some(([method, field, value]) => method === 'eq' ? row[field] !== value : !(row[field] > value))) throw Error('Scoped current query changed');
        result.push(row); cursor = listed._id;
      }
    } while (result.length < total);
    return result;
  }
  const product = await exact('StockProducts', hash(company, key));
  if (product && (product.lifecycleVersion !== 2 || !Number.isSafeInteger(product.nextBorrowSequence) || product.nextBorrowSequence < 1
    || !['onHand', 'reservedUsable', 'available', 'isolated'].every(f => count(product[f]))
    || product.onHand !== product.reservedUsable + product.available + product.isolated)) throw Error('Product lifecycle checkpoint requires review');
  const positions = new Map((await querySet('StockPositions', [['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  const claims = new Map((await querySet('StockClaims', [['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  const transfers = new Map((await querySet(journal, [['eq', 'action', 'STOCK_TRANSFER_CURRENT'], ['eq', 'status', 'ACTIVE']])).map(row => [row._id, row]));
  for (const sourceId of new Set(correctionSourceIds)) {
    const rows = await querySet(journal, [['eq', 'action', 'STOCK_TRANSFER_CURRENT'], ['eq', 'replacementSourceId', sourceId], ['gt', 'repaidQuantity', 0]]);
    for (const row of rows) transfers.set(row._id, row);
  }
  const requiredSources = new Set([...sourceTaskIds, ...correctionSourceIds, ...claimPairs.map(p => p.sourceTaskId)]), pairs = [...claimPairs];
  for (const claim of claims.values()) {
    const position = await exact('StockPositions', claim.positionId);
    if (!position) throw Error('Active claim source missing'); positions.set(position._id, position);
  }
  for (const row of transfers.values()) {
    const r = row.details.relation;
    requiredSources.add(r.lenderSourceId); requiredSources.add(r.replacementSourceId);
    for (const sourceTaskId of [r.lenderSourceId, r.replacementSourceId]) {
      for (const taskId of [r.lenderTaskId, r.borrowerTaskId]) pairs.push({ sourceTaskId, taskId });
    }
  }
  for (const id of requiredSources) {
    const row = await exact('StockPositions', hash(company, key, 'PURCHASE_SOURCE', id));
    if (row) { if (row.sourceTaskId !== id) throw Error('Source stable identity conflict'); positions.set(row._id, row); }
  }
  for (const position of positions.values()) {
    if (position._id !== hash(company, key, 'PURCHASE_SOURCE', position.sourceTaskId)) throw Error('Source stable identity conflict');
    requiredSources.add(position.sourceTaskId);
    // Only this source's nonzero dispatch provenance, not all CLOSED product claims.
    for (const row of await querySet('StockClaims', [['eq', 'positionId', position._id], ['gt', 'dispatchedCumulative', 0]])) claims.set(row._id, row);
  }
  for (const { sourceTaskId, taskId } of pairs) {
    const positionId = hash(company, key, 'PURCHASE_SOURCE', sourceTaskId);
    const row = await exact('StockClaims', hash(company, positionId, taskId));
    if (row) {
      if (row.positionId !== positionId || row.taskId !== taskId || !positions.has(positionId)) throw Error('Claim stable identity conflict');
      claims.set(row._id, row);
    }
  }
  if (positions.size > maxRowsPerSet || claims.size > maxRowsPerSet || transfers.size > maxRowsPerSet || requiredSources.size > maxRowsPerSet) throw Error('Scoped current fanout policy');
  if (!product && (positions.size || claims.size || transfers.size)) throw Error('Product checkpoint missing; no historical fallback');
  return { complete: true, scope: 'CURRENT_ACTIVE_PRODUCT', planFormat: 'SEGMENTED_V2', sourceTaskIds: [...requiredSources], demandTaskIds: [...new Set(demandTaskIds)],
    positions: [...positions.values()], claims: [...claims.values()], transfers: [...transfers.values()].sort((a, b) => a.details.relation.sequence - b.details.relation.sequence), product };
}
module.exports = { readScopedCurrentProduct };
