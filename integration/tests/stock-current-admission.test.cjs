const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { PURCHASE_COLLECTIONS } = load('purchaseProjection.js');
const { domainCollections, planCollections } = require('../prototypes/stock-current-state/domain-scope.cjs');
const { WRITERS, createStockAdmission } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { inspectStockRecovery } = require('../prototypes/stock-current-state/recovery-inspector.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
test('optional domain scope matches original companies and excludes staff/suppliers/foreign tables', () => {
  for (const company of ['NCT', 'GHR']) {
    assert.deepEqual(domainCollections(company).slice(0, 2), [PURCHASE_COLLECTIONS[company].orders, PURCHASE_COLLECTIONS[company].tasks]);
    assert.equal(planCollections(company).includes(PURCHASE_COLLECTIONS[company].tasks), false);
    assert.equal(planCollections(company, true).includes(PURCHASE_COLLECTIONS[company].tasks), true);
    assert.equal(planCollections(company, true).includes(PURCHASE_COLLECTIONS[company === 'NCT' ? 'GHR' : 'NCT'].tasks), false);
  }
  assert.throws(() => planCollections('NCT', 'true'), /server plan scope/);
});
test('LEGACY stays explicit; unknown/missing modes and failures cannot silently downgrade', async () => {
  const control = { company: 'NCT', _version: 'V', generation: 0, schemaVersion: 1, mode: 'LEGACY' };
  const admission = createStockAdmission({ company: 'NCT', readControl: async () => control });
  assert.equal((await admission({ writer: 'RECEIPT' })).route, 'LEGACY');
  control.mode = 'UNKNOWN'; await assert.rejects(admission({ writer: 'RECEIPT' }), /no automatic fallback/);
  await assert.rejects(createStockAdmission({ company: 'NCT', readControl: async () => { throw Error('Network unknown'); } })({ writer: 'RECEIPT' }), /Network unknown/);
});
test('one missing writer or wrong build blocks SHADOW and ACTIVE despite browser flags', async () => {
  for (const mode of ['SHADOW', 'ACTIVE']) {
    const control = { company: 'NCT', _version: 'V', generation: 2, schemaVersion: 1, mode, writerBuild: 'BUILD' };
    const coverage = Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'BUILD' }]));
    const admission = createStockAdmission({ company: 'NCT', readControl: async () => control, coverage });
    const request = { stockProtocol: 1, stockGeneration: 2, stockBuild: 'BUILD', mode: 'LEGACY', allWritersReady: true };
    assert.equal((await admission({ writer: 'RECEIPT', request })).route, mode === 'ACTIVE' ? 'FENCED_CURRENT' : 'FENCED_SHADOW');
    coverage.ORDER_UPDATE = { verified: false, build: 'BUILD' }; await assert.rejects(admission({ writer: 'RECEIPT', request }), /coverage incomplete/);
  }
});
test('pending, maintenance, cached old client and stale generation cannot mutate stock', async () => {
  const control = { company: 'NCT', _version: 'V', generation: 2, schemaVersion: 1, mode: 'ACTIVE', writerBuild: 'BUILD' };
  const coverage = Object.fromEntries(WRITERS.map(name => [name, { verified: true, build: 'BUILD' }]));
  const admission = createStockAdmission({ company: 'NCT', readControl: async () => control, coverage });
  await assert.rejects(admission({ writer: 'RECEIPT', request: {} }), /refresh/);
  await assert.rejects(admission({ writer: 'RECEIPT', request: { stockProtocol: 1, stockGeneration: 1, stockBuild: 'BUILD' } }), /refresh/);
  control.pending = { key: 'OTHER' }; await assert.rejects(admission({ writer: 'RECEIPT' }), /pending/);
  control.pending = null; control.mode = 'MAINTENANCE'; await assert.rejects(admission({ writer: 'RECEIPT' }), /maintenance/);
  await assert.rejects(admission({ writer: 'UNREGISTERED' }), /Unknown inventory writer/);
});

test('reference-price whole-row task/order writer cannot be omitted just because stock quantities do not change', async () => {
  assert.equal(WRITERS.includes('COST_REFERENCE'), true);
  const control = { company: 'NCT', _version: 'V', generation: 0, schemaVersion: 1, mode: 'ACTIVE', writerBuild: 'BUILD' };
  const coverage = Object.fromEntries(WRITERS.filter(name => name !== 'COST_REFERENCE').map(name => [name, { verified: true, build: 'BUILD' }]));
  const admit = createStockAdmission({ company: 'NCT', readControl: async () => control, coverage });
  await assert.rejects(admit({ writer: 'RECEIPT', request: { stockProtocol: 1, stockGeneration: 0, stockBuild: 'BUILD' } }), /coverage incomplete/);
});

test('shared GP/order/finance/batch decision writers require explicit coverage rather than an unrelated writer flag', async () => {
  const required = ['BORROWING', 'MARGIN_REFERENCE', 'SHIPMENT_PLAN', 'QUANTITY_CASE', 'PURCHASE_ORDER_RECORD', 'ACCOUNT_PURCHASE_RECORD'];
  for (const name of required) {
    assert.equal(WRITERS.includes(name), true);
    const control = { company: 'NCT', _version: 'V', generation: 0, schemaVersion: 1, mode: 'ACTIVE', writerBuild: 'BUILD' };
    const coverage = Object.fromEntries(WRITERS.filter(writer => writer !== name).map(writer => [writer, { verified: true, build: 'BUILD' }]));
    await assert.rejects(createStockAdmission({ company: 'NCT', readControl: async () => control, coverage })({ writer: 'RECEIPT',
      request: { stockProtocol: 1, stockGeneration: 0, stockBuild: 'BUILD' } }), /coverage incomplete/);
  }
});
test('opted-in company task + inventory changes commit/replay together; recovery sees same private scope', async () => {
  const db = new Map(), before = { _id: 'TASK', company: 'NCT', _version: 'T0', quantity: 10 }; db.set('NCTTasks:TASK', before);
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null), insert: async (c, r) => { if (db.has(c + ':' + r._id)) throw Error('Duplicate'); db.set(c + ':' + r._id, copy(r)); return copy(r); },
    compareAndSet: async (c, id, v, r) => { if (db.get(c + ':' + id)?._version !== v) throw Error('CAS conflict'); db.set(c + ':' + id, copy(r)); return copy(r); },
    compareAndRemove: async (c, id, a) => { if (db.get(c + ':' + id)?.attempt !== a) throw Error('Wrong attempt'); db.delete(c + ':' + id); } };
  const protocol = createFencedProof({ store, domainWrites: true }); await protocol.initialize();
  const identity = { company: 'NCT', memberId: 'M', requestId: '11111111-1111-4111-8111-111111111111', input: { quantity: 20 } };
  const request = { ...identity, prepare: async () => ({ writes: [{ collection: 'NCTTasks', before, after: { ...before, quantity: 20 } },
    { collection: 'StockProducts', before: null, after: { _id: 'PRODUCT', company: 'NCT', onHand: 0 } }] }) };
  await protocol.commit(request); await protocol.commit(request);
  assert.equal(db.get('NCTTasks:TASK').quantity, 20);
  assert.equal((await inspectStockRecovery({ store, ...identity, domainWrites: true })).status, 'CONFIRMED_RESULT');
  assert.equal((await inspectStockRecovery({ store, ...identity })).status, 'REVIEW_INVALID_PREPARED_PLAN');
  for (const collection of ['NCTTasks1', 'Staff', 'SharedSuppliers']) {
    await assert.rejects(protocol.commit({ ...identity, requestId: '22222222-1111-4111-8111-111111111111', input: { collection },
      prepare: async () => ({ writes: [{ collection, before: null, after: { _id: 'NO', company: 'NCT' } }] }) }), /identity conflict/);
  }
});
