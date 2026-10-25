'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('./stock-current-borrow-gateway.test.cjs');
const source = fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}');
const { fixture } = vm.runInNewContext(source + '\n({fixture});', { require: createRequire(filename), Map, Buffer });
const copy = value => JSON.parse(JSON.stringify(value));
const { createCurrentPurchaseBorrowGateway } = require('../prototypes/stock-current-state/current-purchase-borrow-gateway.cjs');
const coverage = Object.fromEntries(require('../prototypes/stock-current-state/stock-admission.cjs').WRITERS.map(w => [w, { verified: true, build: 'TEST' }]));

async function complete(f) {
  let result, attempts = 0;
  do { result = await f.gateway.save('NCT', f.request); assert.ok(attempts++ < 40); } while (result.pending);
  assert.equal(result.ok, true);
}
for (const operation of ['BORROW_APPROVE', 'BORROW_RETURN']) {
  test(`actual ${operation} refuses a reissued staff identity between admission and authority, before staging`, async () => {
    const f = await fixture();
    let request = { ...copy(f.request), stockIdentity: { memberId: 'M1', staffId: 'P1' } };
    if (operation === 'BORROW_RETURN') {
      await complete(f);
      const relation = [...f.db.values()].find(row => row.action === 'STOCK_TRANSFER_CURRENT').details.relation;
      request = { ...request, requestId: '22222222-2222-4222-8222-222222222222', operation, stockGeneration: 1,
        input: { expectedRevision: 1, relationId: relation.id, quantity: 5, reason: 'Unused approved return' } };
    }
    const employees = copy(await f.deps.readStaffRecords()), before = JSON.stringify([...f.db]);
    let staffReads = 0;
    f.deps.readStaffRecords = async () => employees.map(row => ({ ...row, title: ++staffReads === 1 ? row.title : 'REISSUED' }));
    // Authority captures its function dependencies when constructed. Construct
    // AFTER installing the controlled server reader so both real reads use it.
    const gateway = createCurrentPurchaseBorrowGateway({ company: 'NCT', items: f.items, store: f.store, protocol: f.protocol,
      coverage, authorityDependencies: f.deps });
    await assert.rejects(gateway.save('NCT', request), /Borrowing approval identity changed/);
    assert.equal(staffReads, 2);
    assert.equal(JSON.stringify([...f.db]), before, 'No plan/pending/domain mutation may survive the rejected identity drift');
  });
}

test('parallel approved requests retain per-call server staff rather than sharing a captured actor', async () => {
  const { createCurrentStockSave } = require('../prototypes/stock-current-state/current-stock-save.cjs');
  let calls = 0, release;
  const firstReady = new Promise(resolve => { release = resolve; }), prepared = [];
  const save = createCurrentStockSave({ company: 'NCT', writer: 'BORROWING',
    authenticate: async () => ({ memberId: 'M1', staffId: ++calls === 1 ? 'P1' : 'P2' }),
    protocol: { commit: async operation => {
      // Exercise the trusted prepare payload directly; real admission and commit
      // remain covered by the actual two gateway cases above and existing suite.
      operation.authorize({ control: { company: 'NCT', _version: 'CONTROL0', mode: 'ACTIVE', schemaVersion: 1,
        writerBuild: 'TEST', generation: 0, pending: null }, resumed: false });
      if (operation.requestId.startsWith('1111')) await firstReady;
      else release();
      await operation.prepare();
      return { ok: true, generation: 1 };
    } },
    coverage: Object.fromEntries(require('../prototypes/stock-current-state/stock-admission.cjs').WRITERS.map(w => [w, { verified: true, build: 'TEST' }])),
    prepare: async command => { prepared.push([command.requestId, command.memberId, command.staffId]); return { memberId: command.memberId, generation: 0, plan: {} }; }
  });
  const common = { stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 0, input: {} };
  await Promise.all([save({ ...common, requestId: '11111111-2222-4333-8444-555555555555' }),
    save({ ...common, requestId: '22222222-2222-4222-8222-222222222222' })]);
  assert.deepEqual(prepared.sort((a, b) => a[0].localeCompare(b[0])).map(row => row.slice(1)), [['M1', 'P1'], ['M1', 'P2']]);
});
