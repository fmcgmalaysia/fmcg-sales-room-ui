const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createOperationJournal, operationId } = load('purchaseOperationJournal.js');
const { createPlannerAllocationOperations, allocationVersion, readAllocations } = load('plannerAllocation.js');

const clone = value => JSON.parse(JSON.stringify(value));
const requestId = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';
const employee = id => ({ memberId: id, staffId: id, staffName: id });
function fixture() {
  const records = new Map();
  const store = {
    all: async c => [...records].filter(([key]) => key.startsWith(c + '/')).map(([, row]) => clone(row)),
    read: async (c, id) => clone(records.get(c + '/' + id) || null),
    insert: async (c, row) => {
      const key = c + '/' + row._id;
      // Models the existing store contract: insert is unique; never upsert a lock.
      if (records.has(key)) throw Error('duplicate insert');
      records.set(key, clone(row));
      return clone(row);
    },
    remove: async (c, id) => records.delete(c + '/' + id)
  };
  return { store, records };
}

test('simultaneous employees sharing company scope enter only one mutation', async () => {
  const f = fixture(), journal = createOperationJournal({ store: f.store });
  let enter, finish, mutations = 0;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { finish = resolve; });
  const run = (id, n) => journal({ collection: 'N', scope: 'NCT/PURCHASE', staff: employee(id),
    requestId: requestId(n), input: { id }, prepare: async () => ({ id }),
    apply: async () => { mutations++; enter(); await blocked; return { ok: true }; } });
  const first = run('P1', 1);
  await entered;
  await assert.rejects(run('P2', 2), /processing/);
  assert.equal(mutations, 1);
  finish(); await first;
  assert.equal((await f.store.all('N')).some(row => row.details.kind === 'LOCK'), false);
});

test('two callers that both read no lock still cannot both insert its fixed identity', async () => {
  const f = fixture(), lockId = operationId('NCT/PURCHASE', 'LOCK'), originalRead = f.store.read;
  let count = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  f.store.read = async (c, id) => {
    if (id === lockId && count < 2) {
      const observed = await originalRead(c, id);
      count++; if (count === 2) release();
      await barrier; return observed;
    }
    return originalRead(c, id);
  };
  let mutations = 0;
  const journal = createOperationJournal({ store: f.store });
  const run = n => journal({ collection: 'N', scope: 'NCT/PURCHASE', staff: employee('P' + n),
    requestId: requestId(n), input: { n }, prepare: async () => ({ n }),
    apply: async () => { mutations++; return { ok: true }; } });
  const results = await Promise.allSettled([run(1), run(2)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected').length, 1);
  assert.equal(mutations, 1);
});

test('real allocation save refuses competing demand, then rejects its stale retry', async () => {
  const f = fixture();
  const tasks = ['SOURCE', 'A', 'B'].map(id => ({ id, customerId: id, orderId: id, sourceLineId: id,
    barcode: '001', packing: '12x1', ea: 12, ord: id==='SOURCE'?0:20, po: 'PO-1', supplierId: 'SUP',
    ...(id==='SOURCE'?{procurementSource:true,customerDemandTaskId:'A',procurement:{totalCtn:30,customerCtn:0,expectedExtra:30}}:{}),
    warehouse: id === 'SOURCE' ? { hasPhysicalReceipt:true,accepted: 30 } : null }));
  const workspace = { company: 'NCT', tasks };
  let entered, resume;
  const held = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  let pause = true;
  const save = createPlannerAllocationOperations({ store: f.store, names: { NCT: { activity: 'N' } },
    readWorkspace: async () => { if (pause) { pause = false; entered(); await gate; } return workspace; } });
  const version = allocationVersion(workspace, []);
  const request = (n, target) => ({ company: 'NCT', staff: employee('P' + n), requestId: requestId(n),
    input: { action: 'ALLOCATE', planMode:'CUSTOMER',taskId:target,batchId:'WHOLE',borrow:false,version } });
  const first = save(request(1, 'A')); await held;
  await assert.rejects(save(request(2, 'B')), /processing/);
  resume(); await first;
  await assert.rejects(save(request(2, 'B')), /changed/);
  const allocations = readAllocations(await f.store.all('N'));
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].targets[0].taskId, 'A');
  assert.equal(allocations[0].targets[0].quantity, 20);
});

test('lost reply after allocation event resumes original save without duplicate allocation', async () => {
  const f = fixture(), originalInsert = f.store.insert;
  let loseReply = true;
  f.store.insert = async (c, row) => {
    const saved = await originalInsert(c, row);
    if (loseReply && row.action === 'PLANNER_ALLOCATION_SAVED') { loseReply = false; throw Error('reply lost'); }
    return saved;
  };
  const workspace = { company: 'NCT', tasks: [{ id: 'A', customerId: 'C', orderId: 'O', sourceLineId: 'L',
    barcode: '001', packing: '12x1', ea: 12, ord: 100, po: 'PO-1', supplierId: 'SUP', warehouse: { hasPhysicalReceipt:true,accepted: 120 } }] };
  const save = createPlannerAllocationOperations({ store: f.store, names: { NCT: { activity: 'N' } }, readWorkspace: async () => workspace });
  const request = { company: 'NCT', staff: employee('P'), requestId: requestId(1), input: { action: 'ALLOCATE',
    planMode:'CUSTOMER',taskId:'A',batchId:'WHOLE',borrow:false,version: allocationVersion(workspace, []) } };
  await assert.rejects(save(request), /reply lost/);
  await save(request); await save(request);
  const rows = await f.store.all('N');
  assert.equal(rows.filter(row => row.action === 'PLANNER_ALLOCATION_SAVED').length, 1);
  assert.equal(readAllocations(rows)[0].targets[0].quantity, 100);
  assert.equal(workspace.tasks[0].warehouse.accepted, 120);
  assert.equal(rows.filter(row => row.details?.kind === 'RESULT').length, 1);
});

test('a crash-left lock is retained; unrelated request cannot steal or time-expire it', async () => {
  const f = fixture(), lockId = operationId('NCT/PURCHASE', 'LOCK');
  await f.store.insert('N', { _id: lockId, details: { owner: 'CRASHED', time: '2000-01-01T00:00:00Z' } });
  const journal = createOperationJournal({ store: f.store });
  await assert.rejects(journal({ collection: 'N', scope: 'NCT/PURCHASE', staff: employee('P'), requestId: requestId(1),
    input: {}, prepare: async () => assert.fail('must not prepare'), apply: async () => assert.fail('must not apply') }), /processing/);
  assert.equal((await f.store.read('N', lockId)).details.owner, 'CRASHED');
});

test('company-scoped locks do not block another company and replay cannot change its payload', async () => {
  const f = fixture(), journal = createOperationJournal({ store: f.store });
  await f.store.insert('N', { _id: operationId('NCT/PURCHASE', 'LOCK'), details: { owner: 'OTHER' } });
  const request = { collection: 'G', scope: 'GHR/PURCHASE', staff: employee('P'), requestId: requestId(1),
    input: { quantity: 20 }, prepare: async () => ({ quantity: 20 }), apply: async plan => ({ ok: true, ...plan }) };
  assert.equal((await journal(request)).quantity, 20);
  await assert.rejects(journal({ ...request, input: { quantity: 21 } }), /different changes/);
});
