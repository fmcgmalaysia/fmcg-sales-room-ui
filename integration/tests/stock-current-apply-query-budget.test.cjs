'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { copy } = require('../prototypes/stock-current-state/segmented-plan.cjs');
async function fixture(batchApplyReads) {
  const rows = new Map(), metrics = { domainReads: 0, domainWrites: 0, prepares: 0 };
  let attempt = 0, failWriteAt = 0, corruptBatchAt = 0, batchCount = 0;
  const read = async (c, id) => { if (c === 'StockPositions') metrics.domainReads++; return copy(rows.get(c + '/' + id) ?? null); };
  const store = {
    read,
    readMany: async (c, ids) => {
      if (c === 'StockPositions') { metrics.domainReads++; batchCount++; }
      const found = ids.map(id => copy(rows.get(c + '/' + id) ?? null));
      return c === 'StockPositions' && batchCount === corruptBatchAt ? found.slice(0, -1) : found;
    },
    insert: async (c, row) => {
      const key = c + '/' + row._id; if (rows.has(key)) throw Error('DUPLICATE');
      rows.set(key, copy(row)); return copy(row);
    },
    compareAndSet: async (c, id, version, after) => {
      // Retain the current SDK adapter's extra read used to construct its patch;
      // this test does not pretend that optimizing the core removes that query.
      const current = await read(c, id);
      if (current?._version !== version) throw Error('CONDITION');
      if (c === 'StockPositions') {
        if (failWriteAt && metrics.domainWrites + 1 === failWriteAt) { failWriteAt = 0; throw Error('KNOWN_FAILURE'); }
        metrics.domainWrites++;
      }
      rows.set(c + '/' + id, copy(after)); return copy(after);
    },
    compareAndRemove: async (c, id, owner) => {
      const key = c + '/' + id; if (rows.get(key)?.attempt !== owner) throw Error('CONDITION'); rows.delete(key);
    }
  };
  const api = createSegmentedFencedProof({ store, stepsPerInvocation: 100, batchApplyReads, newAttempt: () => 'Q-' + ++attempt });
  await api.initialize();
  for (let n = 0; n < 20; n++) await store.insert('StockPositions', { _id: 'S' + n, company: 'NCT', onHand: 100, _version: 'V' + n });
  const request = { requestId: '11111111-1111-4111-8111-111111111111', memberId: 'M', input: { receive: 10 }, prepare: async () => {
    metrics.prepares++;
    return { writes: Array.from({ length: 20 }, (_, n) => {
      const before = copy(rows.get('StockPositions/S' + n));
      return { collection: 'StockPositions', before, after: { ...before, onHand: before.onHand + 10 } };
    }) };
  } };
  return { api, rows, request, metrics, fail: n => { failWriteAt = n; }, corrupt: n => { corruptBatchAt = n; } };
}

test('batch read candidate reduces 20-update domain query calls from62to24 with identical20conditional writes and final images', async t => {
  const old = await fixture(false), next = await fixture(true);
  for (const f of [old, next]) {
    assert.equal((await f.api.commit(f.request)).generation, 1);
    for (let n = 0; n < 20; n++) assert.equal(f.rows.get('StockPositions/S' + n).onHand, 110);
    assert.equal(f.metrics.domainWrites, 20);
  }
  assert.equal(old.metrics.domainReads, 62); assert.equal(next.metrics.domainReads, 24);
  for (let n = 0; n < 20; n++) assert.deepEqual(old.rows.get('StockPositions/S' + n), next.rows.get('StockPositions/S' + n));
  t.diagnostic(JSON.stringify({ oldDomainQueryCalls: 62, candidateDomainQueryCalls: 24,
    conditionalWrites: 20, nativeLatencyAccepted: false }));
});

test('failed eighth write leaves original cursor and read barrier; recovery skips seven exact applied images', async () => {
  const f = await fixture(true); f.fail(8);
  await assert.rejects(f.api.commit(f.request), /KNOWN_FAILURE/);
  assert.equal((await f.api.readControl()).pending.phase, 'APPLY');
  assert.equal((await f.api.readControl()).pending.cursor, 0);
  await assert.rejects(f.api.readSnapshot(() => []), /pending/);
  assert.equal((await f.api.commit(f.request)).generation, 1);
  assert.equal(f.metrics.domainWrites, 20); assert.equal(f.metrics.prepares, 1);
  for (let n = 0; n < 20; n++) assert.equal(f.rows.get('StockPositions/S' + n).onHand, 110);
});

test('incomplete batch verification never advances or acknowledges; later exact readback does not rewrite applied data', async () => {
  const f = await fixture(true); f.corrupt(3);
  await assert.rejects(f.api.commit(f.request), /Exact complete image batch required/);
  assert.equal((await f.api.readControl()).pending.cursor, 0);
  assert.equal(f.metrics.domainWrites, 20);
  assert.equal((await f.api.commit(f.request)).generation, 1);
  assert.equal(f.metrics.domainWrites, 20); assert.equal(f.metrics.prepares, 1);
});
