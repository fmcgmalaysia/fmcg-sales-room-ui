const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module'), load = require('./load-master-module.cjs');
const { createCurrentStockResolutionSave } = require('../prototypes/stock-current-state/current-stock-resolution-save.cjs');
const { createStockResolutionOperations, stockResolutionVersion } = load('stockExceptionResolution.js');
const { readStockExceptions } = load('inventoryExceptions.js');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const filename = require.resolve('./stock-current-exception-save.test.cjs');
const baseFixture = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + '\nfixture;',
  { require: createRequire(filename), Map, Buffer });
async function finish(save, request) {
  let result, attempts = 0; do { result = await save(request); assert.ok(attempts++ < 25); } while (result.pending); return result;
}
async function fixture(kind = 'SHORT_EXPIRY') {
  const f = await baseFixture('NCT', false, kind), reported = await finish(f.save, f.request);
  Object.assign(f.deps, { createStockResolutionOperations, readStockExceptions });
  const { company, items, store, protocol } = f;
  const save = createCurrentStockResolutionSave({ company, items, store, protocol, authorityDependencies: f.deps,
    coverage: Object.fromEntries(WRITERS.map(w => [w, { verified: true, build: 'TEST' }])) });
  let serial = 1;
  function role(department, id = department) { f.employee.departments = department === 'ADMIN' ? [] : [department]; f.employee.role = department === 'ADMIN' ? 'SUPER ADMIN' : '';
    f.employee.title = id; f.employee.staffName = id; }
  async function request(input) {
    const context = f.context(), orders = f.deps.projectPurchaseOrders({ company, workspace: context, records: [] });
    return { requestId: String(++serial).padStart(8, '0') + '-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'TEST',
      stockGeneration: (await protocol.readControl()).generation, input: { id: reported.caseId, version: stockResolutionVersion(context, orders), reason: 'Verified original case action', ...input } };
  }
  const balances = () => { const row = [...f.db.values()].find(r => r.lifecycleVersion === 2); return [row.onHand, row.available, row.isolated]; };
  return { ...f, saveResolution: save, reported, requestResolution: request, role, balances, act: async input => {
    const req = await request(input), result = await finish(save, req); assert.equal((await save(req)).caseId, reported.caseId); return result;
  } };
}

test('original Purchase decision and Warehouse replacement/return affect current physical stock once, no receipt rewrite', async () => {
  const f = await fixture(); assert.deepEqual(f.balances(), [20, 10, 10]);
  f.role('PURCHASE'); await f.act({ action: 'DECIDE', decision: 'REPLACE', disposition: 'RETURN', supplierReference: 'SUP-1', expectedDate: '2026-11-01' });
  assert.deepEqual(f.balances(), [20, 10, 10]);
  f.role('WAREHOUSE'); await f.act({ action: 'REPLACEMENT', quantity: 5, reference: 'RPL-1', acceptedGood: true });
  assert.deepEqual(f.balances(), [25, 15, 10]);
  await f.act({ action: 'RETURN', quantity: 5, reference: 'RTN-1' }); assert.deepEqual(f.balances(), [20, 15, 5]);
  await f.act({ action: 'REPLACEMENT', quantity: 5, reference: 'RPL-2', acceptedGood: true });
  await f.act({ action: 'RETURN', quantity: 5, reference: 'RTN-2' }); assert.deepEqual(f.balances(), [20, 20, 0]);
  f.role('ACCOUNT'); await f.act({ action: 'CLOSE', outcome: 'REPLACED', noExtraCharge: true }); assert.deepEqual(f.balances(), [20, 20, 0]);
  const source = [...f.db.values()].find(r => r.sourceTaskId === 'T'); assert.equal(source.receiptAccepted, 20);
  assert.equal(source.replacementReceived, 10); assert.equal(source.supplierReturned, 10);
  assert.equal(f.context().activity.filter(r => r.action === 'STOCK_EXCEPTION_RESOLUTION_SAVED').length, 6);
  assert.equal(readStockExceptions(f.context().activity)[0].status, 'RESOLVED');
});

test('free isolated stock releases only after original separate Admin approval and Finance verification', async () => {
  const f = await fixture(); f.role('ADMIN', 'A'); await f.act({ action: 'APPROVE_RELEASE' }); assert.deepEqual(f.balances(), [20, 10, 10]);
  f.role('ACCOUNT', 'A'); await assert.rejects(f.saveResolution(await f.requestResolution({ action: 'CLOSE', outcome: 'RELEASED' })), /different Finance/);
  f.role('ACCOUNT', 'F'); await f.act({ action: 'CLOSE', outcome: 'RELEASED' }); assert.deepEqual(f.balances(), [20, 20, 0]);
  assert.equal(f.context().activity.filter(r => r.action === 'STOCK_EXCEPTION_RESOLUTION_SAVED').length, 2);
});

test('original role, agreed movements, exact attributed case and stale form remain mandatory', async () => {
  const f = await fixture(); f.role('WAREHOUSE'); await assert.rejects(f.saveResolution(await f.requestResolution({ action: 'DECIDE' })), /permission/);
  await assert.rejects(f.saveResolution(await f.requestResolution({ action: 'RETURN', quantity: 1, reference: 'R' })), /Purchase must/);
  f.role('PURCHASE'); await assert.rejects(f.saveResolution(await f.requestResolution({ action: 'DECIDE', version: 'OLD' })), /changed/);
  const event = f.db.get('NCTActivity:' + f.reported.caseId); delete event.stockAttribution;
  await assert.rejects(f.saveResolution(await f.requestResolution({ action: 'DECIDE' })), /free stock case/);
  assert.deepEqual(f.balances(), [20, 10, 10]);
});

test('financial loss closure without physical disposal evidence cannot silently remove isolated goods', async () => {
  const f = await fixture('INTERNAL_DAMAGE'); f.role('ADMIN', 'A'); await f.act({ action: 'APPROVE_LOSS', cents: 12000 });
  f.role('ACCOUNT', 'F'); await assert.rejects(f.saveResolution(await f.requestResolution({ action: 'CLOSE', outcome: 'LOSS', cents: 12000 })), /settled goods location/);
  assert.deepEqual(f.balances(), [20, 10, 10]);
  const g = await fixture();
  // Supplier expiry still follows the original supplier route, not an invented loss.
  g.role('ADMIN'); await assert.rejects(g.saveResolution(await g.requestResolution({ action: 'APPROVE_LOSS', cents: 12000 })), /Supplier-related/);
  assert.deepEqual(g.balances(), [20, 10, 10]);
});
