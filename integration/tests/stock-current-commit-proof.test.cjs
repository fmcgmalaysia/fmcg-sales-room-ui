const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommitProof, hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const copy = row => JSON.parse(JSON.stringify(row));
const uuid = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';

function fixture(company = 'NCT') {
  const rows = new Map(), calls = [];
  let injection = null;
  const mutate = async (kind, collection, row) => {
    const key = collection + '/' + (kind === 'remove' ? row : row._id);
    const event = { kind, collection, row: copy(row), key };
    calls.push(event);
    const fault = injection?.matches(event) ? injection : null;
    if (fault) injection = null;
    const apply = () => {
      if (kind === 'insert' && rows.has(key)) throw Error('Duplicate insert');
      if (kind === 'update' && !rows.has(key)) throw Error('Missing update');
      if (kind === 'remove') rows.delete(key); else rows.set(key, copy(row));
    };
    if (fault?.when === 'before') throw Error('Injected failure before write');
    if (fault?.when === 'delayed') { fault.capture(apply); throw Error('Unknown request outcome'); }
    apply();
    if (fault?.when === 'after') throw Error('Injected failure after write');
    return copy(row);
  };
  const store = {
    read: async (c, id) => copy(rows.get(c + '/' + id) || null),
    insert: (c, row) => mutate('insert', c, row),
    update: (c, row) => mutate('update', c, row),
    remove: (c, id) => mutate('remove', c, id)
  };
  const protocol = createCommitProof({ store, company });
  const seed = (c, row) => rows.set(c + '/' + row._id, copy(row));
  const p = { _id: 'SOURCE', company, onHand: 220, reserved: 200, revision: 0 };
  const product = { _id: 'PRODUCT', company, onHand: 220, reserved: 200, available: 20, revision: 0 };
  seed('StockPositions', p); seed('StockProducts', product);
  const allocate = (n = 1, amount = 20, customer = 'A') => ({
    requestId: uuid(n), memberId: 'EMPLOYEE', input: { amount, customer },
    prepare: async () => {
      const source = await store.read('StockPositions', 'SOURCE');
      const summary = await store.read('StockProducts', 'PRODUCT');
      if (summary.available < amount) throw Error('Insufficient available stock');
      return { writes: [
        { collection: protocol.ids.journal, before: null, after: { _id: 'ALLOCATION-' + n, company, customer, amount } },
        { collection: 'StockPositions', before: source, after: { ...source, reserved: source.reserved + amount, revision: source.revision + 1 } },
        { collection: 'StockClaims', before: null, after: { _id: 'CLAIM-' + n, company, customer, quantity: amount } },
        { collection: 'StockProducts', before: summary, after: { ...summary, reserved: summary.reserved + amount, available: summary.available - amount, revision: summary.revision + 1 } }
      ] };
    },
    validate: async () => {
      const source = await store.read('StockPositions', 'SOURCE'), summary = await store.read('StockProducts', 'PRODUCT');
      assert.equal(source.reserved, summary.reserved);
      assert.equal(summary.available + summary.reserved, summary.onHand);
    }
  });
  return { ...protocol, store, rows, calls, seed, allocate, inject: fault => { injection = fault; } };
}

test('current balance commits once; replay does not prepare or write balances again', async () => {
  const f = fixture(), request = f.allocate();
  const first = await f.commit(request);
  const writes = f.calls.filter(call => call.collection === 'StockPositions').length;
  assert.deepEqual(await f.commit({ ...request, prepare: () => assert.fail('replay prepared') }), first);
  assert.equal(f.calls.filter(call => call.collection === 'StockPositions').length, writes);
  assert.equal((await f.store.read('StockProducts', 'PRODUCT')).available, 0);
  await assert.rejects(f.commit({ ...request, input: { amount: 19 } }), /identity reused/);
});

test('two employees cannot allocate the same last 20 cartons', async () => {
  const f = fixture(), first = f.allocate(), second = { ...f.allocate(2, 20, 'C'), memberId: 'OTHER' };
  let release, entered;
  const hold = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { entered = resolve; });
  const running = f.commit({ ...first, prepare: async () => { entered(); await hold; return first.prepare(); } });
  await arrived;
  await assert.rejects(f.commit(second), /processing|Duplicate/);
  release(); await running;
  await assert.rejects(f.commit(second), /Insufficient/);
  assert.equal((await f.store.read('StockPositions', 'SOURCE')).reserved, 220);
});

const boundaries = [
  ['prepared', e => e.kind === 'insert' && Boolean(e.row.plan)],
  ['pending', e => Boolean(e.row.pending)],
  ['business', e => e.row._id === 'ALLOCATION-1'],
  ['source', e => e.collection === 'StockPositions'],
  ['claim', e => e.collection === 'StockClaims'],
  ['summary', e => e.collection === 'StockProducts'],
  ['result', e => Boolean(e.row.outcome)],
  ['generation', e => e.row.generation === 1 && e.row.pending === null]
];
for (const [boundary, matches] of boundaries) {
  for (const when of ['before', 'after']) {
    test(`settled failure ${when} ${boundary} resumes without duplicate stock`, async () => {
      const f = fixture(), request = f.allocate();
      f.inject({ matches, when });
      await assert.rejects(f.commit(request), /Injected/);
      const control = await f.readControl();
      if (control.pending) {
        await assert.rejects(f.readSnapshot(() => f.store.read('StockProducts', 'PRODUCT')), /pending/);
        await assert.rejects(f.commit(f.allocate(2, 1, 'C')), /pending/);
      }
      await f.commit(request);
      const summary = await f.store.read('StockProducts', 'PRODUCT');
      assert.equal(summary.reserved, 220); assert.equal(summary.available, 0);
      assert.equal((await f.readControl()).generation, 1);
      assert.equal((await f.readControl()).pending, null);
      assert.equal([...f.rows.values()].filter(row => row._id === 'ALLOCATION-1').length, 1);
    });
  }
}

test('result recovery finalizes pending, and an old completed replay cannot overwrite newer balances', async () => {
  const f = fixture();
  f.inject({ matches: e => Boolean(e.row.outcome), when: 'after' });
  await assert.rejects(f.commit(f.allocate(1, 10)), /Injected/);
  await f.commit(f.allocate(1, 10));
  await f.commit(f.allocate(2, 10, 'C'));
  await f.commit(f.allocate(1, 10));
  assert.equal((await f.store.read('StockProducts', 'PRODUCT')).revision, 2);
  assert.equal((await f.readControl()).generation, 2);
});

test('prepared operation with no writes is rejected after another operation advances generation', async () => {
  const f = fixture();
  f.inject({ matches: e => Boolean(e.row.plan), when: 'after' });
  await assert.rejects(f.commit(f.allocate(1, 10)), /Injected/);
  await f.commit(f.allocate(2, 10, 'C'));
  await assert.rejects(f.commit(f.allocate(1, 10)), /generation stale/);
  assert.equal((await f.store.read('StockProducts', 'PRODUCT')).available, 10);
});

test('snapshot rejects a commit completed between its two control reads', async () => {
  const f = fixture();
  await assert.rejects(f.readSnapshot(async () => {
    const old = await f.store.read('StockProducts', 'PRODUCT');
    await f.commit(f.allocate());
    return old;
  }), /changed during read/);
});

test('permanent old lock stays blocked; another company remains independent', async () => {
  const f = fixture();
  f.seed(f.ids.journal, { _id: f.ids.lockId, details: { owner: 'UNKNOWN_EXECUTION' } });
  await assert.rejects(f.commit(f.allocate()), /processing/);
  const other = fixture('GHR'); await other.commit(other.allocate());
  assert.equal((await other.readControl()).generation, 1);
  assert.equal((await f.store.read(f.ids.journal, f.ids.lockId)).details.owner, 'UNKNOWN_EXECUTION');
});

test('uncertain lock deletion leaves pending state safe and cannot be silently stolen', async () => {
  const f = fixture();
  f.inject({ matches: e => e.kind === 'remove' && e.row === f.ids.lockId, when: 'before' });
  await assert.rejects(f.commit(f.allocate()), /Injected/);
  await assert.rejects(f.commit(f.allocate()), /processing/);
  assert.equal((await f.store.read('StockProducts', 'PRODUCT')).reserved, 220);
});

test('delayed UPDATE counterexample: after-image retry can overwrite a later committed balance', async () => {
  const f = fixture(); let lateWrite;
  f.inject({ matches: e => e.collection === 'StockPositions', when: 'delayed', capture: apply => { lateWrite = apply; } });
  await assert.rejects(f.commit(f.allocate(1, 10)), /Unknown request/);
  await assert.rejects(f.readSnapshot(() => f.store.read('StockProducts', 'PRODUCT')), /pending/);
  // Same-request retry writes the intended old image and publishes generation 1.
  await f.commit(f.allocate(1, 10));
  await f.commit(f.allocate(2, 10, 'C'));
  assert.equal((await f.store.read('StockPositions', 'SOURCE')).reserved, 220);
  // The first failed network request can still arrive after generation 2.
  lateWrite();
  const source = await f.store.read('StockPositions', 'SOURCE');
  const summary = await f.readSnapshot(() => f.store.read('StockProducts', 'PRODUCT'));
  assert.equal(source.reserved, 210);
  assert.equal(summary.rows.reserved, 220);
  assert.equal(summary.generation, 2);
  // A passing reproducer is evidence AGAINST production readiness, not a safety pass.
  assert.notEqual(source.reserved, summary.rows.reserved);
});

test('proof lock matches production journal hash identity', () => {
  const f = fixture();
  const { operationId } = require('./load-master-module.cjs')('purchaseOperationJournal.js');
  assert.equal(f.ids.lockId, operationId('NCT/PURCHASE', 'LOCK'));
  assert.equal(hash('NCT/PURCHASE', uuid(1), 'EMPLOYEE'), operationId('NCT/PURCHASE', uuid(1), 'EMPLOYEE'));
});
