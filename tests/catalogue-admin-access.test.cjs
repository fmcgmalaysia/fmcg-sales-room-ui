const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const collections = new Map();
let member = { _id: 'admin-member', loginEmail: 'admin@example.com' };
function rows(name) { if (!collections.has(name)) collections.set(name, []); return collections.get(name); }
const wixData = {
  query(name) {
    const predicates = [];
    let pageSize = 50;
    const query = {
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      hasSome(key, values) { predicates.push(row => values.includes(row[key])); return query; },
      limit(value) { pageSize = value; return query; },
      async find() { return { items: rows(name).filter(row => predicates.every(predicate => predicate(row))).slice(0, pageSize), hasNext: () => false }; }
    };
    return query;
  },
  async get(name, id) { return rows(name).find(item => item._id === id) || null; },
  async insert(name, item) { const next = { ...item, _id: item._id || `id-${rows(name).length + 1}` }; rows(name).push(next); return { ...next }; },
  async update(name, item) { const index = rows(name).findIndex(row => row._id === item._id); rows(name)[index] = { ...item }; return { ...item }; }
};

const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'catalogueSelection.web.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export const /gm, 'const ');
const api = new Function('webMethod', 'Permissions', 'currentMember', 'wixData', 'getSecret', 'wixRealtimeBackend', 'httpsRequest',
  `${source}\nreturn { getCatalogueSelectionState, addCatalogueSelection };`)(
  (_permission, handler) => handler,
  { SiteMember: 'SiteMember' },
  { getMember: async () => member },
  wixData,
  async () => '',
  { publish: async () => {} },
  () => { throw new Error('Unexpected network request'); }
);

test('Admin can operate every customer Catalogue while audit identity stays Admin', async () => {
  rows('StaffMaster').push({ _id: 'staff-admin', wixMemberId: 'admin-member', staffEmail: 'admin@example.com', staffId: 'LAW', title: 'LAW', role: 'SUPER ADMIN', status: 'ACTIVE' });
  rows('WixCustomers').push({ _id: 'customer-1', customerId: 'CUS-1', title: 'Test Buyer', qdStatus: 'READY', qdFileId: 'QD-1', selectionLimit: 100 });
  rows('FMCGMALAYSIA').push({ _id: 'product-1', name: 'Test Product', barcode: '955500000001', pointBaseStatus: 'ACTIVE' });

  const state = await api.getCatalogueSelectionState('CUS-1');
  assert.equal(state.customerId, 'CUS-1');
  const added = await api.addCatalogueSelection('product-1', 'CUS-1');
  assert.equal(added.ok, true);
  const payload = JSON.parse(rows('WixBuyerListItems')[0].payload);
  assert.equal(payload.selectedByType, 'ADMIN');
  assert.equal(payload.selectedById, 'LAW');
  assert.equal(payload.source, 'ADMIN_CATALOGUE');

  member = { _id: 'sales-member', loginEmail: 'sales@example.com' };
  rows('StaffMaster').push({ _id: 'staff-sales', wixMemberId: 'sales-member', staffEmail: 'sales@example.com', staffId: 'S001', title: 'Sales One', role: 'SALES', status: 'ACTIVE' });
  rows('WixCustomers')[0].assignedStaffId = 'S002';
  await assert.rejects(api.getCatalogueSelectionState('CUS-1'), /assigned to another salesperson/);
});
