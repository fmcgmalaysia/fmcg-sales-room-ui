import { operationId } from 'backend/r2purchaseOperationJournal.js';
import { requireWarehouseStaff } from 'backend/r2warehouseReceiving.js';
import { projectStockCard } from 'backend/r2stockCardProjection.js';

const filters = ['ON_HAND', 'AVAILABLE', 'ISOLATED', 'REVIEW', 'ALL'];
function criteria(input = {}) {
  const search = input.search ?? '', filter = input.filter ?? 'ON_HAND', pageSize = input.pageSize ?? 50;
  if (typeof search !== 'string' || search.length > 100 || !filters.includes(filter)
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Error('Stock filters require review.');
  const cursor = input.cursor;
  if (cursor != null && (!cursor || !/^[a-f0-9]{32}$/.test(cursor.version || '') || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)) throw Error('Stock page requires review.');
  return { search: search.trim().toLowerCase(), filter, pageSize, cursor };
}
const present = row => row.onHand === null || row.onHand > 0 || row.usableOnHand > 0 || row.reviewRequired;

// Pure current-stock response. Only quantity and source identity fields leave the server.
// Existing full-history replay is retained for correctness until a verified checkpoint
// replaces it; pagination bounds product count, not historical query cost or
// the number of sources within a single product.
export function projectStockControlPage(context, input = {}, readAt = new Date().toISOString()) {
  const query = criteria(input), projected = projectStockCard(context);
  const customers = new Map((context.customers || []).map(row => [row.id, row.name]));
  const items = projected.items.map(row => ({
    key: row.key, company: row.company, barcode: row.barcode, name: row.name, packing: row.packing, ea: row.ea,
    onHand: row.onHand, reservedUsable: row.reservedUsable, available: row.available, isolated: row.isolated,
    usableOnHand: row.usableOnHand, shortage: row.shortage, incoming: row.incoming, reviewRequired: row.reviewRequired,
    sources: row.sources.filter(source => source.onHand === null || source.onHand > 0 || source.shortage > 0
      || source.issues.length > 0 || source.reservations.some(entry => entry.remaining > 0)).map(source => ({
      sourceTaskId: source.sourceTaskId, po: source.po, onHand: source.onHand, usableOnHand: source.usableOnHand,
      reservedUsable: source.reservedUsable, available: source.available, isolated: source.isolated,
      shortage: source.shortage, ownershipBasis: source.ownershipBasis, issues: [...source.issues],
      reservations: source.reservations.filter(entry => entry.remaining > 0).map(entry => ({
        taskId: entry.taskId, customerName: customers.get(context.tasks.find(task => task.id === entry.taskId)?.customerId) || '',
        outstandingQuantity: entry.remaining
      }))
    }))
  }));
  const version = operationId('STOCK_CONTROL', context.company, items);
  if (query.cursor && query.cursor.version !== version) throw Error('Stock changed while paging. Refresh the stock list.');
  const all = items.filter(row => !query.search || [row.barcode, row.name, row.packing].join(' ').toLowerCase().includes(query.search));
  const visible = all.filter(row => query.filter === 'ALL' || query.filter === 'ON_HAND' && present(row)
    || query.filter === 'AVAILABLE' && row.available !== null && row.available > 0
    || query.filter === 'ISOLATED' && (row.isolated === null || row.isolated > 0)
    || query.filter === 'REVIEW' && row.reviewRequired);
  const offset = query.cursor?.offset || 0;
  if (offset > visible.length) throw Error('Stock page changed. Refresh the stock list.');
  const page = visible.slice(offset, offset + query.pageSize);
  return { company: context.company, version, readAt, items: page, offset, total: visible.length,
    nextCursor: offset + page.length < visible.length ? { version, offset: offset + page.length } : null,
    counts: { onHandProducts: all.filter(present).length, availableProducts: all.filter(row => row.available > 0).length,
      isolatedProducts: all.filter(row => row.isolated === null || row.isolated > 0).length,
      reviewProducts: all.filter(row => row.reviewRequired).length },
    completeness: 'RECORDED_SOURCES_ONLY', permissions: { read: true, adjust: false, count: false } };
}

export function createStockControlReader({ readMember, readStaffRecords, readContext, now = () => new Date() }) {
  return async (company, input = {}) => {
    if (!['NCT', 'GHR'].includes(company)) throw Error('Select NCT or GHR.');
    criteria(input);
    const member = await readMember();
    if (!member?._id || member.status !== 'APPROVED') throw Error('Please sign in with your approved Master staff account.');
    const staff = requireWarehouseStaff(member, await readStaffRecords());
    const context = await readContext(company, staff);
    if (context.company !== company) throw Error('Stock company mismatch.');
    const result = projectStockControlPage(context, input, now().toISOString());
    return { ...result, staff: { staffName: staff.staffName } };
  };
}
