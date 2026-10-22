const test = require('node:test'), assert = require('node:assert/strict');
const { createFencedProof } = require('../prototypes/stock-current-state/fenced-proof.cjs');
const { inspectStockRecovery } = require('../prototypes/stock-current-state/recovery-inspector.cjs');
const { hash } = require('../prototypes/stock-current-state/commit-proof.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
async function fixture() {
  const db = new Map(); let failure = false, writes = 0;
  const store = { read: async (c, id) => copy(db.get(c + ':' + id) || null),
    insert: async (c, row) => { writes++; if (failure && c === 'StockPositions' && row._id === 'B') { failure = false; throw Error('Interrupted B'); }
      if (db.has(c + ':' + row._id)) throw Error('Duplicate'); db.set(c + ':' + row._id, copy(row)); return copy(row); },
    compareAndSet: async (c, id, v, row) => { writes++; if (db.get(c + ':' + id)?._version !== v) throw Error('CAS conflict'); db.set(c + ':' + id, copy(row)); return copy(row); },
    compareAndRemove: async (c, id, attempt) => { writes++; if (db.get(c + ':' + id)?.attempt !== attempt) throw Error('Wrong attempt'); db.delete(c + ':' + id); } };
  const protocol = createFencedProof({ store }); await protocol.initialize();
  const identity = { company: 'NCT', memberId: 'M', requestId: '11111111-1111-4111-8111-111111111111', input: { example: 1 } };
  const command = { ...identity, prepare: async () => ({ writes: ['A', 'B'].map(id => ({ collection: 'StockPositions', before: null, after: { _id: id, company: 'NCT', onHand: 1 } })) }) };
  const inspect = async () => { const before = writes; const packet = await inspectStockRecovery({ store, ...identity }); assert.equal(writes, before); return packet; };
  return { db, store, protocol, identity, command, inspect, fail: () => { failure = true; } };
}
test('no receipt is unknown, not a confirmed failed save or zero stock', async () => {
  const f = await fixture(), packet = await f.inspect();
  assert.equal(packet.status, 'NO_RECEIPT_NOT_CONFIRMED'); assert.deepEqual(packet.images, []);
  assert.equal(Object.hasOwn(packet, 'input'), false); assert.equal(Object.hasOwn(packet, 'plan'), false);
});
test('existing lock remains blocked regardless of age, matching owner or current images', async () => {
  const f = await fixture(), id = f.protocol.ids.lockId, owner = hash('NCT/PURCHASE', f.identity.requestId, 'M');
  const lock = { _id: id, company: 'NCT', owner, attempt: 'EXACT-ATTEMPT', createdAt: '2000-01-01' };
  f.db.set('NCTActivity:' + id, lock);
  assert.equal((await f.inspect()).status, 'LOCK_PRESENT_STAY_BLOCKED'); assert.deepEqual(f.db.get('NCTActivity:' + id), lock);
});
test('mixed before/after interrupted plan is diagnosed read-only then existing protocol resumes once', async () => {
  const f = await fixture(); f.fail(); await assert.rejects(f.protocol.commit(f.command), /Interrupted/);
  const packet = await f.inspect(); assert.equal(packet.status, 'SAME_REQUEST_RESUME_PREPARED');
  assert.deepEqual(packet.images.map(i => i.image), ['AFTER', 'BEFORE']);
  await f.protocol.commit(f.command); await f.protocol.commit(f.command);
  assert.equal((await f.inspect()).status, 'CONFIRMED_RESULT'); assert.equal((await f.protocol.readControl()).generation, 1);
});
test('different payload, corrupt image, missing barrier or missing prepared receipt demand review', async () => {
  const f = await fixture(); f.fail(); await assert.rejects(f.protocol.commit(f.command));
  assert.equal((await inspectStockRecovery({ store: f.store, ...f.identity, input: { different: true } })).status, 'REVIEW_REQUEST_IDENTITY_CONFLICT');
  const old = copy(f.db.get('StockPositions:A')); f.db.get('StockPositions:A').onHand = 999;
  assert.equal((await f.inspect()).status, 'REVIEW_IMAGE_CONFLICT'); f.db.set('StockPositions:A', old);
  const cid = 'NCTActivity:' + f.protocol.ids.controlId, control = copy(f.db.get(cid)); f.db.get(cid).pending = null;
  assert.equal((await f.inspect()).status, 'REVIEW_MISSING_BARRIER'); f.db.set(cid, control);
  f.db.delete('NCTActivity:' + hash('NCT/PURCHASE', f.identity.requestId, 'M'));
  assert.equal((await f.inspect()).status, 'REVIEW_MISSING_PREPARED_PLAN');
});
test('confirmed result with pending publication only needs same-request finalization', async () => {
  const f = await fixture(); await f.protocol.commit(f.command);
  const key = hash('NCT/PURCHASE', f.identity.requestId, 'M'), cid = 'NCTActivity:' + f.protocol.ids.controlId;
  const control = f.db.get(cid); control.generation = 0; control.pending = { key, digest: hash(f.identity.input) };
  assert.equal((await f.inspect()).status, 'SAME_REQUEST_FINALIZE_RESULT');
  await f.protocol.commit(f.command); assert.equal((await f.inspect()).status, 'CONFIRMED_RESULT');
});
test('later valid operations do not turn old confirmed result into a false image conflict', async () => {
  const f = await fixture(); await f.protocol.commit(f.command);
  const before = await f.store.read('StockPositions', 'A');
  await f.protocol.commit({ requestId: '22222222-2222-4222-8222-222222222222', memberId: 'M', input: { next: 2 },
    prepare: async () => ({ writes: [{ collection: 'StockPositions', before, after: { ...before, onHand: 2 } }] }) });
  const packet = await f.inspect(); assert.equal(packet.status, 'CONFIRMED_RESULT');
  assert.ok(packet.images.every(i => i.image === 'LATER_GENERATION_NOT_RECHECKED'));
});
test('changed guard during inspection and read errors never become safe-to-recover instructions', async () => {
  const f = await fixture(); let reads = 0;
  const store = { read: async (c, id) => { const row = await f.store.read(c, id); if (id === f.protocol.ids.controlId && ++reads === 2) row._version = 'CHANGED'; return row; } };
  assert.equal((await inspectStockRecovery({ store, ...f.identity })).status, 'CHANGED_RECHECK_LATER');
  await assert.rejects(inspectStockRecovery({ ...f.identity, store: { read: async () => { throw Error('Network unknown'); } } }), /Network unknown/);
});
test('prepared plan may not touch control/lock or foreign collections during recovery inspection', async () => {
  const f = await fixture(); f.fail(); await assert.rejects(f.protocol.commit(f.command));
  const prepared = f.db.get('NCTActivity:' + hash('NCT/PURCHASE', f.identity.requestId, 'M'));
  const token = prepared.plan.writes[0].after._version; prepared.plan.writes[0].after._version = 'FORGED';
  assert.equal((await f.inspect()).status, 'REVIEW_INVALID_PREPARED_PLAN'); prepared.plan.writes[0].after._version = token;
  prepared.plan.writes[0].collection = 'Staff';
  assert.equal((await f.inspect()).status, 'REVIEW_INVALID_PREPARED_PLAN');
});

test('v1 completed receipt cannot hide an exact BEFORE image or missing retained plan',async()=>{
  for(const kind of ['before','missing']){
    const f=await fixture();await f.protocol.commit(f.command);
    if(kind==='before')f.db.delete('StockPositions:A');
    else f.db.delete('NCTActivity:'+hash('NCT/PURCHASE',f.identity.requestId,'M'));
    const before=JSON.stringify([...f.db]),report=await f.inspect();
    assert.equal(report.status,kind==='before'?'REVIEW_RESULT_IMAGES':'REVIEW_INVALID_RESULT');
    assert.equal(report.currentImagesVerified,false);assert.equal(JSON.stringify([...f.db]),before);
  }
});
