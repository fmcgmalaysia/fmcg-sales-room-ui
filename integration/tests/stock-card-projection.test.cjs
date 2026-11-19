const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { projectStockCard } = load('stockCardProjection.js');
const at = '2026-10-20T00:00:00Z';
const task = (id, extra = {}) => ({ id, customerId: 'C', barcode: '0001', name: 'TEST', packing: '12x1', ea: 12,
  ord: 100, po: 'PO-1', procurement: { totalCtn: 120 }, ...extra });
const received = n => ({ hasPhysicalReceipt: true, accepted: n });
const allocation = (targets, source = 'A') => ({ title: 'ALLOC-' + source, action: 'PLANNER_ALLOCATION_SAVED', result: 'SAVED',
  imageAltText: source, activityTime: at, details: { beforeRevision: '', targets } });
const context = (tasks, activity = [], company = 'NCT') => ({ company, tasks, activity });

test('late original receipt is free when explicit matching sources already cover customer demand', () => {
  const a=task('A',{procurement:{totalCtn:250,customerCtn:250},ord:250,warehouse:received(250)});
  const b=task('B',{customerId:'CB',warehouse:received(100),procurement:{totalCtn:100,customerCtn:100}});
  const activity=[allocation([{taskId:'A',quantity:170}]),allocation([{taskId:'A',quantity:80},{taskId:'B',quantity:20}],'B')];
  const row=projectStockCard(context([a,b],activity)).items[0];
  assert.equal(row.onHand,350);assert.equal(row.reservedUsable,270);assert.equal(row.available,80);assert.equal(row.reviewRequired,false);
});

test('unreceived or mismatched external sources cannot release original entitlement', () => {
  for(const extra of [{warehouse:received(0),barcode:'OTHER'},{warehouse:{hasPhysicalReceipt:false,accepted:0}}]){
    const a=task('A',{procurement:{totalCtn:250,customerCtn:250},ord:250,warehouse:received(250)});
    const b=task('B',{warehouse:received(100),...extra});
    const row=projectStockCard(context([a,b],[allocation([{taskId:'A',quantity:170}]),allocation([{taskId:'A',quantity:80}],'B')])).items.find(x=>x.barcode==='0001');
    assert.equal(row.sources.find(x=>x.sourceTaskId==='A').available,null);
  }
});

test('partial outside coverage still preserves unexplained customer entitlement review',()=>{
  const a=task('A',{procurement:{totalCtn:250,customerCtn:250},ord:250,warehouse:received(250)}),b=task('B',{warehouse:received(100)});
  const row=projectStockCard(context([a,b],[allocation([{taskId:'A',quantity:170}]),allocation([{taskId:'A',quantity:50}],'B')])).items[0];
  assert.equal(row.sources.find(x=>x.sourceTaskId==='A').available,null);
});
function shipmentChain(status, amount = 40) {
  const lines = [{ taskId: 'A', quantity: amount, sources: [{ sourceTaskId: 'A', quantity: amount }] }];
  return ['REQUESTED', 'INVOICED', 'DISPATCHED'].slice(0, ['REQUESTED', 'INVOICED', 'DISPATCHED'].indexOf(status) + 1).map((state, i) => ({
    title: 'SHIP-' + i, description: 'SHIP', action: 'CUSTOMER_SHIPMENT_CHANGED', result: 'SAVED', activityTime: at,
    details: { beforeRevision: i ? 'SHIP-' + (i - 1) : '', shipment: { id: 'SHIP', company: 'NCT', customerId: 'C', currency: 'MYR',
      status: state, lines, ...(i ? { invoice: { number: 'SI', amountCents: 100, currency: 'MYR', rateToMyr: 1 } } : {}) } }
  }));
}
test('120 received, 100 explicitly customer-owned: 20 free; reads never mutate their inputs', () => {
  const c = context([task('A', { warehouse: received(120) })], [allocation([{ taskId: 'A', quantity: 100 }])]);
  const before = JSON.stringify(c), row = projectStockCard(c).items[0];
  assert.equal(row.usableOnHand, 120); assert.equal(row.reserved, 100); assert.equal(row.available, 20);
  assert.equal(JSON.stringify(c), before); assert.equal(projectStockCard(c).items[0].available, 20);
});
test('absent ownership is held for review, never advertised as 120 free cartons', () => {
  const row = projectStockCard(context([task('A', { warehouse: received(120) })])).items[0];
  assert.equal(row.available, null); assert.equal(row.unassigned, 120); assert.equal(row.reviewRequired, true);
});
test('empty planner targets do not silently release an existing customer-source entitlement', () => {
  const row = projectStockCard(context([task('A', { warehouse: received(120) })], [allocation([])])).items[0];
  assert.equal(row.available, null); assert.equal(row.reviewRequired, true);
  const released = projectStockCard(context([task('A', { warehouse: received(120), ord: 0, requested: 0 })], [allocation([])])).items[0];
  assert.equal(released.available, 120);
});
test('invoicing and Support selection do not deduct physical stock or reserve twice', () => {
  for (const status of ['REQUESTED', 'INVOICED']) {
    const row = projectStockCard(context([task('A', { warehouse: received(120) })],
      [allocation([{ taskId: 'A', quantity: 100 }]), ...shipmentChain(status)])).items[0];
    assert.equal(row.usableOnHand, 120); assert.equal(row.reserved, 100); assert.equal(row.available, 20);
  }
});
test('dispatch reduces physical stock and outstanding reservation once, preserving the free balance', () => {
  const row = projectStockCard(context([task('A', { warehouse: received(120), archived: true })],
    [allocation([{ taskId: 'A', quantity: 100 }]), ...shipmentChain('DISPATCHED')])).items[0];
  assert.equal(row.usableOnHand, 80); assert.equal(row.reserved, 60); assert.equal(row.available, 20);
});
test('40 reserved then 5 quarantined: 35 usable, shortfall 5; does not silently reduce customer claim', () => {
  const issue = { title: 'ISSUE', imageAltText: 'A', action: 'STOCK_EXCEPTION_REPORTED', result: 'SAVED', initiatedByStaffId: 'W',
    activityTime: at, details: { company: 'NCT', quantity: 5, kind: 'INTERNAL_DAMAGE', reason: 'Counted damage' } };
  const row = projectStockCard(context([task('A', { warehouse: received(40) })],
    [allocation([{ taskId: 'A', quantity: 40 }]), issue])).items[0];
  assert.equal(row.usableOnHand, 35); assert.equal(row.reserved, 40); assert.equal(row.shortage, 5); assert.equal(row.available, 0);
  assert.equal(row.reservedUsable, 35); assert.equal(row.reviewRequired, true);
  assert.equal(row.onHand, 40); assert.equal(row.isolated, 5);
});

test('old FOC stock 20 and B receipt 200: 220 present, B owns 200, only 20 free', () => {
  const foc = task('FOC', { specialPurchase: true, ord: 0, requested: 0,
    procurement: { totalCtn: 20, customerCtn: 0 }, warehouse: received(20), archived: true });
  const b = task('B', { ord: 200, requested: 200,
    procurement: { totalCtn: 200, customerCtn: 200 }, warehouse: received(200) });
  const row = projectStockCard(context([foc, b])).items[0];
  assert.equal(row.onHand, 220); assert.equal(row.reservedUsable, 200);
  assert.equal(row.available, 20); assert.equal(row.isolated, 0);
  assert.equal(row.sources.find(source => source.sourceTaskId === 'FOC').available, 20);
  assert.equal(row.sources.find(source => source.sourceTaskId === 'B').available, 0);
});

test('partial receipt against saved customer share only reserves actual receipts', () => {
  const row = projectStockCard(context([task('B', { ord: 200, requested: 200,
    procurement: { totalCtn: 200, customerCtn: 200 }, warehouse: received(80) })])).items[0];
  assert.equal(row.onHand, 80); assert.equal(row.reservedUsable, 80);
  assert.equal(row.incoming, 120); assert.equal(row.available, 0);
});

test('source share dispatch preserves extra cartons and does not need a duplicate allocation event', () => {
  const row = projectStockCard(context([task('A', {
    procurement: { totalCtn: 120, customerCtn: 100 }, warehouse: received(120)
  })], shipmentChain('DISPATCHED'))).items[0];
  assert.equal(row.onHand, 80); assert.equal(row.reservedUsable, 60); assert.equal(row.available, 20);
});

test('customer share decrease releases physical stock without changing the original receipt', () => {
  const source = task('A', { ord: 150, requested: 150,
    procurement: { totalCtn: 200, customerCtn: 150 }, warehouse: received(200) });
  const row = projectStockCard(context([source])).items[0];
  assert.equal(row.received, 200); assert.equal(row.onHand, 200);
  assert.equal(row.reservedUsable, 150); assert.equal(row.available, 50);
});
test('transferred stock is not another physical receipt; split shipment display rows do not multiply sources', () => {
  const rows = [task('A', { warehouse: received(120), batchEntitlements: [{ quantity: 60 }, { quantity: 40 }] }),
    task('B', { warehouse: { hasPhysicalReceipt: false, accepted: 0 }, po: '' })];
  const result = projectStockCard(context(rows, [allocation([{ taskId: 'A', quantity: 60 }, { taskId: 'B', quantity: 40 }])]));
  assert.equal(result.items.length, 1); assert.equal(result.items[0].sources.length, 1); assert.equal(result.items[0].received, 120);
});
test('6000 catalogue products with no physical receipt create no stock rows', () => {
  assert.equal(projectStockCard(context(Array.from({ length: 6000 }, (_, i) => task('CAT-' + i, { po: '', warehouse: null })))).items.length, 0);
});
test('incoming, company, carton size and source identity are kept separate', () => {
  const a = task('A', { warehouse: received(80) });
  const b = task('B', { warehouse: received(10), ea: 24, packing: '24x1' });
  const rows = projectStockCard(context([a, b], [allocation([], 'A'), allocation([], 'B')])).items;
  assert.equal(rows.length, 2); assert.equal(rows.find(row => row.ea === 12).incoming, 40);
  assert.notEqual(rows[0].key, projectStockCard(context([a], [allocation([])], 'GHR')).items[0].key);
  assert.throws(() => projectStockCard(context([a, a])), /identity/);
});
test('a derived stock snapshot mismatch blocks an apparently free balance', () => {
  const row = projectStockCard(context([task('A', { warehouse: { ...received(120), stock: { availablePhysical: 999 } } })], [allocation([])])).items[0];
  assert.equal(row.available, null); assert.equal(row.reviewRequired, true);
});
