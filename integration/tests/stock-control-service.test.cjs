const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { projectStockControlPage, createStockControlReader } = load('stockControlService.js');
const source = (id, n = 20) => ({ id, barcode: id, name: 'Product '+id, packing: '12 × 1', ea: 12, specialPurchase: true,
  customerId: 'C', requested: 0, ord: 0, po: 'PO-'+id, procurement: { totalCtn: n, customerCtn: 0 },
  warehouse: { hasPhysicalReceipt: true, accepted: n }, netCostCtn: 123, originalCostSnapshot: { secret: true } });
const context = tasks => ({ company: 'NCT', tasks, activity: [], customers: [{ id: 'C', name: 'Customer' }] });
const member = { _id: 'MEMBER', loginEmail: 'warehouse@example.test', status: 'APPROVED' };
const staff = { title: 'STAFF', description: 'MEMBER', staffEmail: member.loginEmail, staffStatus: 'ACTIVE', staffName: 'Example', departments: ['WAREHOUSE'] };

test('stock list reads real projected receipts and hides zero balances by default', () => {
  const page = projectStockControlPage(context([source('A'), source('ZERO', 0)]));
  assert.equal(page.items.length, 1); assert.equal(page.items[0].onHand, 20); assert.equal(page.items[0].available, 20);
  assert.equal(page.permissions.adjust, false); assert.equal(page.completeness, 'RECORDED_SOURCES_ONLY');
  assert.equal(projectStockControlPage(context([source('A'), source('ZERO', 0)]), { filter: 'ALL' }).items.length, 2);
});
test('financial and raw business fields never leave the quantity-only response', () => {
  const data = JSON.stringify(projectStockControlPage(context([source('A')])));
  assert.equal(/netCost|secret|originalCost|referenceCost|financeApproval/.test(data), false);
});
test('pagination captures one version and rejects a changed stock balance', () => {
  const before = context([source('A'), source('B'), source('C')]);
  const page = projectStockControlPage(before, { pageSize: 1 });
  assert.equal(page.total, 3); assert.equal(page.nextCursor.offset, 1);
  assert.equal(projectStockControlPage(before, { pageSize: 1, cursor: page.nextCursor }).items[0].barcode, 'B');
  assert.throws(() => projectStockControlPage(context([source('A', 10), source('B'), source('C')]), { cursor: page.nextCursor }), /changed/);
});
test('unknown source ownership stays visible and is never published as free stock', () => {
  const task = source('A'); task.specialPurchase = false; delete task.procurement.customerCtn; task.ord = 20;
  const page = projectStockControlPage(context([task]), { filter: 'REVIEW' });
  assert.equal(page.total, 1); assert.equal(page.items[0].available, null); assert.equal(page.counts.reviewProducts, 1);
});
test('invalid input cannot trigger context reads and inactive employees cannot access stock', async () => {
  let reads = 0;
  const reader = createStockControlReader({ readMember: async () => member, readStaffRecords: async () => [{ ...staff, staffStatus: 'INACTIVE' }], readContext: async () => { reads++; return context([]); } });
  await assert.rejects(() => reader('OTHER'), /Select/);
  await assert.rejects(() => reader('NCT', { pageSize: 10000 }), /filters/);
  await assert.rejects(() => reader('NCT'), /not authorized/);
  assert.equal(reads, 0);
});
test('warehouse and management authorize on server; Support alone does not', async () => {
  for (const record of [staff, { ...staff, departments: [], role: 'TOP MANAGEMENT' }, { ...staff, departments: [], role: 'SUPER ADMIN' }]) {
    const reader = createStockControlReader({ readMember: async () => member, readStaffRecords: async () => [record], readContext: async () => context([source('A')]) });
    assert.equal((await reader('NCT')).staff.staffName, 'Example');
  }
  const reader = createStockControlReader({ readMember: async () => member, readStaffRecords: async () => [{ ...staff, departments: ['SUPPORT'] }], readContext: async () => context([]) });
  await assert.rejects(() => reader('NCT'), /not authorized/);
});
test('another company context and duplicate member mapping are rejected', async () => {
  const reader = createStockControlReader({ readMember: async () => member, readStaffRecords: async () => [staff], readContext: async () => ({ ...context([]), company: 'GHR' }) });
  await assert.rejects(() => reader('NCT'), /company mismatch/);
  const duplicate = createStockControlReader({ readMember: async () => member, readStaffRecords: async () => [staff, staff], readContext: async () => context([]) });
  await assert.rejects(() => duplicate('NCT'), /not configured/);
});
