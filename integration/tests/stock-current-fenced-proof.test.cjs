const test = require('node:test');
const assert = require('node:assert/strict');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';

async function fixture(company = 'NCT') {
  const rows = new Map(), delayed = [], calls = [];
  let fault = null;
  const read = async (c, id) => copy(rows.get(c + '/' + id) || null);
  const mutate = async (kind, collection, row, expected) => {
    const id = typeof row === 'string' ? row : row._id;
    const event = { kind, collection, id, row, expected }; calls.push(copy(event));
    const injection = fault?.matches(event) ? fault : null;
    if (injection) fault = null;
    const apply = () => {
      const address = collection + '/' + id, current = rows.get(address);
      if (kind === 'insert' && current) throw Error('Duplicate');
      if (kind === 'cas' && (!current || current._version !== expected)) throw Error('Condition mismatch');
      if (kind === 'remove' && (!current || current.attempt !== expected)) throw Error('Condition mismatch');
      if (kind === 'remove') rows.delete(address); else rows.set(address, copy(row));
    };
    if (injection?.when === 'delayed') { delayed.push(apply); throw Error('Unknown outcome'); }
    if (injection?.when === 'before') throw Error('Before write');
    apply();
    if (injection?.when === 'lost') throw Error('Lost reply');
    if (injection?.when === 'duplicate-later') delayed.push(apply);
    return copy(row);
  };
  const store = { read, insert: (c, r) => mutate('insert', c, r),
    compareAndSet: (c, id, version, r) => { assert.equal(id, r._id); return mutate('cas', c, r, version); },
    compareAndRemove: (c, id, attempt) => mutate('remove', c, id, attempt) };
  const p = createFencedProof({ store, company }); await p.initialize();
  const seed = (c, r) => rows.set(c + '/' + r._id, copy(r));
  seed('StockPositions', { _id: 'SOURCE', company, onHand: 220, reserved: 200, _version: 'S0' });
  seed('StockProducts', { _id: 'PRODUCT', company, onHand: 220, reserved: 200, available: 20, _version: 'P0' });
  const allocate = (n = 1, amount = 10) => ({ requestId: uuid(n), memberId: 'EMPLOYEE', input: { amount },
    prepare: async () => {
      const source = await read('StockPositions', 'SOURCE'), product = await read('StockProducts', 'PRODUCT');
      if (product.available < amount) throw Error('Insufficient');
      return { writes: [
        { collection: p.ids.journal, before: null, after: { _id: 'DOMAIN-' + n, company, amount } },
        { collection: 'StockPositions', before: source, after: { ...source, reserved: source.reserved + amount } },
        { collection: 'StockClaims', before: null, after: { _id: 'CLAIM-' + n, company, amount } },
        { collection: 'StockProducts', before: product, after: { ...product, reserved: product.reserved + amount, available: product.available - amount } }
      ] };
    }, validate: async () => {
      const source = await read('StockPositions', 'SOURCE'), product = await read('StockProducts', 'PRODUCT');
      assert.equal(source.reserved, product.reserved); assert.equal(product.onHand, product.available + product.reserved);
    } });
  return { ...p, store, rows, seed, allocate, calls, delayed, inject: f => { fault = f; } };
}

test('adapter refuses a read/update-only store', () => {
  assert.throws(() => createFencedProof({ store: { read() {}, insert() {}, update() {} } }), /Conditional storage/);
});

const boundaries = [
  ['prepared', e => Boolean(e.row?.plan)],
  ['pending', e => Boolean(e.row?.pending)],
  ['domain', e => e.id === 'DOMAIN-1'],
  ['source', e => e.collection === 'StockPositions'],
  ['claim', e => e.collection === 'StockClaims'],
  ['summary', e => e.collection === 'StockProducts'],
  ['result', e => Boolean(e.row?.outcome)],
  ['finalize', e => e.kind === 'cas' && e.row?.generation === 1 && e.row.pending === null]
];
for (const [name, matches] of boundaries) {
  test(`late ${name} request cannot overwrite a later committed operation`, async () => {
    const f = await fixture(); f.inject({ matches, when: 'delayed' });
    await assert.rejects(f.commit(f.allocate(1)), /Unknown outcome/);
    await f.commit(f.allocate(1)); await f.commit(f.allocate(2));
    assert.equal(f.delayed.length, 1);
    assert.throws(f.delayed[0], /Condition mismatch|Duplicate/);
    const snapshot = await f.readSnapshot(() => f.store.read('StockProducts', 'PRODUCT'));
    assert.equal(snapshot.generation, 2); assert.equal(snapshot.rows.available, 0);
    assert.equal((await f.store.read('StockPositions', 'SOURCE')).reserved, 220);
  });
  test(`lost reply at ${name} confirms exact effect without a second quantity change`, async () => {
    const f = await fixture(); f.inject({ matches, when: 'lost' });
    await f.commit(f.allocate(1)); await f.commit(f.allocate(1));
    assert.equal((await f.readControl()).generation, 1);
    assert.equal((await f.store.read('StockProducts', 'PRODUCT')).available, 10);
  });
}

test('old lock release cannot delete a new execution of the same operation', async () => {
  const f = await fixture();
  f.inject({ matches: e => e.kind === 'remove', when: 'duplicate-later' });
  await f.commit(f.allocate());
  const firstAttempt = f.calls.find(e => e.kind === 'remove').expected;
  await f.store.insert(f.ids.journal, { _id: f.ids.lockId, company: 'NCT', attempt: 'NEW-ATTEMPT', owner: 'SAME-OPERATION' });
  assert.notEqual(firstAttempt, 'NEW-ATTEMPT');
  assert.throws(f.delayed[0], /Condition mismatch/);
  assert.equal((await f.store.read(f.ids.journal, f.ids.lockId)).attempt, 'NEW-ATTEMPT');
});

test('unknown lock acquisition or release is blocked and never stolen by retry', async () => {
  for (const kind of ['insert', 'remove']) {
    const f = await fixture();
    f.inject({ matches: e => e.id === f.ids.lockId && e.kind === kind, when: 'lost' });
    await assert.rejects(f.commit(f.allocate()), /Lost reply/);
    // Lost release has already removed the lock, so an ordinary retry can read RESULT.
    if (kind === 'remove') await f.commit(f.allocate());
    else await assert.rejects(f.commit(f.allocate()), /Duplicate/);
  }
});

test('pending blocks other requests and snapshots; another company stays independent', async () => {
  const f = await fixture(); f.inject({ matches: e => e.collection === 'StockPositions', when: 'before' });
  await assert.rejects(f.commit(f.allocate()), /Before write/);
  await assert.rejects(f.readSnapshot(() => f.store.read('StockProducts', 'PRODUCT')), /pending/);
  await assert.rejects(f.commit(f.allocate(2)), /pending/);
  const other = await fixture('GHR'); await other.commit(other.allocate());
  await f.commit(f.allocate());
});

test('competition for last stock, stale reads and changed request digest are rejected', async () => {
  const f = await fixture();
  const settled = await Promise.allSettled([f.commit(f.allocate(1, 20)), f.commit(f.allocate(2, 20))]);
  assert.equal(settled.filter(r => r.status === 'fulfilled').length, 1);
  const winner = settled[0].status === 'fulfilled' ? 1 : 2;
  await assert.rejects(f.commit({ ...f.allocate(winner, 20), input: { amount: 19 } }), /identity reused/);
  const g = await fixture();
  await assert.rejects(g.readSnapshot(async () => {
    const old = await g.store.read('StockProducts', 'PRODUCT'); await g.commit(g.allocate()); return old;
  }), /changed during read/);
});
