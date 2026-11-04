const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '../prototypes/stock-current-state');
const stockCurrent = { schema: 'CURRENT_STOCK_V2', stockProtocol: 1, stockBuild: 'TEST', stockGeneration: 3 };
test('packing transport is exactly generated from original official-origin parent bridge', () => {
  assert.match(execFileSync(process.execPath, [path.join(root, 'build-packing-transport-candidate.cjs'), '--check'], { encoding: 'utf8' }), /verified/);
  const source = fs.readFileSync(path.join(root, 'packing-transport.current.js'), 'utf8');
  assert.ok(source.includes("if(event.source!==parent||event.origin!==parentOrigin)return;"));
  assert.equal(/localStorage|fetch\(/.test(source), false);assert.equal(source.includes('sessionStorage.key'),false);
});
function fixture(db=new Map(),department='SUPPORT') {
  let receive, serial = 0, company = 'NCT', busy = false;
  const sent = [], timers = new Map(), gets=[],events=[],origin = 'https://fmcg999.wixstudio.com';let failWrite=false,failRemove=false;
  const parent = { postMessage: (message, target) => { assert.equal(target, origin);events.push('NETWORK'); sent.push(JSON.parse(JSON.stringify(message))); } };
  const window = { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'packing-transport.current.js'), 'utf8'), {
    window, parent, URL, document: { referrer: origin + '/master/support-department' }, crypto: { randomUUID: () => '11111111-1111-4111-8111-'+String(++serial).padStart(12,'0') },
    sessionStorage:{getItem:key=>{gets.push(key);return db.get(key)||null;},setItem:(key,value)=>{if(failWrite)throw Error('Cache unavailable');events.push('CACHE');db.set(key,value);},removeItem:key=>{if(!failRemove)db.delete(key);}},
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id)
  });
  const transport = window.createPackingTransport({ company: () => company,department:()=>department, onBusy: value => { busy = value; } });
  return { transport, sent, timers, db,gets,events,failWrite:()=>failWrite=true,failRemove:()=>failRemove=true,busy: () => busy, company: value => { company = value; },
    reply: (result, extra = {},request=sent.at(-1)) => { receive({ source: parent, origin, data: {
      type: request.type.replace('_REQUEST', '_RESULT'), requestId: request.requestId, company: request.company, ok: true, result, ...extra } }); } };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const staff={staffId:'S',memberId:'M',staffName:'Support',packingDepartment:'SUPPORT'},key='fmcg-packing-save-v1/SUPPORT/NCT/S/M';
async function read(f, current = true) { const promise = f.transport.read(); f.reply({company:'NCT',department:'SUPPORT',staff, version: 'PACK-V', ...(current ? { stockCurrent } : {}) }); return promise; }
test('same packing request/input survives progress and finishes only with matching committed identity', async () => {
  const f = fixture(); await read(f);
  const input = { action: 'PROGRESS', id: 'LIST', lines: [{ taskId: 'T', loaded: 40 }] }, promise = f.transport.save(input);
  const request = structuredClone(f.sent.at(-1)); input.lines[0].loaded = 999;
  f.reply({ ok: false, pending: true, requestId: request.requestId, phase: 'APPLY', completedCount: 2, totalRecords: 5 }); await flush();
  assert.equal(f.transport.hasPending(), true); assert.equal(f.busy(), true);
  await assert.rejects(f.transport.retry(), /still processing/);
  const continuation = [...f.timers.entries()].find(([, timer]) => timer.ms === 250); assert.ok(continuation);
  f.timers.delete(continuation[0]); continuation[1].fn(); await flush(); assert.deepEqual(f.sent.at(-1), request);
  f.reply({ ok: true, company:'NCT',requestId: request.requestId, stockGeneration: 4, id: 'LIST' });
  assert.equal((await promise).id, 'LIST'); assert.equal(f.transport.hasPending(), false); assert.equal(f.busy(), false);
});
test('unknown result/timeout retains exact request; retry never allocates a fresh ID or accepts old generation', async () => {
  const f = fixture(); await read(f); let promise = f.transport.save({ action: 'SEND', id: 'LIST' });
  const request = structuredClone(f.sent.at(-1));
  const timeout = [...f.timers.entries()].find(([, timer]) => timer.ms === 30000); timeout[1].fn();
  await assert.rejects(promise, /unconfirmed/); assert.equal(f.transport.hasPending(), true); assert.equal(f.busy(), false);
  promise = f.transport.retry(); assert.deepEqual(f.sent.at(-1), request);
  f.reply({ ok: true, company:'NCT',requestId: request.requestId, stockGeneration: 3, id: 'LIST' });
  await assert.rejects(promise, /unconfirmed/); assert.equal(f.transport.hasPending(), true);
  promise = f.transport.retry(); f.reply({ ok: true,company:'NCT', requestId: request.requestId, stockGeneration: 4, id: 'LIST' }); await promise;
});
test('original legacy receipt still succeeds and current metadata cannot silently cross company', async () => {
  const f = fixture(); await read(f, false); const promise = f.transport.save({ action: 'SEND', id: 'LIST' });
  assert.equal(f.sent.at(-1).stockProtocol, undefined); f.reply({ ok: true, id: 'LIST' }); await promise;
  await read(f); f.company('GHR'); assert.throws(() => f.transport.save({ action: 'SEND', id: 'LIST' }), /Company changed/);
});
test('complete own packing request is durably read-confirmed before network; quota and cleanup failure never replace it',async()=>{
 const f=fixture();await read(f);let promise=f.transport.save({action:'SEND',id:'LIST',version:'V'}),request=structuredClone(f.sent.at(-1));
 assert.deepEqual(JSON.parse(f.db.get(key)),{department:'SUPPORT',request});assert.deepEqual(f.events.slice(-2),['CACHE','NETWORK']);assert.deepEqual(request.stockIdentity,{staffId:'S',memberId:'M'});
 f.failRemove();f.reply({ok:true,company:'NCT',requestId:request.requestId,id:'LIST',stockGeneration:4});await assert.rejects(promise,/cleanup/);assert.equal(f.transport.hasPending(),true);
 promise=f.transport.retry();assert.deepEqual(f.sent.at(-1),request);f.reply({ok:false,retryable:false,error:'Review'});await assert.rejects(promise,/Review/);assert.equal(f.db.has(key),true);
 const quota=fixture();await read(quota);quota.failWrite();await assert.rejects(quota.transport.save({action:'SEND',id:'LIST'}),/unavailable/);assert.equal(quota.sent.length,1);assert.equal(quota.transport.hasPending(),true);
});
test('successful read restores only own cached current request without sending it; replacement staff cannot enumerate original',async()=>{
 const first=fixture();await read(first);const lost=first.transport.save({action:'SEND',id:'LIST'}),request=structuredClone(first.sent.at(-1));first.reply({ok:false,error:'Unknown',retryable:false});await assert.rejects(lost,/Unknown/);
 for(const memberId of ['M','OTHER']){
  const f=fixture(first.db),promise=f.transport.read();assert.equal(f.gets.length,0);f.reply({company:'NCT',department:'SUPPORT',staff:{...staff,memberId},version:'PACK-V',stockCurrent});
  if(memberId==='M'){await assert.rejects(promise,/retained/);assert.equal(f.transport.hasPending(),true);const retry=f.transport.retry();assert.deepEqual(f.sent.at(-1),request);f.reply({ok:false,error:'Keep original'});await assert.rejects(retry);}
  else{await promise;assert.equal(f.transport.hasPending(),false);}
  assert.equal(f.gets.every(value=>value===key.replace('/M','/'+memberId)),true);
 }
});
test('read barrier recovery authenticates before own cache lookup, fixes department and waits for explicit replay',async()=>{
 const initial=fixture();await read(initial);const save=initial.transport.save({action:'SEND',id:'LIST'});initial.reply({ok:false,error:'Unconfirmed'});await assert.rejects(save);
 for(const department of ['SUPPORT','WAREHOUSE']){
  const f=fixture(initial.db,department),promise=f.transport.read();f.reply(undefined,{ok:false,error:'Pending stock'});await flush();assert.equal(f.gets.length,0);
  const auth=f.sent.at(-1);assert.equal(auth.type,'PACKING_RESUME_CONTEXT_REQUEST');f.reply({ok:true,company:'NCT',department,schema:'PACKING_RESUME_CONTEXT_V1',staff:{...staff,packingDepartment:department}});
  await assert.rejects(promise,department==='SUPPORT'?/retained/:/Pending stock/);assert.equal(f.sent.length,2);assert.equal(f.transport.hasPending(),department==='SUPPORT');
  assert.equal(f.gets.every(value=>value===key.replace('/SUPPORT/','/'+department+'/')),true);
 }
});
test('stale timers cannot delete next bounded request; wrong company/list/generation never clear durable cache',async()=>{
 const f=fixture();await read(f);const promise=f.transport.save({action:'SEND',id:'LIST'}),request=structuredClone(f.sent.at(-1)),old=[...f.timers.values()].at(-1);
 f.reply({ok:false,pending:true,requestId:request.requestId,phase:'APPLY',completedCount:1,totalRecords:3});await flush();[...f.timers.values()].find(timer=>timer.ms===250).fn();await flush();old.fn();assert.equal(f.busy(),true);
 f.reply({ok:true,company:'OTHER',requestId:request.requestId,stockGeneration:4,id:'LIST'});await assert.rejects(promise,/unconfirmed/);
 for(const patch of [{id:'OTHER'},{stockGeneration:3},{requestId:'OTHER'}]){
  const retry=f.transport.retry();f.reply({ok:true,company:'NCT',requestId:request.requestId,stockGeneration:4,id:'LIST',...patch});await assert.rejects(retry,/unconfirmed/);assert.equal(f.db.has(key),true);
 }
 const retry=f.transport.retry();f.reply({ok:true,company:'NCT',requestId:request.requestId,stockGeneration:4,id:'LIST'});await retry;assert.equal(f.db.has(key),false);
 assert.throws(()=>f.transport.save({action:'SEND',id:'LIST'}),/Refresh/);
});
