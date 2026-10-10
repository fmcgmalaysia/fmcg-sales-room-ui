const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../backend/purchaseProjection.js');
function fixture() {
  return { company: 'NCT', staff: { staffId: 'STAFF', staffName: 'OPERATOR' }, suppliers: [],
    orders: [{ title: 'ORDER', sourceLineId: 'LINE', submissionId: 'SUB', customerId: 'CUSTOMER',
      customerCompanyName: 'CUSTOMER COMPANY', description: '00123', image: 'PRODUCT', imageAltText: 'SIZE x16',
      orderId: 16, orderQtyInCtn: 250, sellingPricePc: 14.66, adminFxSource: 1, cbmCtn: null,
      submittedByStaffName: 'SALESPERSON', transactionCurrency: 'MYR' }],
    tasks: [{ title: 'TASK', description: 'ORDER', imageAltText: 'LINE', purchaseQtyInCtn: 250,
      lpPc: 1, lpCtn: 16, disc1: .1, disc2: .05, disc3: 2, receivedQtyInCtn: null,
      originalCostSnapshot: { netCostCtn: 11.68, sellingPricePc: 999, secret: 'NO' }, costStatus: 'ERROR', costErrorReason: 'UNAVAILABLE_CBMPERCTN' }],
    activity: [{ title: 'RECEIPT', description: 'ORDER', action: 'ORDER_RECEIVED', result: 'ACCEPTED',
      details: { submissionId: 'SUB', taskIds: ['TASK'], sourceSnapshot: { sellingPricePc: 14.66, secret: 'NO' } } }]
  };
}
test('Purchase projection joins actual legacy keys and exposes no selling price, FX or source snapshots', async () => {
  const { projectPurchaseWorkspace } = await modulePromise;
  const result = projectPurchaseWorkspace(fixture()), row = result.tasks[0];
  assert.equal(row.barcode, '00123'); assert.equal(row.ea, 16); assert.equal(row.ord, 250);
  assert.equal(row.disc3, 2); assert.equal(row.cbmPerCtn, null); assert.equal(row.inc, null);
  assert.equal(row.netCostCtn, 11.68); assert.equal(row.submittedByName, 'SALESPERSON');
  assert.doesNotMatch(JSON.stringify(result), /sellingPrice|adminFx|sourceSnapshot|secret|999/);
});
test('partially persisted intake has no visible orders or tasks before receipt commit', async () => {
  const { projectPurchaseWorkspace } = await modulePromise;
  const data = fixture(); data.activity[0].action = 'INTAKE_PREPARED';
  const result = projectPurchaseWorkspace(data); assert.equal(result.tasks.length, 0); assert.equal(result.customers.length, 0);
});
test('unrelated financial activity cannot leak through the Purchase task history', async () => {
  const { projectPurchaseWorkspace } = await modulePromise;
  const data = fixture(); data.activity.push({ title:'FINANCE',description:'ORDER',imageAltText:'TASK',
    action:'CUSTOMER_SALES_INVOICE',message:'Selling price secret 14.66' });
  assert.doesNotMatch(JSON.stringify(projectPurchaseWorkspace(data)),/Selling price secret/);
});
test('incomplete accepted receipt is a visible error, not an empty successful workspace', async () => {
  const { projectPurchaseWorkspace } = await modulePromise;
  const data = fixture(); data.activity[0].details.taskIds.push('MISSING');
  assert.throws(() => projectPurchaseWorkspace(data), /missing a task/);
});
test('company mapping uses actual GHR collection IDs and rejects untrusted company names', async () => {
  const { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } = await modulePromise;
  assert.equal(PURCHASE_COLLECTIONS.GHR.orders, 'NCTOrders1');
  assert.throws(() => projectPurchaseWorkspace({ ...fixture(), company: '../NCT' }), /Select NCT or GHR/);
});
test('Master access requires approved actual member and exactly one active staff binding', async () => {
  const { requirePurchaseStaff } = await modulePromise;
  const member = { _id: 'MEMBER', loginEmail: 'staff@example.test', status: 'APPROVED' };
  const row = { staffEmail: member.loginEmail, staffStatus: 'ACTIVE', sourceStaffId: 'STAFF', staffName: 'OPERATOR', departments: ['PURCHASE'] };
  assert.equal(requirePurchaseStaff(member, [row]).staffId, 'STAFF');
  assert.throws(() => requirePurchaseStaff(member, []), /not configured/);
  assert.throws(() => requirePurchaseStaff(member, [row, row]), /not configured/);
  assert.throws(() => requirePurchaseStaff({ ...member, status: 'PENDING' }, [row]), /approved/);
  assert.throws(() => requirePurchaseStaff(member, [{ ...row, departments: ['ACCOUNT'] }]), /not authorized/);
  assert.throws(() => requirePurchaseStaff(member, [{ ...row, staffStatus: 'SUSPENDED' }]), /not authorized/);
});
