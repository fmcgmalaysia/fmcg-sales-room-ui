'use strict';
// Local candidate review only. Does not install or enable the opt-in policy.
const test = require('node:test'), assert = require('node:assert/strict');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { copy } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const uuid = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(pauseMatches, { insertDomain = false, steps = 100 } = {}) {
  const rows = new Map(), entered = deferred(), release = deferred(), calls = [];
  let armed = false, paused = false, attempt = 0;
  const read = async (c, id) => copy(rows.get(c + '/' + id) ?? null);
  async function mutate(kind, c, id, row, expected) {
    calls.push({ kind, c, id });
    if (armed && !paused && pauseMatches?.({ kind, c, id, row })) {
      paused = true; entered.resolve(); await release.promise;
    }
    const address = c + '/' + id, current = rows.get(address);
    if (kind === 'insert' && current || kind === 'cas' && current?._version !== expected) throw Error('CONDITION');
    rows.set(address, copy(row)); return copy(row);
  }
  const store = { read,
    insert: (c, row) => mutate('insert', c, row._id, row),
    compareAndSet: (c, id, version, row) => mutate('cas', c, id, row, version),
    compareAndRemove: async () => { throw Error('NO_LOCK_REMOVAL_ALLOWED'); } };
  const api = createSegmentedFencedProof({ store, coordination: 'CONTROL_CAS_CANDIDATE',
    stepsPerInvocation: steps, newAttempt: () => 'ATTEMPT-' + ++attempt });
  await api.initialize();
  if (!insertDomain) for (let n = 0; n < 3; n++) await store.insert('StockPositions', {
    _id: 'S' + n, company: 'NCT', onHand: 100, _version: 'INITIAL-' + n });
  const request = n => ({ requestId: uuid(n), memberId: 'M', input: { receipt: n }, prepare: async () => {
    const writes = [];
    for (let i = 0; i < 3; i++) { const before = await read('StockPositions', 'S' + i);
      writes.push({ collection: 'StockPositions', before,
        after: { ...before, _id: 'S' + i, company: 'NCT', onHand: (before?.onHand || 0) + 10 } }); }
    return { writes };
  } });
  async function finish(n) { for (let k = 0; k < 20; k++) { const r = await api.commit(request(n)); if (r.ok) return r; } throw Error('NO_PROGRESS'); }
  armed = true;
  return { api, rows, calls, request, finish, entered, release, read };
}
const boundaries = [
  ['domain CAS', e => e.c === 'StockPositions' && e.kind === 'cas', false],
  ['domain insert', e => e.c === 'StockPositions' && e.kind === 'insert', true],
  ['pending control', e => e.row?.pending?.phase === 'BEFORE', false],
  ['phase control', e => e.row?.pending?.phase === 'FINALIZE', false],
  ['result receipt', e => e.row?.outcome?.ok === true, false],
  ['generation control', e => e.row?.generation === 1 && e.row.pending === null, false]
];
for (const [name, matches, insertDomain] of boundaries) test(`local CAS candidate: old ${name} resumes after two newer completions without overwrite or lock deletion`, async () => {
  const f = await fixture(matches, { insertDomain });
  const old = f.api.commit(f.request(1)).then(value => ({ value }), error => ({ error }));
  await f.entered.promise;
  assert.equal((await f.finish(1)).generation, 1);
  assert.equal((await f.finish(2)).generation, 2);
  const expected = copy([...f.rows.entries()]);
  f.release.resolve(); await old;
  assert.deepEqual([...f.rows.entries()], expected);
  assert.equal((await f.api.readControl()).generation, 2);
  for (let n = 0; n < 3; n++) assert.equal((await f.read('StockPositions', 'S' + n)).onHand, insertDomain ? 20 : 120);
  assert.equal(f.calls.some(c => c.id === f.api.ids.lockId), false);
});

test('local CAS candidate: competing different request cannot take a pending plan or reuse its identity', async () => {
  const f = await fixture(e => e.c === 'StockPositions');
  const old = f.api.commit(f.request(1)).then(value => ({ value }), error => ({ error }));
  await f.entered.promise;
  await assert.rejects(f.api.commit(f.request(2)), /Prior inventory save pending/);
  await assert.rejects(f.api.commit({ ...f.request(1), input: { receipt: 999 } }), /Prior inventory save pending/);
  await assert.rejects(f.api.readSnapshot(() => []), /pending/);
  assert.equal((await f.finish(1)).generation, 1);
  f.release.resolve(); await old;
  assert.equal((await f.api.readControl()).generation, 1);
});

test('local CAS candidate: sequential bounded calls preserve one result and one generation increment', async () => {
  const f = await fixture(null, { steps: 2 });
  await f.finish(1); await f.finish(1); await f.finish(2);
  assert.equal((await f.api.readControl()).generation, 2);
  assert.equal([...f.rows.values()].filter(row => row.outcome?.ok).length, 2);
  for (let n = 0; n < 3; n++) assert.equal((await f.read('StockPositions', 'S' + n)).onHand, 120);
});

for (const action of ['STOCK_PLAN_FRAGMENT', 'STOCK_PLAN_MANIFEST']) test(`local CAS candidate: delayed ${action} cannot replace the selected original plan`, async () => {
  const f = await fixture(e => e.row?.action === action);
  const old = f.api.commit(f.request(1)).then(value => ({ value }), error => ({ error }));
  await f.entered.promise;
  await f.finish(1); await f.finish(2);
  const expected = copy([...f.rows.entries()]);
  f.release.resolve(); await old;
  for (const [key, row] of expected) assert.deepEqual(f.rows.get(key), row);
  const known = new Set(expected.map(([key]) => key));
  for (const [key, row] of f.rows) if (!known.has(key)) assert.equal(row.action, 'STOCK_PLAN_FRAGMENT');
  assert.equal((await f.api.readControl()).generation, 2);
  for (let n = 0; n < 3; n++) assert.equal((await f.read('StockPositions', 'S' + n)).onHand, 120);
});

test('local CAS candidate: two first requests race at control CAS, loser cannot rebase its frozen plan', async () => {
  const f = await fixture(e => e.row?.pending?.phase === 'BEFORE');
  const old = f.api.commit(f.request(1)).then(value => ({ value }), error => ({ error }));
  await f.entered.promise;
  assert.equal((await f.finish(2)).generation, 1);
  f.release.resolve(); assert.ok((await old).error);
  await assert.rejects(f.finish(1), /Prepared generation stale/);
  assert.equal((await f.api.readControl()).generation, 1);
  for (let n = 0; n < 3; n++) assert.equal((await f.read('StockPositions', 'S' + n)).onHand, 110);
});
