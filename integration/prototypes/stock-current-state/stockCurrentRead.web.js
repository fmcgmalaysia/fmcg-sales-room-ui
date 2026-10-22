import wixData from 'wix-data';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { requireWarehouseStaff } from 'backend/warehouseReceiving.js';
import { readCustomerShortNames } from 'backend/customerNamesClient.js';
import { getPurchaseStaffContext } from 'backend/purchaseAccess.js';
import { createHash } from 'crypto';
const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
const WRITERS = Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
// CLOSED until all native writer/cutover acceptance gates pass; no browser grant.
const writerCoverage = Object.freeze({});
const { stockKey } = (() => {
// Pure candidate model. No history reads, CMS mutations, routes or production imports.

const count = value => Number.isSafeInteger(value) && value >= 0;
const nullableCount = value => value === null || count(value);
function total(rows, field) {
  let result = 0;
  for (const row of rows) {
    if (row[field] === null) return null;
    result += row[field];
    if (!count(result)) throw Error('Quantity overflow');
  }
  return result;
}
function stockKey({ company, barcode, packing, ea }) {
  if (!['NCT', 'GHR'].includes(company) || typeof barcode !== 'string' || !barcode
    || typeof packing !== 'string' || !packing || !Number.isSafeInteger(ea) || ea <= 0) throw Error('Product identity required');
  return JSON.stringify([company, barcode, packing, ea]);
}

// Converts ONE existing complete projection during migration/shadow validation only.
// The caller must supply company-scoped tasks and an already authenticated snapshot.
function convertProjectedStock({ snapshot, tasks, generation }) {
  if (!snapshot || !['NCT', 'GHR'].includes(snapshot.company) || !Array.isArray(snapshot.items)
    || !Array.isArray(tasks) || !count(generation)) throw Error('Complete stock snapshot required');
  const company = snapshot.company, taskMap = new Map();
  for (const task of tasks) {
    if (!task.id || taskMap.has(task.id) || task.company && task.company !== company) throw Error('Task identity conflict');
    taskMap.set(task.id, task);
  }
  const positions = [], claims = [], products = [], seenSources = new Set(), seenProducts = new Set();
  for (const item of snapshot.items) {
    if (item.company !== company || !Array.isArray(item.sources)) throw Error('Product company conflict');
    const key = stockKey(item);
    if (seenProducts.has(key)) throw Error('Duplicate product');
    seenProducts.add(key);
    const group = [];
    for (const source of item.sources) {
      const task = taskMap.get(source.sourceTaskId);
      if (!task || seenSources.has(task.id) || stockKey({ ...task, company }) !== key
        || !Array.isArray(source.reservations) || !Array.isArray(source.issues)) throw Error('Source identity conflict');
      if (typeof task.poId !== 'string' || !task.poId) throw Error('Resolved purchase order ID required');
      seenSources.add(task.id);
      for (const field of ['onHand', 'isolated', 'reservedUsable', 'available']) {
        if (!nullableCount(source[field])) throw Error('Invalid current quantity');
      }
      if (![source.received, source.replacementReceived, source.dispatched, source.returned].every(count)) throw Error('Cumulative source basis required');
      if (count(source.onHand) && source.onHand + source.dispatched + source.returned !== source.received + source.replacementReceived) throw Error('Physical source movement conflict');
      if ([source.onHand, source.isolated, source.reservedUsable, source.available].every(count)
        && source.onHand !== source.isolated + source.reservedUsable + source.available) throw Error('Physical balance conflict');
      const positionId = hash(company, key, 'PURCHASE_SOURCE', task.id);
      const issueCodes = [...new Set(source.issues)], targets = new Set();
      const reservationTotal = total(source.reservations, 'remaining');
      const exactClaims = count(source.reservedUsable) && reservationTotal === source.reservedUsable;
      const unknownIsolatedOwner = source.isolated !== 0 && source.reservations.length > 0;
      if (!exactClaims && source.reservations.length) issueCodes.push('CLAIM_USABLE_ATTRIBUTION_REQUIRES_REVIEW');
      if (unknownIsolatedOwner) issueCodes.push('ISOLATED_CLAIM_ATTRIBUTION_REQUIRES_REVIEW');
      for (const reservation of source.reservations) {
        const target = taskMap.get(reservation.taskId);
        if (!target || targets.has(target.id) || stockKey({ ...target, company }) !== key
          || !count(reservation.remaining) || !target.customerId) throw Error('Claim identity conflict');
        targets.add(target.id);
        claims.push({ _id: hash(company, positionId, target.id), schemaVersion: 1, company,
          stockKey: key, positionId, taskId: target.id, customerId: target.customerId,
          orderId: target.orderId || '', sourceLineId: target.sourceLineId || '',
          reservedUsable: exactClaims ? reservation.remaining : null,
          // Existing projection does not identify whose quarantined cartons these are.
          isolatedAttributed: source.isolated === 0 ? 0 : null,
          reviewCodes: [...(!exactClaims ? ['CLAIM_USABLE_ATTRIBUTION_REQUIRES_REVIEW'] : []),
            ...(unknownIsolatedOwner ? ['ISOLATED_CLAIM_ATTRIBUTION_REQUIRES_REVIEW'] : [])],
          revision: 0, checkpointGeneration: generation, status: exactClaims && reservation.remaining === 0 ? 'CLOSED' : 'ACTIVE' });
      }
      if (!source.reservations.length && source.reservedUsable !== 0 && source.reservedUsable !== null) throw Error('Missing ownership claims');
      const position = { _id: positionId, schemaVersion: 1, company, stockKey: key,
        barcode: item.barcode, name: item.name || '', packing: item.packing, ea: item.ea,
        sourceKind: 'PURCHASE_SOURCE', sourceId: task.id, sourceTaskId: task.id, poId: task.poId, poNumber: source.po || '',
        receiptAccepted: source.received, replacementReceived: source.replacementReceived, supplierReturned: source.returned, dispatched: source.dispatched,
        onHand: source.onHand, isolated: source.isolated, reservedUsable: source.reservedUsable,
        available: source.available, reviewCodes: [...new Set(issueCodes)], revision: 0,
        checkpointGeneration: generation,
        status: source.onHand === 0 && !issueCodes.length && reservationTotal === 0 ? 'CLOSED' : 'ACTIVE' };
      positions.push(position); group.push(position);
    }
    if (!group.length) continue;
    const summary = { _id: hash(company, key), schemaVersion: 1, company, stockKey: key,
      barcode: item.barcode, name: item.name || '', packing: item.packing, ea: item.ea,
      onHand: total(group, 'onHand'), isolated: total(group, 'isolated'),
      reservedUsable: total(group, 'reservedUsable'), available: total(group, 'available'),
      reviewRequired: group.some(row => row.reviewCodes.length > 0), revision: 0, checkpointGeneration: generation,
      status: group.every(row => row.status === 'CLOSED') ? 'CLOSED' : 'ACTIVE' };
    for (const field of ['onHand', 'isolated', 'reservedUsable', 'available']) {
      if (summary[field] !== item[field]) throw Error('Projection summary mismatch: ' + field);
    }
    products.push(summary);
  }
  return { company, generation, positions, claims, products,
    activationReady: !products.some(row => row.reviewRequired) };
}

// Repository must filter/sort/page StockProducts BEFORE returning rows; no Activity API.
async function readProductPage({ protocol, repository, company, page = 0, pageSize = 50, search = '' }) {
  if (!['NCT', 'GHR'].includes(company) || !count(page) || !count(pageSize) || !pageSize || pageSize > 100
    || typeof search !== 'string' || search.length > 120 || !count(page * pageSize)) throw Error('Invalid stock page');
  return protocol.readSnapshot(async () => {
    const result = await repository.queryProducts({ company, page, pageSize, search, status: 'ACTIVE',
      consistentRead: true, order: ['barcode', '_id'] });
    if (!Array.isArray(result?.items) || result.items.length > pageSize || !count(result.totalCount)
      || result.items.some(row => row.company !== company || row.status !== 'ACTIVE')) throw Error('Invalid product page');
    return result;
  });
}

return { stockKey, convertProjectedStock, readProductPage };
})();
const { createCurrentQuery } = (() => {
// Isolated read candidate. Caller must authenticate department/company before construction.
// No Activity access, mutation methods, history fallback or production imports.
const fields = {
  StockProducts: ['_id', 'company', 'stockKey', 'barcode', 'name', 'packing', 'ea', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewRequired', 'status', 'revision', 'checkpointGeneration'],
  StockPositions: ['_id', 'company', 'stockKey', 'barcode', 'name', 'packing', 'ea', 'sourceKind', 'sourceId', 'sourceTaskId', 'poId', 'onHand', 'isolated', 'reservedUsable', 'available', 'reviewCodes', 'status', 'revision', 'checkpointGeneration'],
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

return { createCurrentQuery, readCurrentDetailPage };
})();
const { createCurrentReadBarrier } = (() => {
const copy = value => JSON.parse(JSON.stringify(value));
// Query-only control barrier for the actual Warehouse current-read gateway.
// No initialization, mode changes, lock release or business write capability.
function createCurrentReadBarrier({ company, items, coverage = {} }) {
  if (!['NCT', 'GHR'].includes(company) || typeof items?.query !== 'function') throw Error('Current read scope required');
  const journal = company === 'NCT' ? 'NCTActivity' : 'NCTActivity1', id = hash(company, 'STOCK_CONTROL');
  async function readControl() {
    const page = await items.query(journal).eq('_id', id).limit(2).find({ consistentRead: true });
    if (!Array.isArray(page?.items) || page.items.length !== 1) throw Error('Current inventory control unavailable');
    const row = page.items[0];
    if (row._id !== id || row.company !== company || typeof row.stockCommitVersion !== 'string' || !row.stockCommitVersion
      || !Number.isSafeInteger(row.generation) || row.generation < 0 || row.schemaVersion !== 1
      || !['LEGACY', 'SHADOW', 'ACTIVE', 'MAINTENANCE'].includes(row.mode)
      || row.pending !== null && (!row.pending || typeof row.pending.key !== 'string' || typeof row.pending.digest !== 'string')) throw Error('Current inventory control requires review');
    return { _id: id, company, _version: row.stockCommitVersion, generation: row.generation, mode: row.mode,
      schemaVersion: row.schemaVersion, writerBuild: row.writerBuild ?? null,
      transferIndexVersion: row.transferIndexVersion ?? null, pending: copy(row.pending) };
  }
  async function readSnapshot(readRows) {
    const before = await readControl(); if (before.pending) throw Error('Inventory pending');
    // ACTIVE alone is not evidence that every existing stock writer is fenced.
    // This map is supplied only by server construction, never the read request.
    if (before.mode !== 'ACTIVE' || typeof before.writerBuild !== 'string' || !before.writerBuild
      || WRITERS.some(writer => coverage?.[writer]?.verified !== true || coverage[writer].build !== before.writerBuild)) throw Error('Inventory writer coverage incomplete; current reads unavailable');
    const rows = await readRows(copy(before)), after = await readControl();
    if (after.pending || JSON.stringify(before) !== JSON.stringify(after)) throw Error('Inventory changed during read');
    return { generation: after.generation, rows };
  }
  return { readControl, readSnapshot };
}
return { createCurrentReadBarrier };
})();
const { createCurrentStockControlService } = (() => {
const filters = ['ON_HAND', 'AVAILABLE', 'ISOLATED', 'REVIEW', 'ALL'];
const count = n => Number.isSafeInteger(n) && n >= 0;
const copy = value => JSON.parse(JSON.stringify(value));
function criteria(input = {}) {
  const search = input.search ?? '', filter = input.filter ?? 'ON_HAND', pageSize = input.pageSize ?? 50, cursor = input.cursor;
  if (typeof search !== 'string' || search.length > 100 || !filters.includes(filter) || !count(pageSize) || pageSize < 1 || pageSize > 100
    || cursor != null && (!/^[a-f0-9]{32}$/.test(cursor.version || '') || !count(cursor.offset))) throw Error('Stock filters/page require review');
  return { search: search.trim().toLowerCase(), filter, pageSize, cursor };
}
function identity(key, company) {
  if (typeof key !== 'string' || !key || key.length > 2048) throw Error('Stock product identity required');
  let parts; try { parts = JSON.parse(key); } catch (_) { throw Error('Stock product identity required'); }
  if (!Array.isArray(parts) || parts.length !== 4) throw Error('Stock product identity required');
  const value = { company: parts[0], barcode: parts[1], packing: parts[2], ea: parts[3] };
  if (value.company !== company || stockKey(value) !== key) throw Error('Stock product scope conflict');
  return value;
}
function publicProduct(row, company) {
  const product = identity(row.stockKey, company), quantities = ['onHand', 'isolated', 'reservedUsable', 'available'];
  if (row.company !== company || row._id !== hash(company, row.stockKey) || !['ACTIVE', 'CLOSED'].includes(row.status)
    || quantities.some(k => row[k] !== null && !count(row[k])) || !count(row.revision) || !count(row.checkpointGeneration)
    || typeof row.reviewRequired !== 'boolean' || ['barcode', 'packing', 'ea'].some(k => row[k] !== product[k])) throw Error('Current stock product requires review');
  const unknown = quantities.some(k => row[k] === null);
  if (row.onHand !== null && row.isolated !== null && row.isolated > row.onHand) throw Error('Current stock isolation requires review');
  if (!unknown && row.onHand !== row.isolated + row.reservedUsable + row.available) throw Error('Current stock balance requires review');
  return { key: row.stockKey, ...product, name: row.name || '', onHand: row.onHand, reservedUsable: row.reservedUsable, available: row.available,
    isolated: row.isolated, usableOnHand: row.onHand === null || row.isolated === null ? null : row.onHand - row.isolated,
    reviewRequired: unknown || row.reviewRequired, sourceDetails: 'PAGED', checkpointGeneration: row.checkpointGeneration };
}
// ACTIVE-only read service. Original Warehouse/management permission, one shared
// generation barrier, filtered CMS pages/counts. There is NO Activity/history API.
// Explicit CURRENT_STOCK_V1 response requires the paired paginated-detail UI;
// never bind it silently to the old eager row.sources modal.
function createCurrentStockControlService({ company, items, protocol, readMember, readStaffRecords, requireWarehouseStaff, now }) {
  if (!['NCT', 'GHR'].includes(company) || [readMember, readStaffRecords, requireWarehouseStaff, now].some(f => typeof f !== 'function')
    || typeof items?.query !== 'function' || typeof protocol?.readSnapshot !== 'function' || typeof protocol.readControl !== 'function') throw Error('Server current stock dependencies required');
  const repository = createCurrentQuery({ items, company });
  const products = () => items.query('StockProducts').eq('company', company);
  const review = () => ['onHand', 'isolated', 'reservedUsable', 'available'].reduce((q, k) => q.or(products().isEmpty(k)), products().eq('reviewRequired', true));
  function query(search, filter) {
    let q = products();
    q = filter === 'ALL' ? q.and(products().eq('status', 'ACTIVE').or(products().eq('status', 'CLOSED'))) : q.eq('status', 'ACTIVE');
    if (search) q = q.and(products().contains('barcode', search).or(products().contains('name', search)).or(products().contains('packing', search)));
    if (filter === 'ON_HAND') q = q.and(products().gt('onHand', 0).or(review()));
    if (filter === 'AVAILABLE') q = q.gt('available', 0);
    if (filter === 'ISOLATED') q = q.and(products().gt('isolated', 0).or(products().isEmpty('isolated')));
    if (filter === 'REVIEW') q = q.and(review());
    return q;
  }
  async function auth(requestCompany) {
    if (requestCompany !== company) throw Error('Select the authorized stock company');
    const member = await readMember();
    if (!member?._id || member.status !== 'APPROVED') requireWarehouseStaff(member, []);
    return requireWarehouseStaff(member, await readStaffRecords());
  }
  async function guarded(fn) {
    return protocol.readSnapshot(async suppliedControl => {
      const control = suppliedControl || await protocol.readControl();
      if (control.company !== company || control.mode !== 'ACTIVE' || control.schemaVersion !== 1 || control.pending) throw Error('Current inventory is not active; no history fallback');
      return fn();
    });
  }
  async function read(requestCompany, input = {}) {
    const args = criteria(input), staff = await auth(requestCompany), offset = args.cursor?.offset || 0;
    const snapshot = await guarded(async () => {
      const page = await query(args.search, args.filter).ascending('barcode', '_id').skip(offset).limit(args.pageSize)
        .find({ consistentRead: true, returnTotalCount: true });
      if (!Array.isArray(page?.items) || !count(page.totalCount) || page.items.length > args.pageSize || offset > page.totalCount
        || page.items.length !== Math.min(args.pageSize, page.totalCount - offset) || new Set(page.items.map(r => r._id)).size !== page.items.length) throw Error('Current stock page changed/incomplete');
      const result = page.items.map(row => publicProduct(row, company)), totals = {};
      for (const [key, filter] of [['onHandProducts', 'ON_HAND'], ['availableProducts', 'AVAILABLE'], ['isolatedProducts', 'ISOLATED'], ['reviewProducts', 'REVIEW']]) {
        const counted = await query(args.search, filter).limit(1).find({ consistentRead: true, returnTotalCount: true });
        if (!count(counted?.totalCount) || !Array.isArray(counted.items) || counted.items.length !== Math.min(1, counted.totalCount)) throw Error('Current stock count unavailable');
        totals[key] = counted.totalCount;
      }
      return { items: result, total: page.totalCount, counts: totals };
    });
    const version = hash('CURRENT_STOCK_V1', company, snapshot.generation, args.search, args.filter, args.pageSize);
    if (args.cursor && args.cursor.version !== version || snapshot.rows.items.some(row => row.checkpointGeneration > snapshot.generation)) throw Error('Stock changed while paging; refresh');
    return { schema: 'CURRENT_STOCK_V1', company, version, generation: snapshot.generation, readAt: now().toISOString(), offset,
      ...snapshot.rows, nextCursor: offset + snapshot.rows.items.length < snapshot.rows.total ? { version, offset: offset + snapshot.rows.items.length } : null,
      staff: { staffName: staff.staffName }, completeness: 'RECORDED_SOURCES_ONLY', permissions: { read: true, adjust: false, count: false } };
  }
  async function detail(requestCompany, input = {}) {
    const args = criteria(input); identity(input.stockKey, company);
    if (args.search || input.filter !== undefined || !['positions', 'claims'].includes(input.kind)
      || input.kind === 'claims' && (typeof input.positionId !== 'string' || !input.positionId || input.positionId.length > 256)) throw Error('Stock source detail required');
    await auth(requestCompany); const offset = args.cursor?.offset || 0;
    if (offset % args.pageSize) throw Error('Stock detail cursor requires review');
    const snapshot = await guarded(async () => {
      const selected = await products().eq('stockKey', input.stockKey).limit(2).find({ consistentRead: true, returnTotalCount: true });
      if (selected.totalCount !== 1 || selected.items?.length !== 1) throw Error('Exact stock product required');
      const product = publicProduct(selected.items[0], company);
      if (input.kind === 'claims') {
        const source = await items.query('StockPositions').eq('company', company).eq('stockKey', input.stockKey).eq('_id', input.positionId)
          .limit(2).find({ consistentRead: true, returnTotalCount: true });
        if (source.totalCount !== 1 || source.items?.length !== 1) throw Error('Exact company stock source required');
      }
      const page = await repository[input.kind === 'positions' ? 'queryPositions' : 'queryClaims']({ company, status: 'ACTIVE', consistentRead: true,
        page: offset / args.pageSize, pageSize: args.pageSize, ...(input.kind === 'positions' ? { stockKey: input.stockKey } : { positionId: input.positionId }) });
      if (page.items.some(row => row.stockKey !== input.stockKey) || offset > page.totalCount
        || page.items.length !== Math.min(args.pageSize, page.totalCount - offset)) throw Error('Stock detail scope changed');
      return { product, page };
    });
    const version = hash('CURRENT_STOCK_DETAIL_V1', company, snapshot.generation, input.kind, input.stockKey, input.positionId || '', args.pageSize);
    if (args.cursor && args.cursor.version !== version || snapshot.rows.product.checkpointGeneration > snapshot.generation) throw Error('Stock changed while paging; refresh');
    const { product, page } = snapshot.rows;
    const quantities = input.kind === 'positions' ? ['onHand', 'isolated', 'reservedUsable', 'available'] : ['reservedUsable', 'isolatedAttributed'];
    if (page.items.some(row => !count(row.revision) || !count(row.checkpointGeneration) || row.checkpointGeneration > snapshot.generation
      || quantities.some(k => row[k] !== null && !count(row[k])))) throw Error('Stock detail quantity/version requires review');
    return { schema: 'CURRENT_STOCK_DETAIL_V1', company, generation: snapshot.generation, version, product, items: copy(page.items), total: page.totalCount, offset,
      nextCursor: offset + page.items.length < page.totalCount ? { version, offset: offset + page.items.length } : null };
  }
  return { read, detail };
}
return { createCurrentStockControlService };
})();
const transferId = (company, id) => hash(company, 'STOCK_TRANSFER_CURRENT', id);
const { createBorrowCurrentQuery } = (() => {
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
return { createBorrowCurrentQuery };
})();
// Existing builtin Wix Data read context, original staff checks BEFORE data reads.
// Only read builders exposed: no SDK dependency addition or mutation capability.
function privateItems(company) {
  if (!['NCT', 'GHR'].includes(company)) throw Error('Known company required');
  const allowed = new Set(['StockProducts', 'StockPositions', 'StockClaims', company === 'NCT' ? 'NCTActivity' : 'NCTActivity1']);
  const inner = new WeakMap();
  function wrap(query) {
    const wrapped = {}; inner.set(wrapped, query);
    for (const method of ['eq','gt','isEmpty','contains','and','or','ascending','skip','limit']) wrapped[method] = (...args) => wrap(query[method](...args.map(arg => inner.get(arg) || arg)));
    wrapped.find = async () => query.find({ suppressAuth: true, consistentRead: true });
    return wrapped;
  }
  return { query: collection => { if (!allowed.has(collection)) throw Error('Stock read scope violation'); return wrap(wixData.query(collection)); } };
}
async function staffRecords() {
  let page = await wixData.query('StaffMasterAccess').limit(1000).find({ suppressAuth: true, consistentRead: true }), rows = [...page.items];
  while (page.hasNext()) { page = await page.next(); rows.push(...page.items); } return rows;
}
async function read(company, input, detail) {
  try {
    if (JSON.stringify(input || {}).length > 6000) throw Error('Bounded stock request required');
    const items = privateItems(company), protocol = createCurrentReadBarrier({ company, items, coverage: writerCoverage });
    const service = createCurrentStockControlService({ company, items, protocol, requireWarehouseStaff,
      readMember: () => currentMember.getMember({ fieldsets: ['FULL'] }), readStaffRecords: staffRecords, now: () => new Date() });
    const result = await service[detail ? 'detail' : 'read'](company, input);
    if (detail && input?.kind === 'claims') {
      let names = [];
      try { names = await readCustomerShortNames([...new Set(result.items.map(row => row.customerId))]); } catch (_) { result.customerNamesUnavailable = true; }
      result.items = result.items.map(row => ({ ...row, customerName: names.find(name => name.customerId === row.customerId)?.shortName || row.customerId }));
    }
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: /^Stock changed while paging/.test(String(error?.message || '')) ? 'Stock changed. Refresh the stock list. 库存已变动，请刷新列表。' : 'Current inventory unavailable. 库存暂不可读取。' };
  }
}
export const getWarehouseStockControlCurrent = webMethod(Permissions.SiteMember, (company, input) => read(company, input, false));
export const getWarehouseStockSourcesCurrent = webMethod(Permissions.SiteMember, (company, input) => read(company, input, true));
export const getPurchaseStockTransfersCurrent = webMethod(Permissions.SiteMember, async (company, input) => {
  try {
    if (JSON.stringify(input || {}).length > 6000) throw Error('Bounded relation request required');
    const items = privateItems(company), protocol = createCurrentReadBarrier({ company, items, coverage: writerCoverage });
    const query = createBorrowCurrentQuery({ company, items, protocol, authenticate: getPurchaseStaffContext });
    return { ok: true, ...await query(company, input) };
  } catch (_) { return { ok: false, error: 'Borrowing relationships unconfirmed. Refresh and review. 借货关系尚未确认，请刷新核对。' }; }
});
