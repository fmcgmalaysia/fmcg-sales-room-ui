const test = require('node:test'), assert = require('node:assert/strict');
const { createSdkConditionalStore } = require('../prototypes/stock-current-state/sdk-conditional-store.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = n => String(n).padStart(8, '0') + '-1111-4111-8111-111111111111';
function fixture() {
  const rows = new Map(), delayed = [];
  let fault = null, transportFault = null;
  const key = (c, id) => c + '/' + id;
  const matching = (row, condition) => Object.entries(condition).every(([field, value]) => row?.[field] === value.$eq);
  async function execute(event, apply) {
    const injection = transportFault?.matches(event) ? transportFault : null;
    if (injection) transportFault = null;
    if (injection?.when === 'before') throw Error('Transport before write');
    if (injection?.when === 'delayed') { delayed.push(apply); throw Error('Transport unknown outcome'); }
    const result = apply();
    if (injection?.when === 'lost') throw Error('Transport lost reply');
    return result;
  }
  const items = {
    query: c => {
      let id, limit;
      const query = { eq: (field, value) => { assert.equal(field, '_id'); id = value; return query; },
        limit: value => { limit = value; return query; }, find: async options => {
          assert.equal(options.consistentRead, true); assert.equal(limit, 2);
          const row = rows.get(key(c, id)); return { items: row ? [copy(row)] : [] };
        } };
      return query;
    },
    insert: async (c, row) => execute({ kind: 'insert', c, id: row._id, row }, () => {
      if (rows.has(key(c, row._id))) throw Error('Duplicate');
      rows.set(key(c, row._id), { ...copy(row), _updatedDate: 'SYSTEM' }); return copy(rows.get(key(c, row._id)));
    }),
    patch: (c, id) => {
      const changes = [];
      const patch = { setField: (field, value) => { changes.push({ field, value: copy(value) }); return patch; },
        removeField: field => { changes.push({ field, remove: true }); return patch; },
        run: async options => {
          const apply = () => {
            const row = rows.get(key(c, id));
            if (!matching(row, options.condition)) throw Error('WDE0193: Update condition not met.');
            const next = copy(row);
            for (const change of changes) { if (change.remove) delete next[change.field]; else next[change.field] = change.value; }
            rows.set(key(c, id), next); return copy(next);
          };
          if (fault?.(c, id)) { fault = null; delayed.push(apply); throw Error('Unknown outcome'); }
          return execute({ kind: 'patch', c, id, row: Object.fromEntries(changes.filter(change => !change.remove).map(change => [change.field, change.value])) }, apply);
        } };
      return patch;
    },
    remove: async (c, id, options) => execute({ kind: 'remove', c, id }, () => {
      const row = rows.get(key(c, id));
      if (!matching(row, options.condition)) throw Error('WDE0193: Remove condition not met.');
      rows.delete(key(c, id)); return copy(row);
    })
  };
  const store = createSdkConditionalStore({ items, company: 'NCT',
    collections: ['NCTActivity', 'StockPositions', 'StockClaims', 'StockProducts'] });
  return { store, rows, delayed, items, delay: predicate => { fault = predicate; }, inject: value => { transportFault = value; } };
}
test('SDK adapter maps internal version, strips only system metadata and preserves user payload', async () => {
  const f = fixture();
  await f.store.insert('StockPositions', { _id: 'A', company: 'NCT', _version: 'V0', quantity: 20, obsolete: true });
  assert.deepEqual(await f.store.read('StockPositions', 'A'), { _id: 'A', company: 'NCT', quantity: 20, obsolete: true, _version: 'V0' });
  await f.store.compareAndSet('StockPositions', 'A', 'V0', { _id: 'A', company: 'NCT', _version: 'V1', quantity: 19 });
  assert.equal((await f.store.read('StockPositions', 'A')).obsolete, undefined);
  assert.equal(f.rows.get('StockPositions/A').stockCommitVersion, 'V1');
  await assert.rejects(f.store.compareAndSet('StockPositions', 'A', 'V0', { _id: 'A', company: 'NCT', _version: 'OLD', quantity: 999 }), /version conflict/);
});
test('SDK adapter rejects cross-company records, unlisted collections and same-version writes', async () => {
  const f = fixture();
  await assert.rejects(f.store.insert('NCTOrders', { _id: 'A', company: 'NCT' }), /scope/);
  await assert.rejects(f.store.insert('StockPositions', { _id: 'A', company: 'GHR' }), /owned storage/);
  await assert.rejects(f.store.compareAndSet('StockPositions', 'A', 'V0', { _id: 'A', company: 'NCT', _version: 'V0' }), /Fresh conditional/);
  f.rows.set('StockPositions/A', { _id: 'A', company: 'GHR' });
  await assert.rejects(f.store.read('StockPositions', 'A'), /company conflict/);
});
test('protocol plus SDK adapter fences a late old physical write after generation2', async () => {
  const f = fixture(), p = createFencedProof({ store: f.store }); await p.initialize();
  await f.store.insert('StockPositions', { _id: 'S', company: 'NCT', _version: 'V0', quantity: 20 });
  const request = n => ({ requestId: uuid(n), memberId: 'STAFF', input: { amount: 10 }, prepare: async () => {
    const before = await f.store.read('StockPositions', 'S');
    return { writes: [{ collection: 'StockPositions', before, after: { ...before, quantity: before.quantity - 10 } }] };
  } });
  f.delay(c => c === 'StockPositions');
  await assert.rejects(p.commit(request(1)), /Unknown outcome/);
  await p.commit(request(1)); await p.commit(request(2));
  assert.throws(f.delayed[0], /WDE0193/);
  assert.equal((await f.store.read('StockPositions', 'S')).quantity, 0);
  assert.equal((await p.readControl()).generation, 2);
});
test('SDK lock removal checks execution identity and does not delete another attempt', async () => {
  const f = fixture(); await f.store.insert('NCTActivity', { _id: 'LOCK', company: 'NCT', attempt: 'NEW' });
  await assert.rejects(f.store.compareAndRemove('NCTActivity', 'LOCK', 'OLD'), /WDE0193/);
  assert.equal((await f.store.read('NCTActivity', 'LOCK')).attempt, 'NEW');
  await f.store.compareAndRemove('NCTActivity', 'LOCK', 'NEW');
  assert.equal(await f.store.read('NCTActivity', 'LOCK'), null);
});
test('server JSON field ordering does not cause false image conflicts', async () => {
  const f = fixture();
  const store = { ...f.store, read: async (c, id) => {
    const row = await f.store.read(c, id);
    return row && Object.fromEntries(Object.entries(row).reverse());
  } };
  const p = createFencedProof({ store }); await p.initialize();
  await store.insert('StockPositions', { _id: 'S', company: 'NCT', _version: 'V0', quantity: 20 });
  await p.commit({ requestId: uuid(1), memberId: 'STAFF', input: {}, prepare: async () => {
    const before = await store.read('StockPositions', 'S');
    return { writes: [{ collection: 'StockPositions', before,
      after: { ...before, quantity: 19, extra: { z: 1, a: 2 } } }] };
  } });
  assert.equal((await store.read('StockPositions', 'S')).quantity, 19);
});

async function saveFixture() {
  const f = fixture(), p = createFencedProof({ store: f.store });
  await p.initialize();
  await f.store.insert('StockPositions', { _id: 'S', company: 'NCT', _version: 'S0', onHand: 20, reserved: 0 });
  await f.store.insert('StockProducts', { _id: 'P', company: 'NCT', _version: 'P0', onHand: 20, reserved: 0, available: 20 });
  let prepared = 0;
  const request = n => ({ requestId: uuid(n), memberId: 'STAFF', input: { amount: 10 }, prepare: async () => {
    prepared++;
    const source = await f.store.read('StockPositions', 'S'), product = await f.store.read('StockProducts', 'P');
    assert.ok(product.available >= 10);
    return { writes: [
      { collection: 'NCTActivity', before: null, after: { _id: 'DOMAIN-' + n, company: 'NCT', quantity: 10 } },
      { collection: 'StockPositions', before: source, after: { ...source, reserved: source.reserved + 10 } },
      { collection: 'StockClaims', before: null, after: { _id: 'CLAIM-' + n, company: 'NCT', reserved: 10 } },
      { collection: 'StockProducts', before: product, after: { ...product, reserved: product.reserved + 10, available: product.available - 10 } }
    ] };
  }, validate: async () => {
    const source = await f.store.read('StockPositions', 'S'), product = await f.store.read('StockProducts', 'P');
    assert.equal(source.reserved, product.reserved);
    assert.equal(product.onHand, product.available + product.reserved);
  } });
  return { ...f, p, request, prepared: () => prepared };
}

const sdkBoundaries = [
  ['prepared', e => Boolean(e.row?.plan)],
  ['pending', e => Boolean(e.row?.pending)],
  ['domain', e => e.id === 'DOMAIN-1'],
  ['source', e => e.c === 'StockPositions'],
  ['claim', e => e.c === 'StockClaims'],
  ['summary', e => e.c === 'StockProducts'],
  ['result', e => Boolean(e.row?.outcome)],
  ['finalize', e => e.kind === 'patch' && e.row?.generation === 1 && e.row.pending === null]
];
for (const [name, matches] of sdkBoundaries) {
  for (const when of ['before', 'lost', 'delayed']) {
    test(`SDK full save ${name}/${when} recovers without double allocation`, async () => {
      const f = await saveFixture(); f.inject({ matches, when });
      if (when === 'lost') await f.p.commit(f.request(1));
      else await assert.rejects(f.p.commit(f.request(1)), /Transport/);
      if ((await f.p.readControl()).pending) {
        await assert.rejects(f.p.readSnapshot(() => f.store.read('StockProducts', 'P')), /pending/);
        await assert.rejects(f.p.commit(f.request(2)), /pending/);
      }
      const result = await f.p.commit(f.request(1));
      assert.equal(result.generation, 1);
      assert.equal((await f.store.read('StockProducts', 'P')).available, 10);
      const prepareCount = f.prepared();
      assert.deepEqual(await f.p.commit(f.request(1)), result);
      assert.equal(f.prepared(), prepareCount, 'completed retry must reuse receipt, not prepare again');
      await f.p.commit(f.request(2));
      if (when === 'delayed') {
        assert.equal(f.delayed.length, 1);
        assert.throws(f.delayed[0], /WDE0193|Duplicate/);
      }
      const snapshot = await f.p.readSnapshot(() => f.store.read('StockProducts', 'P'));
      assert.equal(snapshot.generation, 2);
      assert.equal(snapshot.rows.available, 0);
      assert.equal((await f.store.read('StockPositions', 'S')).reserved, 20);
    });
  }
}

test('SDK lost lock acquisition stays blocked; lost release replays committed result', async () => {
  for (const kind of ['insert', 'remove']) {
    const f = await saveFixture();
    f.inject({ matches: e => e.kind === kind && e.id === f.p.ids.lockId, when: 'lost' });
    await assert.rejects(f.p.commit(f.request(1)), /Transport lost reply/);
    if (kind === 'insert') {
      await assert.rejects(f.p.commit(f.request(1)), /Duplicate/);
      assert.equal((await f.p.readControl()).generation, 0);
      assert.equal((await f.store.read('StockProducts', 'P')).available, 20);
    } else {
      assert.equal((await f.p.commit(f.request(1))).generation, 1);
      assert.equal((await f.store.read('StockProducts', 'P')).available, 10);
    }
  }
});
