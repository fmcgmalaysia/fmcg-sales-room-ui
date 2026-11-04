const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createBorrowCurrentQuery } = require('../prototypes/stock-current-state/borrow-current-query.cjs');
const { transferId } = require('../prototypes/stock-current-state/borrowing-stock-plan.cjs');
const { requirePurchaseStaff } = load('purchaseProjection.js');
const copy = value => JSON.parse(JSON.stringify(value));
function relation(id, extra = {}) {
  return { _id: transferId('NCT', id), company: 'NCT', action: 'STOCK_TRANSFER_CURRENT', status: 'ACTIVE', participantTaskIds: ['A', 'B'], revision: 1,
    checkpointGeneration: 0, stockCommitVersion: 'PRIVATE', secretCost: 99,
    details: { relation: { id, borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'SB', replacementSourceId: 'SA', quantity: 30, repaid: 0, returned: 0 } }, ...extra };
}
function fixture(rows = [relation('R')]) {
  const calls = [], member = { _id: 'M', loginEmail: 'p@example.test', status: 'APPROVED' }, staff = { title: 'P', description: 'M', staffEmail: member.loginEmail, staffName: 'Purchase', staffStatus: 'ACTIVE', departments: ['PURCHASE'] };
  const control = { company: 'NCT', generation: 0, mode: 'ACTIVE', pending: null, transferIndexVersion: 1 };
  const items = { query: collection => { let predicates = [], offset = 0, size = 25;
    const q = { eq: (key, value) => { predicates.push(row => Array.isArray(row[key]) ? row[key].includes(value) : row[key] === value); return q; },
      ascending: () => q, skip: n => { offset = n; return q; }, limit: n => { size = n; return q; },
      find: async options => { calls.push({ collection, offset, size, options }); const selected = rows.filter(row => predicates.every(fn => fn(row))).sort((a, b) => a._id.localeCompare(b._id));
        return { items: copy(selected.slice(offset, offset + size)), totalCount: selected.length }; } }; return q; } };
  const deps = { company: 'NCT', items, protocol: { readSnapshot: async fn => ({ generation: control.generation, rows: await fn(control) }) },
    authenticate: async () => ({ ...requirePurchaseStaff(member, [staff]), memberId: member._id }) };
  return { deps, rows, calls, member, staff, control, read: createBorrowCurrentQuery(deps) };
}
test('Purchase reads both parties outstanding relationship without raw plans/costs or task archive dependence', async () => {
  const f = fixture();
  for (const taskId of ['A', 'B']) { const page = await f.read('NCT', { taskId }); assert.equal(page.halo, true); assert.equal(page.items[0].remaining, 30);
    assert.equal(/PRIVATE|secretCost|details|stockCommitVersion/.test(JSON.stringify(page)), false); }
  assert.equal((await f.read('NCT', { taskId: 'OTHER' })).halo, false); assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.collection === 'NCTActivity' && call.options.consistentRead));
});
test('closed history growth does not enlarge returned active relation page; cursor binds task and generation', async () => {
  const rows = Array.from({ length: 70 }, (_, i) => relation('R' + i));
  rows.push(...Array.from({ length: 10000 }, (_, i) => relation('OLD' + i, { status: 'CLOSED' })));
  const f = fixture(rows), page = await f.read('NCT', { taskId: 'A', pageSize: 25 });
  assert.equal(page.total, 70); assert.equal(page.items.length, 25); assert.equal(f.calls.length, 1);
  assert.equal((await f.read('NCT', { taskId: 'A', pageSize: 25, cursor: page.nextCursor })).offset, 25);
  await assert.rejects(f.read('NCT', { taskId: 'B', pageSize: 25, cursor: page.nextCursor }), /changed/);
  f.control.generation = 1; await assert.rejects(f.read('NCT', { taskId: 'A', pageSize: 25, cursor: page.nextCursor }), /changed/);
});
test('missing verified participant index is an error, never a false zero/ordinary head', async () => {
  const f = fixture(); f.control.transferIndexVersion = null;
  await assert.rejects(f.read('NCT', { taskId: 'A' }), /index not verified/); assert.equal(f.calls.length, 0);
  for (const mode of ['LEGACY', 'SHADOW', 'MAINTENANCE']) { f.control.transferIndexVersion = 1; f.control.mode = mode; await assert.rejects(f.read('NCT', { taskId: 'A' }), /not verified/); }
  assert.equal(f.calls.length, 0);
});

test('verified v2 source index retains same halo output and rejects contradicting correction index', async () => {
  const f = fixture(); f.control.transferIndexVersion = 2;
  Object.assign(f.rows[0], { lenderSourceId: 'SB', replacementSourceId: 'SA', repaidQuantity: 0 });
  assert.equal((await f.read('NCT', { taskId: 'A' })).halo, true);
  f.rows[0].repaidQuantity = 1;
  await assert.rejects(f.read('NCT', { taskId: 'A' }), /source index requires review/);
});
test('company outstanding view is independent of task archive and cannot mix cursor with task details', async () => {
  const f = fixture([relation('R1'), relation('R2', { archived: true })]);
  const page = await f.read('NCT', { view: 'OUTSTANDING', pageSize: 1 });
  assert.equal(page.total, 2); assert.equal(page.view, 'OUTSTANDING'); assert.equal(page.taskId, null);
  assert.equal((await f.read('NCT', { view: 'OUTSTANDING', pageSize: 1, cursor: page.nextCursor })).items.length, 1);
  await assert.rejects(f.read('NCT', { taskId: 'A', pageSize: 1, cursor: page.nextCursor }), /changed/);
  await assert.rejects(f.read('NCT', { view: 'OUTSTANDING', taskId: 'A' }), /Bounded/);
});
test('Warehouse/Support/unapproved members and foreign company cannot read Purchase relationships', async () => {
  for (const departments of [['WAREHOUSE'], ['SUPPORT']]) { const f = fixture(); f.staff.departments = departments; await assert.rejects(f.read('NCT', { taskId: 'A' })); assert.equal(f.calls.length, 0); }
  const f = fixture(); f.member.status = 'PENDING'; await assert.rejects(f.read('NCT', { taskId: 'A' }));
  await assert.rejects(f.read('GHR', { taskId: 'A' })); assert.equal(f.calls.length, 0);
});
test('unknown repayment, future generation, corrupt participant index and closed-quantity ACTIVE row reject', async () => {
  for (const change of ['unknown', 'generation', 'index', 'settled']) {
    const f = fixture(), row = f.rows[0];
    if (change === 'unknown') row.details.relation.repaid = null;
    if (change === 'generation') row.checkpointGeneration = 2;
    if (change === 'index') row.participantTaskIds = ['A', 'FOREIGN'];
    if (change === 'settled') row.details.relation.repaid = 30;
    await assert.rejects(f.read('NCT', { taskId: 'A' }), /requires review/);
  }
});
