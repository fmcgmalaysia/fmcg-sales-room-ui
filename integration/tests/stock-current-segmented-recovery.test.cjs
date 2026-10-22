const test = require('node:test'), assert = require('node:assert/strict');
const { createSegmentedFencedProof } = require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const { inspectStockRecovery } = require('../prototypes/stock-current-state/recovery-inspector.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
async function fixture(count = 3) {
  const rows = new Map(), reads = []; let interrupted = false;
  const store = { read: async (c, id) => { reads.push(c + '/' + id); return copy(rows.get(c + '/' + id) || null); },
    insert: async (c, row) => { const key = c + '/' + row._id; if (rows.has(key)) throw Error('Duplicate'); rows.set(key, copy(row)); },
    compareAndSet: async (c, id, version, row) => { const key = c + '/' + id; if (rows.get(key)?._version !== version) throw Error('Conflict');
      if (interrupted && c === 'StockPositions') { interrupted = false; throw Error('Interrupted'); } rows.set(key, copy(row)); },
    compareAndRemove: async (c, id, attempt) => { const key = c + '/' + id; if (rows.get(key)?.attempt !== attempt) throw Error('Attempt'); rows.delete(key); } };
  const protocol = createSegmentedFencedProof({ store, stepsPerInvocation: 2 }); await protocol.initialize();
  for (let i = 0; i < count; i++) rows.set('StockPositions/S' + i, { _id: 'S' + i, company: 'NCT', _version: 'V0', onHand: 100 });
  const command = { requestId: '11111111-1111-4111-8111-111111111111', memberId: 'M', input: { accepted: 110 }, prepare: async () => ({
    writes: await Promise.all(Array.from({ length: count }, async (_, i) => {
      const before = await store.read('StockPositions', 'S' + i); return { collection: 'StockPositions', before, after: { ...before, onHand: 110 } };
    })) }) };
  const inspect = extra => inspectStockRecovery({ store, company: 'NCT', ...command, ...extra });
  return { store, rows, reads, protocol, command, inspect, interrupt: () => { interrupted = true; } };
}
test('segmented recovery classifies intact pending plan read-only and resumes only original request through protocol', async () => {
  const f = await fixture(); await f.protocol.commit(f.command);
  const before = JSON.stringify([...f.rows]), report = await f.inspect();
  assert.equal(report.status, 'SAME_REQUEST_REVALIDATES_ON_RESUME'); assert.equal(report.completeInspection, true);
  assert.equal(report.recoveryPerformed, false); assert.equal(JSON.stringify([...f.rows]), before);
  for (let i = 0; i < 10; i++) if ((await f.protocol.commit(f.command)).ok) break;
  assert.equal((await f.inspect()).status, 'CONFIRMED_RESULT');
});
test('901record diagnostic pages are not presented as complete recovery proof; cursor binds guard versions', async () => {
  const f = await fixture(901); await f.protocol.commit(f.command); f.reads.length = 0;
  const page = await f.inspect({ pageSize: 25 }); assert.equal(page.status, 'PAGED_INSPECTION_ONLY');
  assert.equal(page.totalRecords, 901); assert.equal(page.images.length, 25); assert.equal(page.completeInspection, false);
  assert.equal(f.reads.filter(id => id.startsWith('StockPositions/')).length, 25);
  const next = await f.inspect({ pageSize: 25, cursor: page.nextCursor }); assert.equal(next.offset, 25);
  await f.protocol.commit(f.command);
  await assert.rejects(f.inspect({ pageSize: 25, cursor: page.nextCursor }), /evidence changed/);
});
test('missing fragment, conflicting current image and unknown lock stay blocked; no delete/force-unlock capability', async () => {
  for (const kind of ['fragment', 'image', 'lock']) {
    const f = await fixture(); await f.protocol.commit(f.command);
    if (kind === 'fragment') { const root = [...f.rows.values()].find(r => r.action === 'STOCK_PLAN_MANIFEST'); f.rows.delete(f.protocol.ids.journal + '/' + root.fragments[0].id); }
    if (kind === 'image') f.rows.get('StockPositions/S0').onHand = 999;
    if (kind === 'lock') await f.store.insert(f.protocol.ids.journal, { _id: f.protocol.ids.lockId, company: 'NCT', owner: 'UNKNOWN', attempt: 'KEEP' });
    const before = JSON.stringify([...f.rows]), report = await f.inspect();
    assert.equal(report.status, kind === 'fragment' ? 'REVIEW_INVALID_SEGMENTED_PLAN' : kind === 'image' ? 'REVIEW_IMAGE_CONFLICT' : 'LOCK_PRESENT_STAY_BLOCKED');
    assert.equal(report.recoveryPerformed, false); assert.equal(JSON.stringify([...f.rows]), before);
  }
});

async function finish(f){
  for(let attempt=0;attempt<200;attempt++)if((await f.protocol.commit(f.command)).ok)return;
  assert.fail('Bounded fixture did not complete');
}
test('a valid RESULT cannot confirm a same-generation row reverted to its exact BEFORE image',async()=>{
  for(const pending of [false,true]){
    const f=await fixture();await finish(f);
    const manifest=[...f.rows.values()].find(row=>row.action==='STOCK_PLAN_MANIFEST');
    f.rows.set('StockPositions/S0',{_id:'S0',company:'NCT',_version:'V0',onHand:100});
    if(pending){const control=f.rows.get(f.protocol.ids.journal+'/'+f.protocol.ids.controlId);control.generation=0;
      control.pending={key:manifest._id,digest:manifest.digest,planHash:manifest.planHash,phase:'FINALIZE',cursor:3,count:3};}
    const before=JSON.stringify([...f.rows]),report=await f.inspect();
    assert.equal(report.images[0].image,'BEFORE');assert.equal(report.status,'REVIEW_RESULT_IMAGES');
    assert.equal(report.currentImagesVerified,false);assert.equal(report.recoveryPerformed,false);
    assert.equal(JSON.stringify([...f.rows]),before);
  }
});
test('completed RESULT on a partial diagnostic page is not whole-operation verification',async()=>{
  const f=await fixture(51);await finish(f);const before=JSON.stringify([...f.rows]);
  const page=await f.inspect({pageSize:25});
  assert.equal(page.status,'PAGED_RESULT_INSPECTION_ONLY');assert.equal(page.receiptVerified,true);
  assert.equal(page.currentImagesVerified,false);assert.equal(page.completeInspection,false);
  const next=await f.inspect({pageSize:25,cursor:page.nextCursor});
  assert.equal(next.status,'PAGED_RESULT_INSPECTION_ONLY');assert.equal(next.currentImagesVerified,false);
  assert.equal(JSON.stringify([...f.rows]),before);
});
test('pending RESULT publication also requires whole-page image verification before recommending original finalization',async()=>{
  const f=await fixture(3);await finish(f);
  const manifest=[...f.rows.values()].find(row=>row.action==='STOCK_PLAN_MANIFEST'),control=f.rows.get(f.protocol.ids.journal+'/'+f.protocol.ids.controlId);
  control.generation=0;control.pending={key:manifest._id,digest:manifest.digest,planHash:manifest.planHash,phase:'FINALIZE',cursor:3,count:3};
  const before=JSON.stringify([...f.rows]),page=await f.inspect({pageSize:1});
  assert.equal(page.status,'PAGED_RESULT_INSPECTION_ONLY');assert.equal(page.currentImagesVerified,false);
  const complete=await f.inspect();assert.equal(complete.status,'SAME_REQUEST_RECHECK_RESULT');
  assert.equal(complete.receiptVerified,true);assert.equal(complete.currentImagesVerified,true);
  assert.equal(JSON.stringify([...f.rows]),before);
});
test('latest whole result images and later-generation receipt-only evidence remain explicitly distinct',async()=>{
  const f=await fixture();await finish(f);
  const current=await f.inspect();assert.equal(current.status,'CONFIRMED_RESULT');
  assert.equal(current.receiptVerified,true);assert.equal(current.currentImagesVerified,true);
  const before=await f.store.read('StockPositions','S0');
  const command={requestId:'22222222-2222-4222-8222-222222222222',memberId:'M',input:{next:1},
    prepare:async()=>({writes:[{collection:'StockPositions',before,after:{...before,onHand:120}}]})};
  for(let i=0;i<20;i++)if((await f.protocol.commit(command)).ok)break;
  const old=await f.inspect();assert.equal(old.status,'CONFIRMED_RESULT');
  assert.equal(old.receiptVerified,true);assert.equal(old.currentImagesVerified,false);
  assert.ok(old.images.every(row=>row.image==='LATER_GENERATION_NOT_RECHECKED'));
});
