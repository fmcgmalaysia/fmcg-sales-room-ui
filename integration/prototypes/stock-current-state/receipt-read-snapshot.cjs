'use strict';

// Private preparation-only read coalescing INSIDE the existing readSnapshot.
// Not a new stock authority: the unchanged scoped reader/model still validate
// every image. No cache escapes preparation, no writes/apply/verify use it.
const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { copy, same, utf8Bytes } = require('./segmented-plan.cjs');
const count = n => Number.isSafeInteger(n) && n >= 0;
async function createReceiptReadSnapshot({ company, products, items, store, transferIndexVersion,
  metrics = { queries: 0, exactReads: 0 }, maxRowsPerSet = 2000, maxSnapshotRows = 10000, maxSnapshotBytes = 8 * 1024 * 1024 }) {
  if (!['NCT', 'GHR'].includes(company) || transferIndexVersion !== 2 || typeof items?.query !== 'function'
    || typeof store?.readMany !== 'function' || typeof store?.normalizeListedRow !== 'function'
    || !Array.isArray(products) || !products.length || products.length > 300
    || !Number.isSafeInteger(maxRowsPerSet) || maxRowsPerSet < 1 || !Number.isSafeInteger(maxSnapshotRows)
    || maxSnapshotRows < 1 || !Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes < 1) throw Error('Private bounded receipt snapshot dependencies required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', keys = new Set(), scopes = new Map(), images = new Map();
  let inputIdentities = 0, imageBytes = 0;
  for (const product of products) {
    const key = stockKey(product.identity), scope = product.stockScope;
    if (product.identity.company !== company || keys.has(key) || !scope
      || ['sourceTaskIds', 'correctionSourceIds', 'claimPairs'].some(field => !Array.isArray(scope[field]))
      || scope.sourceTaskIds.length + scope.correctionSourceIds.length + scope.claimPairs.length > maxRowsPerSet
      || [...scope.sourceTaskIds, ...scope.correctionSourceIds].some(id => typeof id !== 'string' || !id)
      || scope.claimPairs.some(p => !p || typeof p.sourceTaskId !== 'string' || !p.sourceTaskId || typeof p.taskId !== 'string' || !p.taskId)) throw Error('Explicit receipt product scope required');
    keys.add(key); scopes.set(key, scope);
    inputIdentities += 1 + scope.sourceTaskIds.length + scope.correctionSourceIds.length + scope.claimPairs.length;
    if (inputIdentities > maxSnapshotRows) throw Error('Receipt snapshot input policy');
  }
  function put(collection, id, row) {
    if (row && (row._id !== id || row.company !== company || !keys.has(row.stockKey))) throw Error('Receipt snapshot identity conflict');
    const address = collection + '/' + id;
    if (images.has(address) && !same(images.get(address), row)) throw Error('Receipt snapshot image changed');
    if (!images.has(address)) {
      imageBytes += utf8Bytes(JSON.stringify([address, row]));
      if (imageBytes > maxSnapshotBytes) throw Error('Receipt snapshot byte policy');
    }
    images.set(address, row ? copy(row) : null);
    if (images.size > maxSnapshotRows) throw Error('Receipt snapshot row policy');
  }
  function rows(collection) { return [...images].filter(([address, row]) => address.startsWith(collection + '/') && row).map(([, row]) => row); }
  async function exactMany(collection, ids) {
    const requested = [...new Set(ids)];
    // Preserve the old reader's exact confirmation of listed images, now one
    // complete strong batch per <=50 IDs rather than a request for each row.
    for (let offset = 0; offset < requested.length; offset += 2000) {
      const batch = requested.slice(offset, offset + 2000);
      metrics.exactReads += Math.ceil(batch.length / 50);
      const result = await store.readMany(collection, batch);
      if (!Array.isArray(result) || result.length !== batch.length) throw Error('Incomplete receipt exact batch');
      result.forEach((row, index) => put(collection, batch[index], row));
    }
  }
  const matches = (row, filters) => filters.every(([method, field, value]) => method === 'eq' ? row[field] === value : row[field] > value);
  async function loadSet(collection, field, values, filters) {
    const requested = [...new Set(values)];
    for (let offset = 0; offset < requested.length; offset += 50) {
      const batch = requested.slice(offset, offset + 50), allowed = new Set(batch), listedIds = [], perProduct = new Map();
      let cursor = null, total;
      do {
        let q = items.query(collection).eq('company', company).hasSome(field, batch);
        for (const [method, name, value] of filters) q = q[method](name, value);
        if (cursor) q = q.gt('_id', cursor);
        metrics.queries++;
        const page = await q.ascending('_id').limit(100).find({ consistentRead: true, returnTotalCount: true });
        if (!Array.isArray(page?.items) || !count(page.totalCount) || page.totalCount > maxSnapshotRows
          || total !== undefined && page.totalCount !== total - listedIds.length
          || page.items.length !== Math.min(100, page.totalCount)) throw Error('Incomplete receipt current set');
        if (total === undefined) total = page.totalCount;
        for (const raw of page.items) {
          if (typeof raw?._id !== 'string' || !raw._id || cursor && raw._id <= cursor) throw Error('Receipt snapshot cursor conflict');
          const row = store.normalizeListedRow(collection, raw);
          if (!row || !allowed.has(row[field]) || !matches(row, filters)) throw Error('Receipt snapshot query conflict');
          put(collection, raw._id, row); listedIds.push(raw._id); cursor = raw._id;
          perProduct.set(row.stockKey, (perProduct.get(row.stockKey) || 0) + 1);
          if (perProduct.get(row.stockKey) > maxRowsPerSet) throw Error('Receipt snapshot product fanout policy');
        }
      } while (listedIds.length < total);
      await exactMany(collection, listedIds);
    }
  }
  const active = [['eq', 'status', 'ACTIVE']], transfer = [['eq', 'action', 'STOCK_TRANSFER_CURRENT']];
  await exactMany('StockProducts', [...keys].map(key => hash(company, key)));
  await loadSet('StockPositions', 'stockKey', [...keys], active);
  await loadSet('StockClaims', 'stockKey', [...keys], active);
  await loadSet(journal, 'stockKey', [...keys], [...transfer, ...active]);
  const corrections = [...scopes.values()].flatMap(scope => scope.correctionSourceIds);
  await loadSet(journal, 'replacementSourceId', corrections, [...transfer, ['gt', 'repaidQuantity', 0]]);
  const sourceIds = new Set(rows('StockPositions').map(row => row._id)), pairs = [];
  for (const [key, scope] of scopes) {
    for (const source of [...scope.sourceTaskIds, ...scope.correctionSourceIds, ...scope.claimPairs.map(p => p.sourceTaskId)]) sourceIds.add(hash(company, key, 'PURCHASE_SOURCE', source));
    for (const pair of scope.claimPairs) pairs.push({ key, ...pair });
  }
  for (const claim of rows('StockClaims')) sourceIds.add(claim.positionId);
  for (const row of rows(journal)) {
    const r = row.details?.relation;
    if (!r || !r.lenderSourceId || !r.replacementSourceId || !r.lenderTaskId || !r.borrowerTaskId) throw Error('Receipt transfer scope conflict');
    for (const sourceTaskId of [r.lenderSourceId, r.replacementSourceId]) {
      sourceIds.add(hash(company, row.stockKey, 'PURCHASE_SOURCE', sourceTaskId));
      for (const taskId of [r.lenderTaskId, r.borrowerTaskId]) pairs.push({ key: row.stockKey, sourceTaskId, taskId });
    }
  }
  await exactMany('StockPositions', [...sourceIds]);
  const positions = rows('StockPositions');
  await loadSet('StockClaims', 'positionId', positions.map(row => row._id), [['gt', 'dispatchedCumulative', 0]]);
  await exactMany('StockClaims', pairs.map(p => hash(company, hash(company, p.key, 'PURCHASE_SOURCE', p.sourceTaskId), p.taskId)));
  const readablePositions = new Set(positions.map(row => row._id)), correctionSet = new Set(corrections);
  return {
    store: { read: async (collection, id) => {
      const address = collection + '/' + id;
      if (!images.has(address)) throw Error('Receipt snapshot exact scope not prepared');
      return copy(images.get(address));
    } },
    readSet: async (collection, key, filters) => {
      const valid = keys.has(key) && (collection === 'StockPositions' && same(filters, active)
        || collection === 'StockClaims' && (same(filters, active) || filters.length === 2
          && filters[0][0] === 'eq' && filters[0][1] === 'positionId' && readablePositions.has(filters[0][2]) && same(filters[1], ['gt', 'dispatchedCumulative', 0]))
        || collection === journal && (same(filters, [...transfer, ...active]) || filters.length === 3
          && same(filters[0], transfer[0]) && filters[1][0] === 'eq' && filters[1][1] === 'replacementSourceId'
          && correctionSet.has(filters[1][2]) && same(filters[2], ['gt', 'repaidQuantity', 0])));
      if (!valid) throw Error('Receipt snapshot set scope not prepared');
      const selected = rows(collection).filter(row => row.stockKey === key && matches(row, filters)).sort((a, b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
      if (selected.length > maxRowsPerSet) throw Error('Receipt snapshot product fanout policy');
      return copy(selected);
    }
  };
}
module.exports = { createReceiptReadSnapshot };
