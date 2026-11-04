'use strict';
// Diagnostic only: explicitly replacing a simulated lock below is NOT permission
// to release any unknown native lock. No deployed source is changed by this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { copy } = require('../prototypes/stock-current-state/segmented-plan.cjs');
const uuid = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function witness(pauseMatches) {
  const rows = new Map(), entered = deferred(), resume = deferred();
  let armed = false, paused = false, attempt = 0;
  const read = async (collection, id) => copy(rows.get(collection + '/' + id) ?? null);
  const store = {
    read,
    insert: async (collection, row) => {
      const key = collection + '/' + row._id;
      if (rows.has(key)) throw Error('CONDITION');
      rows.set(key, copy(row)); return copy(row);
    },
    compareAndSet: async (collection, id, version, after) => {
      if (armed && !paused && pauseMatches({ collection, id, after })) {
        paused = true; entered.resolve(); await resume.promise;
      }
      const key = collection + '/' + id;
      if (rows.get(key)?._version !== version) throw Error('CONDITION');
      rows.set(key, copy(after)); return copy(after);
    },
    compareAndRemove: async (collection, id, owner) => {
      const key = collection + '/' + id;
      if (rows.get(key)?.attempt !== owner) throw Error('CONDITION');
      const before = rows.get(key); rows.delete(key); return copy(before);
    }
  };
  const protocol = createSegmentedFencedProof({ store, stepsPerInvocation: 100,
    newAttempt: () => 'WITNESS-' + ++attempt });
  await protocol.initialize();
  for (let n = 0; n < 3; n++) await store.insert('StockPositions', {
    _id: 'ROW-' + n, company: 'NCT', onHand: 100, _version: 'INITIAL-' + n
  });
  const request = n => ({ requestId: uuid(n), memberId: 'M', input: { request: n },
    prepare: async () => {
      const writes = [];
      for (let index = 0; index < 3; index++) {
        const before = await read('StockPositions', 'ROW-' + index);
        writes.push({ collection: 'StockPositions', before, after: { ...before, onHand: before.onHand + 10 } });
      }
      return { writes };
    } });
  armed = true;
  const old = protocol.commit(request(1)).then(value => ({ value }), error => ({ error }));
  await entered.promise;
  assert.equal((await protocol.readControl()).generation, 0);
  const lock = await read(protocol.ids.journal, protocol.ids.lockId);
  assert.equal(lock.attempt, 'WITNESS-1');
  // An explicit OFFLINE intervention tests the late-execution fence. It does not
  // prove native takeover safe at every boundary or provide such a runtime API.
  await store.compareAndRemove(protocol.ids.journal, protocol.ids.lockId, lock.attempt);
  assert.equal((await protocol.commit(request(1))).generation, 1);
  assert.equal((await protocol.commit(request(2))).generation, 2);
  const beforeLate = copy([...rows.entries()]);
  resume.resolve();
  assert.match((await old).error?.message || '', /CONDITION/);
  assert.deepEqual([...rows.entries()], beforeLate);
  assert.equal((await protocol.readControl()).generation, 2);
  for (let n = 0; n < 3; n++) assert.equal((await read('StockPositions', 'ROW-' + n)).onHand, 120);
}

test('diagnostic witness: delayed conditional domain write cannot overwrite two newer completed generations', async () => {
  await witness(event => event.collection === 'StockPositions');
});

test('diagnostic witness: delayed control phase CAS cannot roll newer generation back', async () => {
  await witness(event => event.after.pending?.phase === 'FINALIZE');
});
