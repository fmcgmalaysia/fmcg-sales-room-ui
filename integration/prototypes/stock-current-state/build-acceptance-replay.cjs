'use strict';

// Read-only evidence export. Execute the existing composition test with its REAL
// assertions and candidate roots, adding only snapshot observers in memory.
// No source-test rewrite, alternate business arithmetic, Wix or network adapter.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { transferPerson } = require('./transfer-person.cjs');
const load = require('../../tests/load-master-module.cjs');
const { readShipmentPlans } = load('customerShipmentPlan.js');
const { taskCoverage } = require('./borrowing-model.cjs');
const { readCurrentSalesWorkspace } = require('./sales-current-workspace.cjs');
const filename = path.resolve(__dirname, '../../tests/stock-current-receipt-packing-composition.test.cjs');
const source = fs.readFileSync(filename, 'utf8');
const target = 'one database: same/different PO borrow → both customer shipment splits → borrower Loaded → automatic repayment closes both halos';
const marker = "test('" + target + "',async()=>{";
assert.equal(source.split(marker).length, 2, 'one exact existing scenario');
const index = source.indexOf(marker);
let tail = source.slice(index);
function observe(anchor, label, before = false) {
  assert.equal(tail.split(anchor).length, 2, 'exact snapshot boundary: ' + label);
  const call = "\n  await __capture(f,company,separatePo,'" + label + "');\n";
  tail = tail.replace(anchor, before ? call + anchor : anchor + call);
}
observe("  f.select('WAREHOUSE');assert.equal((await f.api.saveWarehouseReceiptCurrent(company,f.initial)).ok,true);", 'po', true);
observe("  let support=await f.read('SUPPORT');assert.equal(support.tasks.find(task=>task.taskId==='A').ready,0);assert.equal(support.tasks.find(task=>task.taskId==='B').ready,100);", 'received-b');
observe("  for(const taskId of ['A','B']){const view=await f.relations(company,{taskId});assert.equal(view.halo,true);assert.equal(view.items[0].remaining,30);}", 'borrowed');
observe("  support=await f.read('SUPPORT');assert.equal(support.tasks.find(task=>task.taskId==='A').ready,30);assert.equal(support.tasks.find(task=>task.taskId==='B').ready,70);", 'split');
observe("  f.select('PURCHASE');assert.equal((await f.relations(company,{taskId:'A'})).items[0].remaining,30,'Loaded cannot discharge repayment');", 'loaded');
observe("   assert.deepEqual(copy(await f.api.saveWarehouseReceiptCurrent(company,receipt)),copy(saved),'same receipt cannot repay twice');", 'receipt');
const cases = new Map(), registered = [];
const copy = value => JSON.parse(JSON.stringify(value));
async function capture(f, company, separatePo, phase) {
  const before = JSON.stringify([...f.db]);
  const key = company + (separatePo ? '-different-po' : '-same-po');
  if (!cases.has(key)) cases.set(key, { id: key, company, separatePo, steps: [] });
  const rows = [...f.db.values()];
  const positions = [...f.db].filter(([key]) => key.startsWith('StockPositions/')).map(([,row]) => row);
  const claims = [...f.db].filter(([key]) => key.startsWith('StockClaims/')).map(([,row]) => row);
  const relations = rows.filter(row => row.action === 'STOCK_TRANSFER_CURRENT').map(row => row.details.relation);
  const lists = rows.filter(row => row.action === 'SUPPORT_PACKING_LIST_CURRENT').map(row => row.details.list);
  const plans = readShipmentPlans(rows);
  const generation = (await f.protocol.readControl()).generation;
  const tasks = [];
  for (const task of f.context.tasks) {
    const plan = plans.find(plan => plan.customerId === task.customerId && plan.orderId === task.orderId);
    const owned = claims.filter(claim => claim.taskId === task.id).reduce((sum, claim) => sum + claim.reservedUsable, 0);
    const held = lists.reduce((sum, list) => sum + f.bindings.packingHeld(list, task.id), 0);
    const loaded = lists.reduce((sum, list) => sum + (list.lines.find(line => line.taskId === task.id)?.loaded || 0), 0);
    // Build the display projection from the same actual row images. Use the
    // existing coverage/person functions; nothing here prepares a business save.
    const staff = { customerId: task.customerId };
    const currentContext = await f.bindings.readFulfilmentContext(company, staff);
    const workspace = await f.protocol.readSnapshot(control => readCurrentSalesWorkspace({ company, control,
      context: currentContext, staff, items: f.items, store: f.store,
      readCurrentTaskRows: async (company, ids) => f.store.readMany(f.tasks, ids), readPurchaseRecords: async () => [],
      projectPurchaseOrders: f.bindings.projectPurchaseOrders, readAllocations: f.bindings.readAllocations,
      readCustomerShipments: f.bindings.readCustomerShipments, readPackingLists: f.bindings.readPackingLists, packingHeld: f.bindings.packingHeld }));
    const product = [...workspace.rows.products.values()].find(product => product.state.tasks.some(t => t.id === task.id));
    const coverage = taskCoverage(product.state, task.id);
    assert.equal(coverage.reservedUsable, owned);
    const person = transferPerson({ taskId: task.id, relations });
    tasks.push({ id: task.id, po: task.po, requested: coverage.requested, owned,
      accepted: positions.filter(position => position.sourceTaskId === task.id).reduce((sum, row) => sum + row.receiptAccepted, 0),
      batches: plan ? plan.batches.map(batch => batch.lines.find(line => line.taskId === task.id)?.quantity).filter(n => n !== undefined) : [100],
      held, loaded, readyToArrange: Math.max(0, Math.min(100, owned) - held),
      pending: Boolean(coverage.uncovered || coverage.pendingReplacement), halo: person.halo, svg: person.svg });
  }
  const outstanding = relations.reduce((sum, relation) => sum + relation.quantity - relation.repaid - (relation.returned || 0), 0);
  const step = { phase: phase === 'receipt' ? (tasks[0].accepted === 20 ? 'received-20' : 'received-100') : phase,
    generation, tasks, onHand: positions.reduce((sum, row) => sum + row.onHand, 0),
    available: positions.reduce((sum, row) => sum + row.available, 0),
    dispatched: positions.reduce((sum, row) => sum + row.dispatched, 0), outstanding,
    relations: relations.map(r => ({ quantity: r.quantity, repaid: r.repaid, returned: r.returned || 0, remaining: r.quantity-r.repaid-(r.returned||0) })),
    counts: { receipts: rows.filter(row => row.action === 'WAREHOUSE_RECEIPT_SAVED').length,
      splits: rows.filter(row => row.action === 'SALES_ORDER_ADJUSTMENT_SAVED').length,
      transfers: relations.length, lists: lists.length } };
  cases.get(key).steps.push(copy(step));
  assert.equal(JSON.stringify([...f.db]), before, 'snapshot observation cannot mutate the fixture database');
}
async function build(output = path.join(__dirname, 'preview/acceptance-replay.html')) {
  cases.clear(); registered.length = 0;
  const relativeRequire = createRequire(filename);
  function requireForReplay(name) {
    if (name === 'node:test') return (name, fn) => { if (name === target) registered.push(fn); };
    return relativeRequire(name);
  }
  requireForReplay.resolve = relativeRequire.resolve;
  vm.runInNewContext(source.slice(0, index) + tail, { require: requireForReplay,
    __dirname: path.dirname(filename), Map, __capture: capture }, { filename });
  assert.equal(registered.length, 1);
  await registered[0](); // An assertion failure prevents ANY replay export.
  assert.equal(cases.size, 4);
  for (const scenario of cases.values()) {
    assert.deepEqual(scenario.steps.map(s => s.phase), ['po','received-b','borrowed','split','loaded','received-20','received-100']);
    assert.deepEqual(scenario.steps.map(s => s.outstanding), [0,0,30,30,30,10,0]);
    assert.deepEqual(scenario.steps.map(s => s.onHand), [0,100,100,100,100,120,200]);
    assert.equal(scenario.steps.every(s => s.dispatched === 0), true);
    assert.equal(scenario.steps.at(-1).tasks[0].readyToArrange, 70);
  }
  const packet = { schema: 'OFFLINE_COMPOSITION_REPLAY_V1', sourceTest: path.basename(filename),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    nativeWixVerified: false, cmsConnected: false, readOnlyReplay: true, assertionsPassed: true, cases: [...cases.values()] };
  const template = fs.readFileSync(path.join(__dirname, 'preview/acceptance-replay.template.html'), 'utf8');
  assert.equal(template.split('/*__REPLAY_DATA__*/null').length, 2);
  const html = template.replace('/*__REPLAY_DATA__*/null', JSON.stringify(packet).replace(/</g, '\\u003c'));
  assert.ok(Buffer.byteLength(html) < 1024 * 1024);
  fs.writeFileSync(path.join(__dirname, 'preview/acceptance-replay.data.json'), JSON.stringify(packet, null, 2) + '\n');
  fs.writeFileSync(output, html);
  return { output, cases: cases.size, snapshots: [...cases.values()].reduce((n,c) => n+c.steps.length,0), sourceSha256: packet.sourceSha256 };
}
if (require.main === module) build(process.argv[2]).then(result => process.stdout.write(JSON.stringify(result)+'\n')).catch(error => { process.stderr.write(error.stack+'\n'); process.exitCode=1; });
module.exports = { build };
