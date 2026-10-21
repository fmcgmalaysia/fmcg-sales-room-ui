const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { createIsolatedProtocolStore } = require('../prototypes/stock-current-state/isolated-protocol-store.cjs');
const root = path.join(__dirname, '../prototypes/stock-current-state');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const compact = s => s.replace(/\s/g, '');

function fixture() {
  const rows = new Map(), removals = [], copy = row => JSON.parse(JSON.stringify(row));
  const conditionMatches = (row, condition) => Object.entries(condition).every(([field, value]) => row?.[field] === value.$eq);
  const check = collection => assert.equal(collection, 'StockProtocolTest');
  const items = {
    query: collection => {
      check(collection); let id;
      const q = { eq: (field, value) => { assert.equal(field, '_id'); id = value; return q; },
        limit: n => { assert.equal(n, 2); return q; }, find: async options => {
          assert.equal(options.consistentRead, true);
          return { items: rows.has(id) ? [copy(rows.get(id))] : [] };
        } }; return q;
    },
    insert: async (collection, row) => {
      check(collection); if (rows.has(row._id)) throw Error('Duplicate');
      rows.set(row._id, { ...copy(row), _createdDate: 'SYSTEM' }); return copy(rows.get(row._id));
    },
    patch: (collection, id) => {
      check(collection); const changes = [];
      const p = { setField: (key, value) => { changes.push({ key, value }); return p; },
        removeField: key => { changes.push({ key, remove: true }); return p; },
        run: async options => {
          const row = rows.get(id); if (!conditionMatches(row, options.condition)) throw Error('Conditional mismatch');
          const next = copy(row);
          for (const change of changes) { if (change.remove) delete next[change.key]; else next[change.key] = copy(change.value); }
          rows.set(id, next); return copy(next);
        } }; return p;
    },
    remove: async (collection, id, options) => {
      check(collection); const row = rows.get(id);
      if (!conditionMatches(row, options.condition)) throw Error('Conditional mismatch');
      removals.push({ id, attempt: options.condition.attempt.$eq }); rows.delete(id); return copy(row);
    }
  };
  let source = read('stockProtocolCommitTest.web.js').replace(/^import .+;\r?\n/gm, '').replace(/export const /g, 'const ');
  source += '\n({ interruptStockProtocolProbe, resumeStockProtocolProbe, replayStockProtocolProbe });';
  const probes = vm.runInNewContext(source, { items, webMethod: (permission, fn) => { assert.equal(permission, 'ADMIN'); return fn; },
    Permissions: { Admin: 'ADMIN' }, createHash: crypto.createHash, randomBytes: crypto.randomBytes, Buffer });
  return { rows, removals, probes };
}

test('three-stage live harness interrupts/resumes/replays with exactly three scoped lock releases', async () => {
  const f = fixture();
  const first = await f.probes.interruptStockProtocolProbe();
  assert.equal(first.passed, true); assert.equal(first.control.generation, 0); assert.equal(first.blockedRead, true);
  assert.equal(f.removals.length, 1);
  const second = await f.probes.resumeStockProtocolProbe();
  assert.equal(second.passed, true); assert.equal(second.snapshot.generation, 1);
  const third = await f.probes.replayStockProtocolProbe();
  assert.equal(third.passed, true); assert.equal(third.control.generation, 1);
  assert.equal(second.outcome.operationId, third.outcome.operationId);
  assert.equal(f.removals.length, 3);
  assert.equal(new Set(f.removals.map(row => row.attempt)).size, 3);
  assert.ok(f.removals.every(row => row.id === 'PROTOCOL-70c1b2:NCTActivity:1cbdee1c74664528d2874f12e56c301d'));
  assert.equal(f.rows.size, 7); assert.ok([...f.rows.keys()].every(id => id.startsWith('PROTOCOL-70c1b2:')));
  await assert.rejects(f.probes.interruptStockProtocolProbe(), /already initialized/);
  await assert.rejects(f.probes.resumeStockProtocolProbe(), /Expected interrupted/);
  assert.equal(f.removals.length, 3, 'stage guards prevent unintended new lock mutations');
});

test('isolation mapper rejects foreign logical collections and cannot alias physical IDs', async () => {
  const calls = [], store = { read: async (collection, id) => { calls.push({ collection, id }); return { _id: id, company: 'NCT' }; } };
  const isolated = createIsolatedProtocolStore({ store, namespace: 'PROTOCOL-70c1b2' });
  assert.equal((await isolated.read('StockPositions', 'A'))._id, 'A');
  await isolated.read('StockClaims', 'A');
  assert.notEqual(calls[0].id, calls[1].id);
  await assert.rejects(isolated.read('NCTOrders', 'A'), /isolated address/);
  assert.throws(() => createIsolatedProtocolStore({ store, namespace: 'BUSINESS' }), /Fixed isolated/);
  assert.ok(calls.every(row => row.collection === 'StockProtocolTest'));
});

test('generated live proof embeds unchanged algorithm, adapter and isolation mapper', () => {
  const bundle = read('stockProtocolCommitTest.web.js');
  const definitions = [
    ['stockAdapterFactory', 'sdk-conditional-store.cjs', 'createSdkConditionalStore'],
    ['isolatedStoreFactory', 'isolated-protocol-store.cjs', 'createIsolatedProtocolStore'],
    ['stockProtocolFactory', 'fenced-proof.cjs', 'createFencedProof']
  ];
  for (const [factory, file, exported] of definitions) {
    const actual = bundle.split('const ' + factory + ' = (() => {')[1].split('return ' + exported + ';')[0];
    const expected = read(file).replace(/^'use strict';\r?\n/, '')
      .replace(new RegExp('module\\.exports = \\{ ' + exported + ' \\};\\s*$'), '')
      .replace("const { randomUUID } = require('node:crypto');", '')
      .replace("const { hash } = require('./commit-proof.cjs');", '');
    assert.equal(compact(actual), compact(expected));
  }
  assert.equal((bundle.match(/webMethod\(Permissions\.Admin/g) || []).length, 3);
  assert.ok(compact(bundle).includes(compact(read('protocol-live-harness.txt'))));
});
