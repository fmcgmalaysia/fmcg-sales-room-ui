'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createCurrentPurchaseSave } = require('../prototypes/stock-current-state/current-department-saves.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function extract(file, expression) {
  const filename = require.resolve('./' + file);
  const source = fs.readFileSync(filename, 'utf8').replace(/const test\s*=\s*require\('node:test'\)/, 'const test = () => {}');
  return vm.runInNewContext(source + '\n' + expression, { require: createRequire(filename), __dirname: require('node:path').dirname(filename), Map, Buffer });
}
const root = extract('stock-current-purchase-task-web.test.cjs', 'root;');
const purchase = extract('stock-current-purchase-save-v2.test.cjs', '({fixture,quantityFixture});');
const quantity = extract('stock-current-quantity-case.test.cjs', 'currentFixture;');
const shortage = extract('stock-current-shortage-save.test.cjs', 'fixture;');
function driftAfter(deps, employees, admittedReads) {
  let reads = 0;
  deps.readStaffRecords = async () => { reads++; return employees.map(row => ({ ...row, title: reads <= admittedReads ? row.title : 'REISSUED' })); };
  return () => reads;
}

test('actual combined Purchase EDIT root refuses identity drift without a committed price/display plan', async () => {
  const f = await root(true), employees = copy(await f.deps.readStaffRecords());
  const reads = driftAfter(f.deps, employees, 2), before = JSON.stringify([...f.db]);
  assert.equal((await f.api.savePurchaseTasksCurrent('NCT', { ...f.request, stockIdentity: { memberId: 'M', staffId: 'P' } })).ok, false);
  assert.equal(reads(), 3); assert.ok(JSON.stringify([...f.db]) === before);
  assert.equal(f.calls.includes('NCTTasks'), false);
});

for (const operation of ['EDIT', 'ADD_SOURCE', 'QTY']) test(`real v2 ${operation} rejects reissued same-member staff before original tables`, async () => {
  const f = operation === 'QTY' ? await purchase.quantityFixture() : await purchase.fixture(operation === 'ADD_SOURCE');
  const employees = copy(await f.deps.readStaffRecords()), reads = driftAfter(f.deps, employees, 1);
  // Construct AFTER installing the controlled server reader so both actual
  // authentication and captured preparation dependencies see the identity drift.
  const save = createCurrentPurchaseSave({ company: 'NCT', items: f.deps.items, store: f.deps.store, protocol: f.protocol,
    coverage: f.coverage, authorityDependencies: f.deps });
  const request = { ...f.request, stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, stockIdentity: { memberId: 'M', staffId: 'P' } };
  const before = JSON.stringify([...f.db]), tableReads = f.counts().tablesRead;
  await assert.rejects(save(request), /Purchase preparation identity changed/);
  assert.equal(reads(), 2); assert.equal(f.counts().tablesRead, tableReads);
  assert.ok(JSON.stringify([...f.db]) === before);
});

for (const operation of ['QUANTITY_CASE', 'SHORTAGE']) test(`actual ${operation} root refuses changed staff before context, preserving borrowing/claims`, async () => {
  const f = operation === 'QUANTITY_CASE' ? await quantity(true) : await shortage(true);
  for (const task of f.context.tasks) f.db.set('NCTTasks:' + task.id, { _id: task.id, title: task.id, company: 'NCT', _version: 'TASK0',
    description: task.orderId, imageAltText: task.sourceLineId, stockCounterSchema: 2, stockCounterGeneration: 0, stockDispatchedCumulative: 0 });
  let contextReads = 0;
  const originalContext = f.deps.readContext;
  f.deps.readContext = async (...args) => { contextReads++; return originalContext(...args); };
  const employees = copy(await f.deps.readStaffRecords()), reads = driftAfter(f.deps, employees, 2);
  const api = await root(true, true, f), request = { ...(operation === 'QUANTITY_CASE' ? f.request('RECEIPT') : f.request),
    operation, stockIdentity: { memberId: 'M', staffId: 'P' } }, before = JSON.stringify([...f.db]);
  assert.equal((await api.api.savePurchaseTasksCurrent('NCT', request)).ok, false);
  assert.equal(reads(), 3); assert.equal(contextReads, 0);
  assert.ok(JSON.stringify([...f.db]) === before);
});
