const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { haloSvg } = require('../prototypes/stock-current-state/transfer-person.cjs');
const { createPurchaseTransferWorkspace } = require('../prototypes/stock-current-state/purchase-transfer-workspace.cjs');
const root = path.join(__dirname, '../prototypes/stock-current-state');
test('both Purchase overlays preserve original heads; relation actions are mounted by ALLOC instead of procurement editing', () => {
  assert.match(execFileSync(process.execPath, [path.join(root, 'build-transfer-person-overlays.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  for (const file of ['task-grid.js', 'supplier-allocation.js']) {
    const source = fs.readFileSync(path.join(root, 'purchase-ui', file), 'utf8'); new vm.Script(source);
    assert.ok(source.includes('stockTransferOutstanding===true')); assert.equal(source.includes('data-transfer-triangle'), false);
    // No event handler/action/permission or existing colour selector replacements.
    const original = fs.readFileSync(path.join(__dirname, '../../purchase-live', file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal((source.match(/data-self-collect/g) || []).length, (original.match(/data-self-collect/g) || []).length);
    assert.equal(source.includes('purchaseBorrowRelations?.mount'), false);
  }
  const ordinary = '<svg viewBox="0 0 20 20"><circle cx="10" cy="5" r="4"/><path d="M2 19v-3a8 7 0 0 1 16 0v3z"/></svg>';
  assert.equal(haloSvg(ordinary, false), ordinary);
  const halo = haloSvg(ordinary, true); assert.ok(halo.includes('<ellipse')); assert.ok(halo.includes(ordinary.slice(ordinary.indexOf('<circle'))));
  assert.equal(halo.includes('viewBox="0 -'), false); assert.equal(halo.includes('#'), false);
});
test('actual generated task grid renders ordinary heads byte-identically and adds/removes halos for both real source heads', () => {
  const filename = path.join(__dirname, 'purchase-source-grid.test.cjs');
  const source = fs.readFileSync(filename, 'utf8').replace("const test=require('node:test')", 'const test=()=>{}');
  const fixture = target => vm.runInNewContext(source.replace('../../purchase-live/task-grid.js', target) + '\nfixture;',
    { require: createRequire(filename), __dirname, Map, Set });
  const current = fixture('../prototypes/stock-current-state/purchase-ui/task-grid.js')(), original = fixture('../../purchase-live/task-grid.js')();
  const ordinary = original.render(); assert.equal(current.render(), ordinary);
  current.root.stockTransferOutstanding = true; current.child.stockTransferOutstanding = true;
  const decorated = current.render(); assert.ok((decorated.match(/<ellipse/g) || []).length >= 2); assert.equal(decorated.includes('triangle'), false);
  assert.equal((decorated.match(/supplier-head complete/g) || []).length, (ordinary.match(/supplier-head complete/g) || []).length);
  current.root.stockTransferOutstanding = false; current.child.stockTransferOutstanding = false; assert.equal(current.render(), ordinary);
});
function fixture() {
  const control = { company: 'NCT', mode: 'ACTIVE', generation: 5, transferIndexVersion: 2, pending: null, writerBuild: 'TEST' };
  const workspace = { company: 'NCT', tasks: [{ id: 'SA', customerDemandTaskId: 'A', po: 'PO-A' }, { id: 'SB', po: 'PO-B' }, { id: 'OTHER' }] };
  let authorized = true, reads = 0;
  const relations = [{ id: 'R', borrowerTaskId: 'A', lenderTaskId: 'B', lenderSourceId: 'SB', replacementSourceId: 'SA', quantity: 30, repaid: 0, returned: 0 }];
  const deps = { company: 'NCT', protocol: { readSnapshot: async fn => ({ generation: control.generation, rows: await fn(control) }) },
    authenticate: async () => authorized ? { memberId: 'M', staffId: 'P' } : null,
    readWorkspace: async () => { reads++; return workspace; }, readOutstanding: async () => ({ schema: 'CURRENT_BORROW_RELATIONS_V1', company: 'NCT', view: 'OUTSTANDING',
      generation: control.generation, offset: 0, total: relations.length, items: relations, version: 'a'.repeat(32), nextCursor: null }) };
  return { deps, control, workspace, relations, read: () => createPurchaseTransferWorkspace(deps)('NCT'), reads: () => reads, revoke: () => { authorized = false; } };
}
test('full outstanding index paints both actual source heads; completion removes halos without colour/PO changes', async () => {
  const f = fixture(), first = await f.read();
  assert.deepEqual(first.tasks.map(t => t.stockTransferOutstanding), [true, true, false]);
  assert.equal(first.tasks[0].stockTransferTaskId, 'A'); assert.equal(first.tasks[0].po, 'PO-A');
  assert.equal(first.stockCurrent.stockGeneration, 5); assert.equal(first.stockCurrent.stockBuild, 'TEST');
  f.relations.length = 0; const cleared = await f.read(); assert.ok(cleared.tasks.every(t => t.stockTransferOutstanding === false));
  assert.equal(Object.hasOwn(f.workspace.tasks[0], 'stockTransferOutstanding'), false);
});
test('legacy exact workspace preserved; no role, missing index or partial relation page never becomes false ordinary head', async () => {
  const f = fixture(); f.control.mode = 'LEGACY'; assert.deepEqual(await f.read(), f.workspace);
  f.control.mode = 'ACTIVE'; f.control.transferIndexVersion = null; await assert.rejects(f.read(), /not verified/);
  f.control.transferIndexVersion = 2; f.deps.readOutstanding = async () => ({ schema: 'CURRENT_BORROW_RELATIONS_V1', company: 'NCT', view: 'OUTSTANDING',
    generation: 5, offset: 0, total: 2, items: [], version: 'a'.repeat(32), nextCursor: null });
  await assert.rejects(f.read(), /Complete current/);
  const g = fixture(); g.revoke(); await assert.rejects(g.read(), /authorization/); assert.equal(g.reads(), 0);
});
