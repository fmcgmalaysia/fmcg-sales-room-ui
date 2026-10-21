const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { projectStockCard } = load('stockCardProjection.js');
const { convertProjectedStock } = require('../prototypes/stock-current-state/current-model.cjs');
const { planReceiptStockLine, composeReceiptStockPlan } = require('../prototypes/stock-current-state/receipt-stock-plan.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const task = (id, accepted, share, extra = {}) => ({ id, company: 'NCT', customerId: id, orderId: 'O-' + id, sourceLineId: 'L-' + id,
  barcode: '0001', name: 'TEST', packing: '12x1', ea: 12, ord: share, requested: share, po: 'PO-' + id,
  procurement: { totalCtn: 200, customerCtn: share }, warehouse: { hasPhysicalReceipt: true, accepted }, ...extra });
function fixture({ accepted = 80, share = 200, extra = false } = {}) {
  const source = task('B', accepted, share), tasks = [source, ...(extra ? [task('FOC', 20, 0, { specialPurchase: true })] : [])];
  const converted = convertProjectedStock({ snapshot: projectStockCard({ company: 'NCT', tasks, activity: [] }), tasks, generation: 0 });
  for (const row of [...converted.positions, ...converted.claims, ...converted.products]) row._version = 'V0';
  const args = { company: 'NCT', sourceTask: { ...source, poId: source.po },
    ownership: { kind: 'PURCHASE_CUSTOMER_SHARE', customerShare: share, owner: source },
    position: converted.positions.find(row => row.sourceTaskId === 'B'), claims: converted.claims.filter(row => row.taskId === 'B'),
    product: converted.products[0], generation: 0, holdsVerified: true, heldByTask: {},
    line: { taskId: 'B', orderId: 'O-B', sourceLineId: 'L-B', planned: 200,
      beforeAccepted: accepted, beforeRejected: 0, accepted: accepted + 20, rejected: 0, kind: 'PARTIAL', reason: 'next delivery' } };
  return args;
}
const after = (plan, collection) => plan.writes.find(row => row.collection === collection)?.after;

test('task-total packing does not block added stock but conservatively blocks claim reduction', () => {
  const args = fixture();
  const growing = planReceiptStockLine({ ...args, taskHoldTotals: { B: 150 } });
  assert.equal(after(growing, 'StockClaims').reservedUsable, 100);
  const correction = { ...args, line: { ...args.line, accepted: 70, kind: 'CORRECTION', reason: 'Count correction' } };
  assert.throws(() => planReceiptStockLine({ ...correction, taskHoldTotals: { B: 1 } }), /Packing task/);
  const unheld = planReceiptStockLine({ ...correction, taskHoldTotals: { B: 0 } });
  assert.equal(after(unheld, 'StockClaims').reservedUsable, 70);
});

test('partial receipt adds only20 to source/customer/product and leaves old free20 alone', () => {
  const args = fixture({ extra: true }), original = JSON.stringify(args), plan = planReceiptStockLine(args);
  assert.equal(JSON.stringify(args), original);
  assert.equal(plan.deltaAccepted, 20); assert.equal(plan.deltaReserved, 20);
  assert.equal(after(plan, 'StockPositions').onHand, 100); assert.equal(after(plan, 'StockPositions').receiptAccepted, 100);
  assert.equal(after(plan, 'StockClaims').reservedUsable, 100);
  assert.equal(after(plan, 'StockProducts').onHand, 120); assert.equal(after(plan, 'StockProducts').available, 20);
});
test('paid80+FOC20 caps client reservation at80; new physical excess stays free', () => {
  const args = fixture({ accepted: 80, share: 80 }), plan = planReceiptStockLine(args);
  assert.equal(plan.deltaReserved, 0); assert.equal(after(plan, 'StockClaims'), undefined);
  assert.equal(after(plan, 'StockProducts').onHand, 100); assert.equal(after(plan, 'StockProducts').available, 20);
});
test('first physical receipt creates only actual source/claim/product, not demand200', () => {
  const args = fixture({ accepted: 0 }), plan = planReceiptStockLine({ ...args, position: null, product: null, claims: [] });
  assert.equal(plan.writes.length, 3); assert.ok(plan.writes.every(row => row.before === null));
  assert.equal(after(plan, 'StockProducts').onHand, 20); assert.equal(after(plan, 'StockClaims').reservedUsable, 20);
});
test('rejected-only receipt generates no accepted stock or empty inventory rows', () => {
  const args = fixture({ accepted: 0 });
  const plan = planReceiptStockLine({ ...args, position: null, product: null, claims: [],
    line: { ...args.line, accepted: 0, rejected: 20, kind: 'DAMAGED' } });
  assert.deepEqual(plan.writes, []); assert.equal(plan.deltaAccepted, 0);
});
test('manual planner claims are not automatically expanded by later supplier deliveries', () => {
  const args = fixture({ accepted: 80, share: 80 });
  const plan = planReceiptStockLine({ ...args, ownership: { kind: 'PLANNER_ALLOCATION' } });
  assert.equal(plan.deltaReserved, 0); assert.equal(after(plan, 'StockClaims'), undefined);
  assert.equal(after(plan, 'StockPositions').available, 20);
});
test('correction uses lifetime receipt basis after dispatch rather than remaining onHand', () => {
  const args = fixture({ accepted: 120, share: 100 });
  args.position.onHand = 80; args.position.dispatched = 40; args.position.reservedUsable = 60;
  args.claims[0].reservedUsable = 60;
  args.product.onHand = 80; args.product.reservedUsable = 60;
  args.line = { ...args.line, accepted: 110, kind: 'CORRECTION', reason: 'count correction' };
  const plan = planReceiptStockLine(args);
  assert.equal(after(plan, 'StockPositions').onHand, 70); assert.equal(after(plan, 'StockPositions').receiptAccepted, 110);
  assert.equal(after(plan, 'StockPositions').dispatched, 40); assert.equal(after(plan, 'StockProducts').available, 10);
  assert.equal(after(plan, 'StockClaims'), undefined);
});
test('negative correction cannot release held customer goods or consume manual claims', () => {
  const args = fixture(); args.line = { ...args.line, accepted: 70, kind: 'CORRECTION', reason: 'count correction' };
  assert.throws(() => planReceiptStockLine({ ...args, heldByTask: { B: 80 } }), /below held/);
  assert.throws(() => planReceiptStockLine({ ...args, ownership: { kind: 'PLANNER_ALLOCATION' } }), /physical obligations/);
  const plan = planReceiptStockLine(args);
  assert.equal(after(plan, 'StockProducts').onHand, 70); assert.equal(after(plan, 'StockClaims').reservedUsable, 70);
});
test('new receipt reopens a fully dispatched current source without resurrecting shipped40', () => {
  const args = fixture({ accepted: 40, share: 100 });
  Object.assign(args.position, { onHand: 0, reservedUsable: 0, available: 0, dispatched: 40, status: 'CLOSED' });
  Object.assign(args.product, { onHand: 0, reservedUsable: 0, available: 0, status: 'CLOSED' });
  Object.assign(args.claims[0], { reservedUsable: 0, status: 'CLOSED' });
  const plan = planReceiptStockLine(args);
  assert.equal(after(plan, 'StockPositions').onHand, 20); assert.equal(after(plan, 'StockPositions').status, 'ACTIVE');
  assert.equal(after(plan, 'StockClaims').reservedUsable, 20); assert.equal(after(plan, 'StockProducts').onHand, 20);
});
test('unknown/scope/receipt-basis/claim-completeness/hold failures stop rather than guess free stock', () => {
  const args = fixture();
  assert.throws(() => planReceiptStockLine({ ...args, holdsVerified: false }), /context/);
  assert.throws(() => planReceiptStockLine({ ...args, position: { ...args.position, receiptAccepted: 79 } }), /basis/);
  assert.throws(() => planReceiptStockLine({ ...args, product: { ...args.product, available: null } }), /Known/);
  assert.throws(() => planReceiptStockLine({ ...args, claims: [] }), /incomplete/);
  assert.throws(() => planReceiptStockLine({ ...args, sourceTask: { ...args.sourceTask, company: 'GHR' } }), /context/);
  assert.throws(() => planReceiptStockLine({ ...args, line: { ...args.line, accepted: 70 } }), /correction/);
});

const eventFor = contexts => ({ _id: 'RECEIPT-EVENT', title: 'RECEIPT-EVENT', description: contexts[0].sourceTask.poId,
  action: 'WAREHOUSE_RECEIPT_SAVED', result: 'SAVED', activityTime: '2026-10-21T00:00:00Z',
  details: { company: 'NCT', beforeRevision: 'OLD', lines: contexts.map(context => context.line) } });
function twoSources() {
  const a = fixture(), source = task('C', 60, 200), tasks = [a.sourceTask, source];
  const data = convertProjectedStock({ snapshot: projectStockCard({ company: 'NCT', tasks, activity: [] }), tasks, generation: 0 });
  for (const row of [...data.positions, ...data.claims, ...data.products]) row._version = 'V0';
  const contexts = tasks.map((current, index) => ({ ...a, sourceTask: { ...current, poId: 'SHARED-PO' },
    ownership: { kind: 'PURCHASE_CUSTOMER_SHARE', customerShare: 200, owner: current },
    position: { ...data.positions.find(row => row.sourceTaskId === current.id), poId: 'SHARED-PO' },
    claims: data.claims.filter(row => row.taskId === current.id), product: data.products[0],
    line: { ...a.line, taskId: current.id, orderId: current.orderId, sourceLineId: current.sourceLineId,
      beforeAccepted: index ? 60 : 80, accepted: index ? 90 : 100 } }));
  return contexts;
}
test('same-product multi-source PO coalesces one summary without overwriting first line', () => {
  const contexts = twoSources(), event = eventFor(contexts), plan = composeReceiptStockPlan({ company: 'NCT', event, contexts, generation: 0 });
  assert.equal(plan.writes.length, 6); assert.equal(plan.writes.filter(row => row.collection === 'StockProducts').length, 1);
  assert.equal(after(plan, 'StockProducts').onHand, 190); assert.equal(after(plan, 'StockProducts').reservedUsable, 190);
  assert.equal(after(plan, 'StockProducts').available, 0); assert.deepEqual(event.details.lines, contexts.map(row => row.line));
});
test('new receipt summary matches protected legacy projection for the same current physical facts', () => {
  const contexts = twoSources(), plan = composeReceiptStockPlan({ company: 'NCT', event: eventFor(contexts), contexts, generation: 0 });
  const tasks = contexts.map(context => ({ ...context.sourceTask, po: 'SHARED-PO', warehouse: { hasPhysicalReceipt: true, accepted: context.line.accepted } }));
  const legacy = projectStockCard({ company: 'NCT', tasks, activity: [] }).items[0], summary = after(plan, 'StockProducts');
  for (const field of ['onHand', 'reservedUsable', 'available', 'isolated']) assert.equal(summary[field], legacy[field]);
});
test('two first-receipt sources share one newly created product summary, not two inventory products', () => {
  const contexts = twoSources().map(context => ({ ...context, position: null, product: null, claims: [],
    line: { ...context.line, beforeAccepted: 0 } }));
  const plan = composeReceiptStockPlan({ company: 'NCT', event: eventFor(contexts), contexts, generation: 0 });
  const products = plan.writes.filter(write => write.collection === 'StockProducts');
  assert.equal(products.length, 1); assert.equal(products[0].before, null); assert.equal(products[0].after.onHand, 190);
});
test('oversize receipt rejects the entire plan before any store write', () => {
  const contexts = Array.from({ length: 15 }, (_, i) => {
    const source = task('T' + i, 0, 200);
    return { company: 'NCT', sourceTask: { ...source, poId: 'SHARED-PO' }, ownership: { kind: 'PURCHASE_CUSTOMER_SHARE', customerShare: 200, owner: source },
      position: null, product: null, claims: [], generation: 0, holdsVerified: true,
      line: { taskId: source.id, orderId: source.orderId, sourceLineId: source.sourceLineId, planned: 200,
        beforeAccepted: 0, accepted: 1, beforeRejected: 0, rejected: 0, kind: 'PARTIAL', reason: 'first delivery' } };
  });
  assert.throws(() => composeReceiptStockPlan({ company: 'NCT', event: eventFor(contexts), contexts, generation: 0 }), /commit proof limit/);
});
test('different summary versions cannot be combined into a superficially correct total', () => {
  const contexts = twoSources(); contexts[1].product = { ...contexts[1].product, _version: 'CHANGED' };
  assert.throws(() => composeReceiptStockPlan({ company: 'NCT', event: eventFor(contexts), contexts, generation: 0 }), /snapshot conflict/);
});
test('rejected-only PO still saves its receipt event but creates no physical stock balances', () => {
  const a = fixture({ accepted: 0 });
  Object.assign(a, { position: null, product: null, claims: [], line: { ...a.line, accepted: 0, rejected: 20, kind: 'DAMAGED' } });
  const plan = composeReceiptStockPlan({ company: 'NCT', event: eventFor([a]), contexts: [a], generation: 0 });
  assert.equal(plan.writes.length, 1); assert.equal(plan.writes[0].after.action, 'WAREHOUSE_RECEIPT_SAVED');
});
test('receipt plus balances resume the same prepared plan after source write interruption', async () => {
  const contexts = twoSources(), rows = new Map(), copy = row => JSON.parse(JSON.stringify(row)); let fail = true, preparations = 0;
  const key = (c, id) => c + '/' + id;
  const store = {
    read: async (c, id) => copy(rows.get(key(c, id)) || null),
    insert: async (c, row) => { if (rows.has(key(c, row._id))) throw Error('Duplicate'); rows.set(key(c, row._id), copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => {
      if (c === 'StockClaims' && fail) { fail = false; throw Error('Injected receipt interruption'); }
      if (rows.get(key(c, id))?._version !== version) throw Error('Version conflict');
      rows.set(key(c, id), copy(row)); return copy(row);
    },
    compareAndRemove: async (c, id, attempt) => {
      if (rows.get(key(c, id))?.attempt !== attempt) throw Error('Attempt conflict'); rows.delete(key(c, id));
    }
  };
  for (const context of contexts) for (const [c, row] of [['StockPositions', context.position], ['StockProducts', context.product], ...context.claims.map(row => ['StockClaims', row])]) {
    rows.set(key(c, row._id), copy(row));
  }
  const protocol = createFencedProof({ store }); await protocol.initialize();
  const request = { requestId: '11111111-1111-4111-8111-111111111111', memberId: 'STAFF', input: { receipt: 'TEST' },
    prepare: async () => { preparations++; return composeReceiptStockPlan({ company: 'NCT', event: eventFor(contexts), contexts, generation: 0 }); } };
  await assert.rejects(protocol.commit(request), /Injected receipt interruption/);
  await assert.rejects(protocol.readSnapshot(() => store.read('StockProducts', contexts[0].product._id)), /pending/);
  await protocol.commit(request); await protocol.commit(request);
  assert.equal(preparations, 1); assert.equal((await protocol.readControl()).generation, 1);
  assert.equal((await store.read('StockProducts', contexts[0].product._id)).onHand, 190);
  assert.equal((await store.read('StockPositions', contexts[0].position._id)).receiptAccepted, 100);
  assert.equal([...rows.values()].filter(row => row.action === 'WAREHOUSE_RECEIPT_SAVED').length, 1);
});
