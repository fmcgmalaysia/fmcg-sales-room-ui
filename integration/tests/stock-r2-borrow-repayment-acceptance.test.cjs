'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const { createRequire } = require('node:module'), load = require('./load-master-module.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs'), { copy } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const { verifyR2BorrowRepayment } = require('../prototypes/stock-current-state/r2-borrow-repayment-acceptance.cjs');
const runtime = { ...require('../prototypes/stock-current-state/current-department-saves.cjs'),
  ...require('../prototypes/stock-current-state/sdk-conditional-store.cjs'), ...require('../prototypes/stock-current-state/segmented-fenced-proof.cjs') };
const original = Object.assign({}, ...['purchaseProjection.js','purchaseOrderWorkflow.js','warehouseReceiving.js','plannerAllocation.js','customerShipmentLedger.js','packingListOperations.js','packingListModel.js'].map(name => load(name)),
  require('../prototypes/stock-current-state/current-model.cjs'));
function fixture() {
  const file = require.resolve('./stock-r2-cas-native-acceptance.test.cjs');
  const base = vm.runInNewContext(fs.readFileSync(file, 'utf8').replace("const test=require('node:test')", 'const test=()=>{}') + ';fixture;', { require: createRequire(file), Map, Buffer, __dirname });
  const f = base('SPT-R2BORROW-20261025-6c93:'), query = f.items.query;
  f.items.query = name => { const q = query(name); q.startsWith = (key, prefix) => { let limit = 1; q.limit = n => { limit = n; return q; };
    q.find = async () => { const rows = [...f.rows.values()].filter(row => String(row[key]).startsWith(prefix)); return { items: copy(rows.slice(0, limit)), totalCount: rows.length }; }; return q; }; return q; };
  return { ...f, run: (step, enabled = true) => verifyR2BorrowRepayment({ items: f.items, runtime, original, hash, copy, input: { step }, enabled }) };
}
test('new fixed fixture defaults closed, rejects injected capabilities and never removes business or fixture records', async () => {
  const f = fixture(); assert.equal((await f.run('SEED', false)).blocked, true); assert.equal(f.rows.size, 0);
  await assert.rejects(verifyR2BorrowRepayment({ input: { step: 'SEED', enabled: true } }));
  const source = require('../prototypes/stock-current-state/build-r2-borrow-repayment.cjs').source;
  assert.match(source, /webMethod\(Permissions.Admin/); assert.match(source, /R2_BORROW_REPAYMENT_ENABLED=false/);
  assert.doesNotMatch(source, /SPT-COMMIT300-|SPT-R2CAPACITY-|SPT-R2INTAKE300-|items\.remove\(/);
});
test('actual command composition borrows30, receipt20 repays20, receipt80 clears debt without duplicating borrower ALLOC', async t => {
  const f = fixture(); assert.equal((await f.run('SEED')).ok, true);
  const seed = copy([...f.rows]); assert.equal((await f.run('SEED')).ok, false); assert.deepEqual(copy([...f.rows]), seed);
  const checkpoints = [];
  for (const [step, generation] of [['BORROW',1],['RECEIVE_PARTIAL',2],['RECEIVE_REST',3]]) {
    let result, rounds = 0;
    do { result = await f.run(step); assert.equal(result.ok, true, JSON.stringify(result)); assert.ok(++rounds < 30); } while (result.pending);
    assert.equal(result.generation, generation); const receipt = await f.run('INSPECT'); assert.equal(receipt.ok, true, JSON.stringify(receipt)); checkpoints.push(receipt);
  }
  assert.deepEqual(checkpoints.map(r => [r.onHand,r.borrowerAllocated,r.lenderAllocated,r.repaid]), [[100,30,70,0],[120,30,90,20],[200,100,100,30]]);
  assert.equal(checkpoints[2].debtClosed, true); assert.equal(checkpoints[2].receiptCount, 2);
  assert.equal(checkpoints[2].activationReady, false); assert.equal(checkpoints[2].staffAuthorizationAccepted, false);
  const final = copy([...f.rows]); assert.equal((await f.run('RECEIVE_REST')).ok, false); assert.deepEqual(copy([...f.rows]), final);
  assert.ok(f.calls.every(([action]) => action !== 'remove')); t.diagnostic(JSON.stringify({ localOnly: true, checkpoints }));
});
test('unknown insert response stops the fixture without a second write, delete, reset or adopting the occupied seed', async () => {
  const f = fixture(), insert = f.items.insert; let attempts = 0;
  f.items.insert = async (...args) => { const result = await insert(...args); if (++attempts === 1) throw Error('SIMULATED_UNKNOWN_RESPONSE'); return result; };
  const result = await f.run('SEED'); assert.equal(result.ok, false); assert.equal(result.error, 'SIMULATED_UNKNOWN_RESPONSE');
  assert.equal(result.retainRequest, true); assert.equal(result.noAutomaticRetryResetOrCleanup, true);
  assert.equal(attempts, 1); assert.equal(f.rows.size, 1);
  const before = copy([...f.rows]); assert.equal((await f.run('SEED')).ok, false); assert.deepEqual(copy([...f.rows]), before); assert.equal(attempts, 1);
});
