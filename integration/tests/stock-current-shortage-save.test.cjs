const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module'), load = require('./load-master-module.cjs');
const { createCurrentShortageSave } = require('../prototypes/stock-current-state/current-department-saves.cjs');
const { createShortageOperations, shortageVersion } = load('purchaseShortage.js');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const filename = require.resolve('./stock-current-quantity-case.test.cjs');
const currentFixture = vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace("const test = require('node:test')", 'const test = () => {}') + '\ncurrentFixture;',
  { require: createRequire(filename), Map, Buffer });
async function fixture(borrowed = false) {
  const f = await currentFixture(borrowed), taskId = borrowed ? 'A' : 'T', allocated = borrowed ? 20 : 90;
  f.deps.createShortageOperations = createShortageOperations;
  const { company, items, store, protocol } = f.deps;
  const save = createCurrentShortageSave({ company, items, store, protocol, authorityDependencies: f.deps,
    coverage: Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'TEST' }])) });
  const task = f.context.tasks.find(t => t.id === taskId);
  const request = { ...f.request('RECEIPT'), input: { taskId, version: shortageVersion({ ...task, inc: allocated }, f.context.activity),
    customerDecision: 'STOP', supplierDecision: 'CREDIT', reason: 'Supplier shortage decision', customerMessage: 'Await separate customer arrangement' } };
  return { ...f, save, request, allocated, task };
}

test('concrete shortage save reads v2 cumulative ownership, resumes once and retains original receipt and borrowing debt', async () => {
  for (const borrowed of [false, true]) {
    const f = await fixture(borrowed), before = JSON.stringify([...f.db].filter(([id, row]) => /^(StockPositions|StockClaims):/.test(id) || row.action === 'STOCK_TRANSFER_CURRENT'));
    let result = await f.save(f.request), attempts = 1; assert.equal(result.pending, true);
    while (result.pending && attempts++ < 15) result = await f.save(f.request);
    assert.equal(result.ok, true); assert.equal(result.taskId, f.task.id); assert.equal(result.stockGeneration, 1);
    assert.equal((await f.save(f.request)).savedAt, result.savedAt); assert.equal(f.counts().contextReads, 1);
    const events = [...f.db.values()].filter(row => row.action === 'PURCHASE_SHORTAGE_DECIDED'); assert.equal(events.length, 1);
    assert.equal(events[0].details.allocatedCtn, f.allocated); assert.equal(events[0].details.shortCtn, f.task.ord - f.allocated);
    assert.equal(events[0].initiatedByStaffId, 'P');
    assert.equal(JSON.stringify([...f.db].filter(([id, row]) => /^(StockPositions|StockClaims):/.test(id) || row.action === 'STOCK_TRANSFER_CURRENT')), before);
    assert.equal(f.context.tasks.find(t => t.id === f.task.id).requested, f.task.requested);
  }
});

test('shortage current save retains original stale/date/message guards and rejects revoked replay', async () => {
  for (const patch of [{ version: 'OLD' }, { supplierDecision: 'REPLENISH', expectedDate: '2026-02-30' }, { customerMessage: '' }, { taskId: 'OTHER' }]) {
    const f = await fixture(); await assert.rejects(f.save({ ...f.request, input: { ...f.request.input, ...patch } }));
    assert.equal([...f.db.values()].some(row => row.action === 'PURCHASE_SHORTAGE_DECIDED'), false);
  }
  const f = await fixture(); let result;
  do { result = await f.save(f.request); } while (result.pending);
  (await f.deps.readMember()).status = 'PENDING'; await assert.rejects(f.save(f.request));
  assert.equal([...f.db.values()].filter(row => row.action === 'PURCHASE_SHORTAGE_DECIDED').length, 1);
});
