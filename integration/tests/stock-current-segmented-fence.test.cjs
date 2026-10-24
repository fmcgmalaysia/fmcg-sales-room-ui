const test = require('node:test'), assert = require('node:assert/strict');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { copy } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const uuid = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';
async function fixture({ count = 3, steps = 2 } = {}) {
  const rows = new Map(), delayed = [], calls = []; let fault, attempt = 0, prepares = 0;
  const read = async (c, id) => copy(rows.get(c + '/' + id) ?? null);
  async function mutate(kind, c, id, row, expected) {
    const event = { kind, c, id, row, expected }; calls.push(copy(event));
    const injection = fault?.matches(event) ? fault : null; if (injection) fault = null;
    const apply = () => {
      const address = c + '/' + id, current = rows.get(address);
      if (kind === 'insert' && current || kind === 'cas' && current?._version !== expected
        || kind === 'remove' && current?.attempt !== expected) throw Error('Condition mismatch');
      if (kind === 'remove') rows.delete(address); else rows.set(address, copy(row));
    };
    if (injection?.when === 'delayed') { delayed.push(apply); throw Error('Unknown outcome'); }
    if (injection?.when === 'before') throw Error('Interrupted');
    apply(); if (injection?.when === 'lost') throw Error('Lost reply');
  }
  const store = { read, insert: (c, row) => mutate('insert', c, row._id, row),
    compareAndSet: (c, id, version, row) => mutate('cas', c, id, row, version),
    compareAndRemove: (c, id, expected) => mutate('remove', c, id, null, expected) };
  const protocol = createSegmentedFencedProof({ store, stepsPerInvocation: steps, newAttempt: () => 'ATTEMPT' + ++attempt });
  await protocol.initialize();
  for (let i = 0; i < count; i++) rows.set('StockPositions/S' + i, { _id: 'S' + i, company: 'NCT', onHand: 100, _version: 'V0' });
  const request = n => ({ requestId: uuid(n), memberId: 'M', input: { receipt: n }, prepare: async () => {
    prepares++; const writes = [];
    for (let i = 0; i < count; i++) { const before = await read('StockPositions', 'S' + i);
      writes.push({ collection: 'StockPositions', before, after: { ...before, onHand: before.onHand + 10, name: '巧克力😀'.repeat(20) } }); }
    return { writes };
  } });
  async function finish(n = 1) {
    for (let i = 0; i < Math.ceil(count * 3 / steps) + 5; i++) {
      const result = await protocol.commit(request(n)); if (result.ok) return result;
      assert.equal(result.pending, true); assert.equal(result.requestId, uuid(n));
      assert.deepEqual(Object.keys(result).sort(), ['ok', 'pending', 'phase', 'completedCount', 'totalRecords', 'requestId'].sort());
    }
    throw Error('Did not finish bounded resume');
  }
  return { ...protocol, store, rows, calls, delayed, request, finish, get prepares() { return prepares; }, inject: f => { fault = f; } };
}
test('901record save progresses under same request, blocks mixed reads, prepares once and increments generation once', async () => {
  const f = await fixture({ count: 901, steps: 100 });
  const first = await f.commit(f.request(1)); assert.equal(first.pending, true);
  await assert.rejects(f.readSnapshot(() => []), /pending/);
  await assert.rejects(f.commit(f.request(2)), /pending/);
  await f.finish(); assert.equal(f.prepares, 1); assert.equal((await f.readControl()).generation, 1);
  await f.commit(f.request(1)); assert.equal(f.prepares, 1);
  for (let i = 0; i < 901; i++) assert.equal((await f.store.read('StockPositions', 'S' + i)).onHand, 110);
});
const boundaries = [
  ['fragment', e => e.row?.action === 'STOCK_PLAN_FRAGMENT'],
  ['manifest', e => e.row?.action === 'STOCK_PLAN_MANIFEST'],
  ['pending', e => e.row?.pending?.phase === 'BEFORE'],
  ['apply phase', e => e.row?.pending?.phase === 'APPLY'],
  ['domain', e => e.c === 'StockPositions'],
  ['verify phase', e => e.row?.pending?.phase === 'VERIFY'],
  ['finalize phase', e => e.row?.pending?.phase === 'FINALIZE'],
  ['result', e => e.row?.outcome?.ok === true],
  ['generation', e => e.row?.generation === 1 && e.row.pending === null]
];
for (const [name, matches] of boundaries) {
  for (const when of ['before', 'lost', 'delayed']) test(`${when} ${name}: same-request recovery never duplicates quantities`, async () => {
    const f = await fixture({ steps: 100 }); f.inject({ matches, when });
    if (when === 'lost') await f.finish(); else await assert.rejects(f.finish(), /Interrupted|Unknown outcome/);
    await f.finish(); await f.finish(2);
    if (when === 'delayed') {
      assert.equal(f.delayed.length, 1);
      // Pre-root orphan staging inserts may finish late; they are never referenced.
      if (name === 'fragment') f.delayed[0](); else assert.throws(f.delayed[0], /Condition mismatch/);
    }
    assert.equal((await f.readControl()).generation, 2);
    for (let i = 0; i < 3; i++) assert.equal((await f.store.read('StockPositions', 'S' + i)).onHand, 120);
    assert.equal((await f.readControl()).pending, null);
  });
}
test('missing staged fragment after manifest blocks and never rebuilds or acknowledges partial success', async () => {
  const f = await fixture(); await f.commit(f.request(1));
  const manifest = [...f.rows.values()].find(r => r.action === 'STOCK_PLAN_MANIFEST');
  f.rows.delete(f.ids.journal + '/' + manifest.fragments[0].id);
  await assert.rejects(f.finish(), /Fragment integrity/); assert.equal(f.prepares, 1);
  assert.ok((await f.readControl()).pending); assert.equal((await f.store.read('StockPositions', 'S0')).onHand, 100);
});
test('reauthorization applies to every phase and completed replay; changed input is not a resume', async () => {
  const f = await fixture(); await f.commit(f.request(1));
  await assert.rejects(f.commit({ ...f.request(1), authorize: () => { throw Error('Role revoked'); } }), /Role revoked/);
  await assert.rejects(f.commit({ ...f.request(1), input: { receipt: 999 } }), /pending/);
  await f.finish(); await assert.rejects(f.commit({ ...f.request(1), authorize: () => { throw Error('Role revoked'); } }), /Role revoked/);
});
test('unknown lock acquisition remains blocked, no timeout theft or unconditional removal', async () => {
  const f = await fixture(); f.inject({ when: 'lost', matches: e => e.id === f.ids.lockId && e.kind === 'insert' });
  await assert.rejects(f.finish(), /Lost reply/); await assert.rejects(f.finish(), /Condition mismatch/);
  assert.equal(f.prepares, 0); assert.equal((await f.store.read(f.ids.journal, f.ids.lockId)).attempt, 'ATTEMPT1');
});
