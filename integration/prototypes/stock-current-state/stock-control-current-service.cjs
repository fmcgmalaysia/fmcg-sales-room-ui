'use strict';

const { hash } = require('./commit-proof.cjs');
const { stockKey } = require('./current-model.cjs');
const { createCurrentQuery } = require('./current-query.cjs');
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
module.exports = { createCurrentStockControlService };
