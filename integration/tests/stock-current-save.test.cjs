const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { createCurrentStockSave } = require('../prototypes/stock-current-state/current-stock-save.cjs');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { WRITERS } = require('../prototypes/stock-current-state/stock-admission.cjs');
const { requireWarehouseStaff } = load('warehouseReceiving.js');
const copy = x => JSON.parse(JSON.stringify(x));
async function fixture() {
  const rows = new Map(); let member = { _id: 'M', status: 'APPROVED', loginEmail: 'w@example.test' }, preparations = 0, authentications = 0, fail = false;
  const employee = { title: 'W', description: 'M', staffEmail: member.loginEmail, staffName: 'LAW', staffStatus: 'ACTIVE', departments: ['WAREHOUSE'] };
  const store = {
    read: async (c, id) => copy(rows.get(c + ':' + id) || null),
    insert: async (c, row) => { if (fail && c === 'StockProducts') { fail = false; throw Error('Interrupted'); }
      const key = c + ':' + row._id; if (rows.has(key)) throw Error('Duplicate'); rows.set(key, copy(row)); return copy(row); },
    compareAndSet: async (c, id, version, row) => { const key = c + ':' + id; if (rows.get(key)?._version !== version) throw Error('CAS conflict'); rows.set(key, copy(row)); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { const key = c + ':' + id; if (rows.get(key)?.attempt !== attempt) throw Error('Wrong attempt'); rows.delete(key); }
  };
  const protocol = createFencedProof({ store }); await protocol.initialize();
  const control = () => rows.get(protocol.ids.journal + ':' + protocol.ids.controlId);
  Object.assign(control(), { mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'BUILD' });
  const coverage = Object.fromEntries(WRITERS.map(writer => [writer, { verified: true, build: 'BUILD' }]));
  const deps = { company: 'NCT', writer: 'RECEIPT', protocol, coverage,
    authenticate: async company => { authentications++; assert.equal(company, 'NCT'); const staff = requireWarehouseStaff(member, [employee]); return { ...staff, memberId: member._id }; },
    prepare: async command => { preparations++; assert.equal(command.memberId, 'M'); assert.equal(command.company, 'NCT');
      return { memberId: 'M', generation: control().generation, plan: { writes: [{ collection: 'StockProducts', before: null,
        after: { _id: 'P', company: 'NCT', onHand: command.input.accepted } }] } }; }
  };
  const request = { requestId: '11111111-1111-4111-8111-111111111111', stockProtocol: 1, stockBuild: 'BUILD', stockGeneration: 0, input: { accepted: 20 } };
  return { deps, protocol, rows, control, request, counts: () => ({ preparations, authentications }),
    revoke: () => { member = { ...member, status: 'PENDING' }; }, interrupt: () => { fail = true; } };
}
test('every replay uses original department permission, once-only plan and public-safe receipt', async () => {
  const f = await fixture(), save = createCurrentStockSave(f.deps);
  const first = await save(f.request), again = await save(f.request); assert.deepEqual(first, again);
  assert.deepEqual(Object.keys(first).sort(), ['ok', 'requestId', 'stockGeneration']);
  assert.deepEqual(f.counts(), { preparations: 1, authentications: 2 }); assert.equal(f.control().generation, 1);
  f.revoke(); await assert.rejects(save(f.request), /approved|authorized/i); assert.equal(f.counts().preparations, 1);
});

test('segmented save exposes bounded progress, keeps original envelope and prepares only once', async () => {
  const f = await fixture();
  f.deps.protocol = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs').createSegmentedFencedProof({
    store: f.protocol.store || { read: async (c, id) => copy(f.rows.get(c + ':' + id) || null),
      insert: async (c, row) => { const id = c + ':' + row._id; if (f.rows.has(id)) throw Error('Duplicate'); f.rows.set(id, copy(row)); },
      compareAndSet: async (c, id, version, row) => { if (f.rows.get(c + ':' + id)?._version !== version) throw Error('Conflict'); f.rows.set(c + ':' + id, copy(row)); },
      compareAndRemove: async (c, id, attempt) => { if (f.rows.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong attempt'); f.rows.delete(c + ':' + id); } },
    stepsPerInvocation: 1 });
  const save = createCurrentStockSave(f.deps);
  const results = [];
  for (let i = 0; i < 5; i++) { const result = await save(f.request); results.push(result); if (result.ok) break; }
  assert.equal(results.at(-1).stockGeneration, 1); assert.equal(results.at(-1).ok, true);
  assert.deepEqual(results.filter(r => r.pending).map(r => r.phase), ['BEFORE', 'APPLY', 'VERIFY']);
  assert.equal(f.counts().preparations, 1); assert.equal(f.control().pending, null);
  assert.equal(JSON.stringify(results).includes('operationId'), false);
});
test('exact interrupted request resumes under owned fence despite pending; no second preparation', async () => {
  const f = await fixture(), save = createCurrentStockSave(f.deps); f.interrupt();
  await assert.rejects(save(f.request), /Interrupted/); assert.ok(f.control().pending);
  assert.equal(f.rows.has(f.protocol.ids.journal + ':' + f.protocol.ids.lockId), false);
  await save(f.request); assert.equal(f.control().pending, null); assert.equal(f.control().generation, 1);
  assert.deepEqual(f.counts(), { preparations: 1, authentications: 2 }); assert.equal(f.rows.get('StockProducts:P').onHand, 20);
});
test('browser resume/coverage flags cannot admit a missing writer, stale form or foreign request', async () => {
  const f = await fixture(), save = createCurrentStockSave(f.deps); delete f.deps.coverage.PACKING;
  await assert.rejects(save({ ...f.request, resume: true, allWritersReady: true, coverage: { PACKING: true } }), /coverage incomplete/);
  assert.equal(f.counts().preparations, 0); assert.equal(f.rows.has('StockProducts:P'), false);
  f.deps.coverage.PACKING = { verified: true, build: 'BUILD' }; f.control().generation = 2;
  await assert.rejects(save(f.request), /refresh/); assert.equal(f.counts().preparations, 0);
});
test('pending replay is still denied after mode/build change and a different request cannot steal it', async () => {
  const f = await fixture(), save = createCurrentStockSave(f.deps); f.interrupt(); await assert.rejects(save(f.request), /Interrupted/);
  f.control().mode = 'MAINTENANCE'; await assert.rejects(save(f.request), /maintenance/);
  f.control().mode = 'ACTIVE'; f.control().writerBuild = 'NEW'; await assert.rejects(save(f.request), /coverage incomplete/);
  f.control().writerBuild = 'BUILD';
  await assert.rejects(save({ ...f.request, requestId: '22222222-1111-4111-8111-111111111111' }), /pending/);
  await assert.rejects(save({ ...f.request, input: { accepted: 21 } }), /pending|identity reused/);
  await save(f.request); assert.equal(f.control().generation, 1);
});
test('replay admission runs inside fence, not a stale pre-lock mode read', async () => {
  const f = await fixture(), old = f.deps.authenticate;
  f.deps.authenticate = async company => { const actor = await old(company); f.control().mode = 'MAINTENANCE'; return actor; };
  await assert.rejects(createCurrentStockSave(f.deps)(f.request), /maintenance/); assert.equal(f.counts().preparations, 0);
  assert.equal(f.rows.has(f.protocol.ids.journal + ':' + f.protocol.ids.lockId), false);
});
test('default empty coverage and mismatched prepared actor/generation refuse without business writes', async () => {
  for (const mismatch of ['coverage', 'member', 'generation']) {
    const f = await fixture();
    if (mismatch === 'coverage') delete f.deps.coverage;
    else { const prepare = f.deps.prepare; f.deps.prepare = async input => ({ ...await prepare(input), ...(mismatch === 'member' ? { memberId: 'OTHER' } : { generation: 99 }) }); }
    await assert.rejects(createCurrentStockSave(f.deps)(f.request), /coverage incomplete|authority\/generation/);
    assert.equal(f.rows.has('StockProducts:P'), false); assert.equal(f.control().pending, null);
  }
});
test('server request digest binds writer/client metadata as well as business input', async () => {
  const f = await fixture(), save = createCurrentStockSave(f.deps); await save(f.request);
  await assert.rejects(save({ ...f.request, stockGeneration: 1 }), /identity reused/);
  await assert.rejects(save({ ...f.request, stockBuild: 'NEW' }), /identity reused/);
  await assert.rejects(save({ ...f.request, input: { accepted: 21 } }), /identity reused/);
  f.control().generation = 10; assert.equal((await save(f.request)).stockGeneration, 1);
});
test('corrupted result identity, quantity generation or company is never returned as confirmed', async () => {
  for (const corruption of ['identity', 'generation', 'company', 'control']) {
    const f = await fixture(), save = createCurrentStockSave(f.deps); await save(f.request);
    const result = [...f.rows.values()].find(row => row.outcome);
    if (corruption === 'identity') result.outcome.operationId = 'FORGED';
    if (corruption === 'generation') result.outcome.generation = 100;
    if (corruption === 'company') result.company = 'GHR';
    if (corruption === 'control') f.control().generation = 0;
    await assert.rejects(save(f.request), /result requires review|scope conflict/);
  }
});
