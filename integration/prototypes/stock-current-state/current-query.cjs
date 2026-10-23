'use strict';

// Isolated read candidate. Caller must authenticate department/company before construction.
// No Activity access, mutation methods, history fallback or production imports.
const fields = {
  StockProducts: ['_id', 'company', 'stockKey', 'barcode', 'name', 'packing', 'ea', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewRequired', 'status', 'revision', 'checkpointGeneration'],
  StockPositions: ['_id', 'company', 'stockKey', 'barcode', 'name', 'packing', 'ea', 'sourceKind', 'sourceId', 'sourceTaskId', 'poId', 'poNumber', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewCodes', 'status', 'revision', 'checkpointGeneration'],
  StockClaims: ['_id', 'company', 'stockKey', 'positionId', 'taskId', 'customerId', 'orderId', 'sourceLineId', 'reservedUsable', 'isolatedAttributed', 'reviewCodes', 'status', 'revision', 'checkpointGeneration']
};
const count = n => Number.isSafeInteger(n) && n >= 0;
const text = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
const copy = value => JSON.parse(JSON.stringify(value));

function createCurrentQuery({ items, company }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function') throw Error('Authorized query scope required');
  function pageArgs(args) {
    if (args?.company !== company || !count(args.page) || !count(args.pageSize) || !args.pageSize
      || args.pageSize > 100 || !count(args.page * args.pageSize) || args.status !== 'ACTIVE'
      || args.consistentRead !== true) throw Error('Invalid current page scope');
  }
  const base = collection => items.query(collection).eq('company', company).eq('status', 'ACTIVE');
  async function run(collection, query, args, matches, order = ['_id']) {
    const page = await query.ascending(...order).skip(args.page * args.pageSize).limit(args.pageSize)
      .find({ consistentRead: true, returnTotalCount: true });
    if (!Array.isArray(page?.items) || page.items.length > args.pageSize || !count(page.totalCount)
      || page.totalCount < page.items.length) throw Error('Invalid current page response');
    const ids = new Set();
    for (const row of page.items) {
      if (!text(row._id, 256) || ids.has(row._id) || row.company !== company || row.status !== 'ACTIVE'
        || !matches(row)) throw Error('Current page identity conflict');
      ids.add(row._id);
    }
    // Explicit display fields only: no operation plans, internal versions or incidental cost.
    return { items: page.items.map(row => Object.fromEntries(fields[collection]
      .filter(field => Object.prototype.hasOwnProperty.call(row, field)).map(field => [field, copy(row[field])]))),
      totalCount: page.totalCount, page: args.page, pageSize: args.pageSize };
  }
  async function queryProducts(args) {
    pageArgs(args);
    if (typeof args.search !== 'string' || args.search.length > 120
      || JSON.stringify(args.order) !== JSON.stringify(['barcode', '_id'])) throw Error('Invalid product query');
    let query = base('StockProducts');
    const search = args.search.trim();
    if (search) {
      const filter = items.query('StockProducts').contains('barcode', search)
        .or(items.query('StockProducts').contains('name', search))
        .or(items.query('StockProducts').contains('packing', search));
      query = query.and(filter);
    }
    return run('StockProducts', query, args, () => true, ['barcode', '_id']);
  }
  async function queryPositions(args) {
    pageArgs(args);
    if (!text(args.stockKey, 2048)) throw Error('Product identity required');
    return run('StockPositions', base('StockPositions').eq('stockKey', args.stockKey), args,
      row => row.stockKey === args.stockKey);
  }
  async function queryClaims(args) {
    pageArgs(args);
    const byPosition = text(args.positionId, 256), byTask = text(args.taskId, 256);
    if (byPosition === byTask || args.positionId !== undefined && !byPosition
      || args.taskId !== undefined && !byTask) throw Error('Exactly one claim selector required');
    const field = byPosition ? 'positionId' : 'taskId', value = args[field];
    return run('StockClaims', base('StockClaims').eq(field, value), args, row => row[field] === value);
  }
  return { queryProducts, queryPositions, queryClaims };
}

// Uses the same pending/generation barrier as the product page, never sums a detail page.
async function readCurrentDetailPage({ protocol, repository, company, kind, page = 0, pageSize = 50, stockKey, positionId, taskId }) {
  if (!['positions', 'claims'].includes(kind)) throw Error('Invalid current detail kind');
  const args = { company, page, pageSize, status: 'ACTIVE', consistentRead: true,
    ...(kind === 'positions' ? { stockKey } : { positionId, taskId }) };
  return protocol.readSnapshot(() => kind === 'positions' ? repository.queryPositions(args) : repository.queryClaims(args));
}

module.exports = { createCurrentQuery, readCurrentDetailPage };
