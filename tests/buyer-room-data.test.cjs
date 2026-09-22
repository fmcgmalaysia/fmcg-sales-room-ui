const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const collections = new Map();
let failNextLineInsert = false;
function rows(name) { if (!collections.has(name)) collections.set(name, []); return collections.get(name); }
function result(items, pageSize, offset = 0) {
  const page = items.slice(offset, offset + pageSize);
  return { items: page, hasNext: () => offset + pageSize < items.length, next: async () => result(items, pageSize, offset + pageSize) };
}
const wixData = {
  query(name) {
    const predicates = [];
    let sort = '', pageSize = 50;
    const query = {
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      hasSome(key, values) { predicates.push(row => values.includes(row[key])); return query; },
      lt(key, value) { predicates.push(row => row[key] < value); return query; },
      descending(key) { sort = key; return query; },
      limit(value) { pageSize = value; return query; },
      async find() {
        const found = rows(name).filter(row => predicates.every(predicate => predicate(row)));
        if (sort) found.sort((a, b) => String(b[sort] || '').localeCompare(String(a[sort] || '')));
        return result(found, pageSize);
      }
    };
    return query;
  },
  async get(name, id) {
    const row = rows(name).find(item => item._id === id);
    if (!row) throw new Error('Not found');
    return { ...row };
  },
  async insert(name, item) {
    if (name === 'WixBuyerOrderLines' && failNextLineInsert) { failNextLineInsert = false; throw new Error('Temporary write failure'); }
    const id = item._id || `id-${rows(name).length + 1}`;
    if (rows(name).some(row => row._id === id)) throw new Error('Duplicate ID');
    const next = { ...item, _id: id };
    rows(name).push(next);
    return { ...next };
  },
  async update(name, item) {
    const index = rows(name).findIndex(row => row._id === item._id);
    if (index < 0) throw new Error('Not found');
    rows(name)[index] = { ...item };
    return { ...item };
  }
};

const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'catalogueAuth.web.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export const /gm, 'const ');
const api = new Function('webMethod', 'Permissions', 'currentMember', 'wixData', 'getSecret', 'httpsRequest',
  `${source}\nreturn { getBuyerWorkspace, getBuyerOrderPage, submitBuyerOrder, recoverBuyerItem };`)(
  (_permission, handler) => handler,
  { SiteMember: 'SiteMember' },
  { getMember: async () => ({ _id: 'member-1', loginEmail: 'buyer@example.com' }) },
  wixData,
  async () => '',
  () => { throw new Error('Unexpected network request'); }
);

test('history passes 1000 records and repeated submissions create one order', async () => {
  rows('WixCustomerUsers').push({ _id: 'user-1', wixMemberId: 'member-1', customerId: 'CUS-1', email: 'buyer@example.com', status: 'ACTIVE', primaryUser: true });
  rows('WixCustomers').push({ _id: 'customer-1', customerId: 'CUS-1', title: 'Test Buyer', preferredCurrency: 'USD' });
  for (let index = 0; index < 1025; index++) {
    const orderId = `ORD-CUS-1-${String(index).padStart(3, '0')}`;
    const confirmedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
    rows('WixBuyerOrders').push({ _id: `old-${index}`, title: orderId, customerId: 'CUS-1', orderId, orderSortKey: `${confirmedAt}|${orderId}`, isComplete: true, payload: JSON.stringify({ customerId: 'CUS-1', orderId, confirmedAt, lineCount: 1, status: 'CONFIRMED' }) });
  }
  rows('WixBuyerOrders').push({ _id: 'other', title: 'ORD-OTHER', customerId: 'OTHER', orderId: 'ORD-OTHER', orderSortKey: '2027|ORD-OTHER', isComplete: true, payload: '{}' });
  const workspace = await api.getBuyerWorkspace();
  assert.equal(workspace.orders.length, 20);
  assert.ok(workspace.ordersNextCursor);
  const allOrders = [...workspace.orders];
  let cursor = workspace.ordersNextCursor;
  while (cursor) {
    const page = await api.getBuyerOrderPage(cursor);
    assert.ok(page.orders.length <= 20);
    allOrders.push(...page.orders);
    cursor = page.nextCursor;
  }
  assert.equal(new Set(allOrders.map(order => order.orderId)).size, 1025);

  rows('WixBuyerListItems').push({ _id: 'selection-1', title: 'CUS-1|111', customerId: 'CUS-1', productId: 'product-1', removed: false, payload: JSON.stringify({ customerId: 'CUS-1', productId: 'product-1', unitBarcode: '111', itemName: 'Item', packingSize: '1 CTN', quoteStatus: 'VIEW QUOTE', vipPriceCtn: 10, ea: 1 }) });
  rows('FMCGMALAYSIA').push({ _id: 'product-1', barcode: '111', title: 'Item' });
  const requestId = '11111111-1111-4111-8111-111111111111';
  const first = await api.submitBuyerOrder([{ itemId: 'selection-1', quantityCtn: 2 }], '', requestId);
  const repeated = await api.submitBuyerOrder([{ itemId: 'selection-1', quantityCtn: 2 }], '', requestId);
  assert.equal(first.orderId, repeated.orderId);
  assert.equal(rows('WixBuyerOrders').length, 1027);
  assert.equal(rows('WixBuyerOrderLines').length, 1);
  assert.equal(rows('WixOrderAudit').length, 1);
  assert.equal(JSON.parse(rows('WixBuyerOrders').find(row => row._id === requestId).payload).isComplete, true);

  failNextLineInsert = true;
  const retryId = '22222222-2222-4222-8222-222222222222';
  await assert.rejects(api.submitBuyerOrder([{ itemId: 'selection-1', quantityCtn: 1 }], '', retryId), /Temporary write failure/);
  assert.equal(JSON.parse(rows('WixBuyerOrders').find(row => row._id === retryId).payload).isComplete, false);
  const recovered = await api.submitBuyerOrder([{ itemId: 'selection-1', quantityCtn: 1 }], '', retryId);
  assert.equal(recovered.status, 'CONFIRMED');
  assert.equal(rows('WixBuyerOrderLines').length, 2);
  assert.equal(rows('WixOrderAudit').length, 2);

  for (let index = 0; index < 99; index++) rows('WixBuyerListItems').push({ _id: `active-${index}`, title: `CUS-1|active-${index}`, customerId: 'CUS-1', removed: false, payload: JSON.stringify({ customerId: 'CUS-1', removed: false }) });
  rows('WixBuyerListItems').push({ _id: 'removed-1', title: 'CUS-1|removed', customerId: 'CUS-1', removed: true, payload: JSON.stringify({ customerId: 'CUS-1', removed: true }) });
  await assert.rejects(api.recoverBuyerItem('removed-1'), /100-product limit/);
});
