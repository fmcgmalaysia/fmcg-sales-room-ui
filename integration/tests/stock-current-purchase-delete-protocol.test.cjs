const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),path=require('node:path');
const {createRequire}=require('node:module');
const {createCurrentOrderFileSave}=require('../prototypes/stock-current-state/current-order-file-save.cjs');
const {createPurchaseDeleteProtocol}=require('../prototypes/stock-current-state/purchase-delete-protocol.cjs');
const {inspectSegmentedStockRecovery}=require('../prototypes/stock-current-state/segmented-recovery-inspector.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs'),copy=value=>JSON.parse(JSON.stringify(value));
const file=require.resolve('./stock-current-order-file-fence.test.cjs'),base=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',{require:createRequire(file),Map,Buffer});
const originalFile=require.resolve('./stock-current-order-file-plan.test.cjs'),legacy=vm.runInNewContext(fs.readFileSync(originalFile,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';legacy;',{require:createRequire(originalFile),Map,Buffer});
async function fixture(company='NCT'){
 const f=await base({company}),commands=[],writes=[];let time='2026-10-22T08:00:00.000Z',wrong=false,lose=false,hook;
 f.request.input={...f.request.input,action:'DELETE_DOCUMENT',fileId:'PO'};
 const originalCas=f.store.compareAndSet;f.store.compareAndSet=async(c,id,version,row)=>{const result=await originalCas(c,id,version,row);if(c==='PurchaseOrders')writes.push(copy(row));return result;};
 const service=async command=>{
  const row=await f.store.read('PurchaseOrders',f.request.input.id),control=await f.original.readControl();
  assert.equal(row.details.documents[0].linked,false);assert.equal(row.details.documents[0].deletion.state,'PENDING');assert.equal(row.details.audit.length,0);
  assert.equal(row.details.documentDeletion.requestId,f.request.requestId);assert.equal(control.pending.phase,'FINALIZE');assert.equal(control.generation,0);
  commands.push(copy(command));if(hook)await hook();if(lose){lose=false;throw Error('Lost trash callback');}
  return{ok:true,trashed:true,...command,...(wrong?{name:'WRONG'}:{})};
 };
 const makeProtocol=({request,staff})=>createPurchaseDeleteProtocol({company,request,staff,store:f.store,documentService:service,now:()=>new Date(time),stepsPerInvocation:1});
 f.deps.createFileProtocol=makeProtocol;const save=createCurrentOrderFileSave(f.deps),finish=async()=>{for(let i=0;i<20;i++){const result=await save(f.request);if(result.ok)return result;}throw Error('Unbounded staged deletion');};
 const envelope={company,writer:'PURCHASE_ORDER_RECORD',input:f.request.input,stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:f.request.stockIdentity};
 const inspect=()=>inspectSegmentedStockRecovery({store:f.store,company,requestId:f.request.requestId,memberId:'M',input:envelope,domainWrites:true});
 return{...f,save,finish,commands,writes,service,makeProtocol,inspect,time:value=>time=value,wrong:value=>wrong=value,lose:()=>lose=true,hook:fn=>hook=fn};
}
async function toFinal(f){for(let i=0;i<12;i++){const result=await f.save(f.request),control=await f.original.readControl();if(control.pending?.phase==='VERIFY'&&control.pending.cursor===1)return result;}throw Error('No pre-final checkpoint');}

test('both companies unlink first, trash only under FINALIZE, then exact original completion audit uses actual callback time',async()=>{
 for(const company of ['NCT','GHR']){
  const f=await fixture(company),originalTask=copy(f.context.tasks);await toFinal(f);
  assert.equal(f.commands.length,0);assert.equal((await f.inspect()).images[0].image,'PENDING_UNLINK');
  const result=await f.finish(),row=await f.store.read('PurchaseOrders',f.request.input.id);assert.equal(result.stockGeneration,1);assert.equal(f.writes.length,2);assert.equal(f.commands.length,1);
  assert.equal(row.details.documentDeletion,null);assert.equal(row.details.documents[0].deletion.state,'DELETED');assert.equal(row.details.audit[0].time,'2026-10-22T08:00:00.000Z');
  assert.equal(row.details.documents[0].deletion.at,row.details.audit[0].time);assert.equal(f.writes[0].details.documentDeletion.at,'2026-10-22T07:00:00.000Z');
  assert.equal(result.savedAt,row.details.audit[0].time);assert.deepEqual(copy(f.context.tasks),originalTask);assert.equal(f.counts().allocations,0);assert.equal(f.counts().reads,1);
  let originalTime='2026-10-22T07:00:00.000Z';const original=await legacy({...f.args(),input:copy(f.request.input),slots:[],now:()=>new Date(originalTime),afterEffect:()=>{originalTime='2026-10-22T08:00:00.000Z';}});
  const actual=copy(row),expected=copy(original.record);delete actual._version;delete expected._version;assert.deepEqual(actual,expected,'exact ORIGINAL result including post-trash audit time; only conditional version is protocol metadata');
  const packet=await f.inspect();assert.equal(packet.status,'CONFIRMED_RESULT');assert.equal(packet.images[0].image,'FILE_DELETE_COMPLETED');
  f.time('2026-10-23T09:00:00.000Z');assert.deepEqual(await f.save(f.request),result);assert.equal(f.commands.length,1);assert.equal(f.writes.length,2);
 }
});

test('lost/wrong trash reply retains durable unlink with no final audit; same authorized request resumes without new preparation',async()=>{
 for(const failure of ['lost','wrong']){
  const f=await fixture();await toFinal(f);if(failure==='lost')f.lose();else f.wrong(true);
  await assert.rejects(f.save(f.request),/trash callback|trash unconfirmed/);
  let row=await f.store.read('PurchaseOrders',f.request.input.id);assert.equal(row.details.documentDeletion.requestId,f.request.requestId);assert.equal(row.details.audit.length,0);
  assert.equal((await f.inspect()).status,'SAME_REQUEST_REVALIDATES_ON_RESUME');await assert.rejects(f.original.readSnapshot(async()=>null),/pending/);
  f.wrong(false);f.time('2026-10-22T10:00:00.000Z');f.setStaff({staffName:'Renamed purchaser'});const final=await f.finish();row=await f.store.read('PurchaseOrders',f.request.input.id);
  assert.equal(final.savedAt,'2026-10-22T10:00:00.000Z');assert.equal(row.details.audit.length,1);assert.equal(row.details.audit[0].actor,'PURCHASE');
  assert.equal(f.counts().reads,1);assert.equal(f.commands.length,2);assert.deepEqual(f.commands[0],f.commands[1]);assert.equal(f.counts().allocations,0);
 }
});

test('lost final CMS callback confirms exact row without another trash; lost generation transition resumes retained result/time',async()=>{
 const f=await fixture();await toFinal(f);f.hook(async()=>f.loseCms());const final=await f.finish();assert.equal(final.stockGeneration,1);assert.equal(f.counts().cmsLosses,1);assert.equal(f.commands.length,1);
 const g=await fixture();await toFinal(g);const cas=g.store.compareAndSet;let blocked=true;
 g.store.compareAndSet=async(c,id,version,row)=>{if(blocked&&id===g.original.ids.controlId&&row.generation===1){blocked=false;throw Error('Lost final generation write');}return cas(c,id,version,row);};
 await assert.rejects(g.save(g.request),/Lost final generation/);assert.equal((await g.original.readControl()).pending.phase,'FINALIZE');
 const packet=await g.inspect();assert.equal(packet.status,'SAME_REQUEST_RECHECK_RESULT');assert.equal(packet.images[0].image,'FILE_DELETE_COMPLETED');
 g.time('2026-10-23T01:00:00.000Z');assert.equal((await g.finish()).savedAt,'2026-10-22T08:00:00.000Z');assert.equal(g.commands.length,1);
});

test('interruption before/after unlink preserves original file and same request; failed final CAS retries only exact completion',async()=>{
 const f=await fixture(),cas=f.store.compareAndSet;let before=true;
 f.store.compareAndSet=async(c,id,version,row)=>{if(c==='PurchaseOrders'&&before){before=false;throw Error('Unlink not written');}return cas(c,id,version,row);};
 await f.save(f.request);await assert.rejects(f.save(f.request),/Unlink not written/);assert.equal(f.commands.length,0);
 assert.equal((await f.store.read('PurchaseOrders',f.request.input.id)).details.documents[0].linked,true);assert.equal((await f.finish()).ok,true);assert.equal(f.commands.length,1);
 const g=await fixture();await toFinal(g);const original=g.store.compareAndSet;let fail=true;
 g.store.compareAndSet=async(c,id,version,row)=>{if(c==='PurchaseOrders'&&row.details.documentDeletion===null&&fail){fail=false;throw Error('Completion not written');}return original(c,id,version,row);};
 await assert.rejects(g.save(g.request),/Completion not written/);assert.equal((await g.store.read('PurchaseOrders',g.request.input.id)).details.audit.length,0);
 assert.equal((await g.finish()).ok,true);assert.equal(g.commands.length,2);assert.equal(g.counts().reads,1);
});

test('changed request or revoked staff cannot resume trash, and competing company writer stays blocked',async()=>{
 const f=await fixture();await toFinal(f);await assert.rejects(f.save({...f.request,input:{...f.request.input,reason:'OTHER'}}),/identity|pending/);assert.equal(f.commands.length,0);
 f.setStaff({staffId:'OTHER'});await assert.rejects(f.save(f.request),/actor/);assert.equal(f.commands.length,0);
 f.setStaff({staffId:'P'});await assert.rejects(f.original.commit({requestId:'22222222-2222-4222-8222-222222222222',memberId:'OTHER',input:{},prepare:async()=>{throw Error('Must not prepare');}}),/pending/);
 assert.equal((await f.finish()).ok,true);
});

test('late trash callback cannot close foreign owner or changed checkpoint/record; uncertainty stays blocked',async()=>{
 for(const kind of ['control','owner','record']){
  const f=await fixture();await toFinal(f);f.hook(async()=>{if(kind==='control')f.db.get(f.journal+'/'+f.original.ids.controlId)._version='OTHER';
   else if(kind==='owner')f.db.get(f.journal+'/'+f.original.ids.lockId).attempt='OTHER';else f.db.get('PurchaseOrders/'+f.request.input.id).details.unrelated='MUTATED';});
  await assert.rejects(f.save(f.request),/fence changed|Attempt changed|pending deletion changed/);
  const row=await f.store.read('PurchaseOrders',f.request.input.id);assert.equal(row.details.audit.length,0);assert.notEqual(row.details.documentDeletion,null);
  if(kind==='owner')assert.equal(f.db.get(f.journal+'/'+f.original.ids.lockId).attempt,'OTHER');
 }
});

test('malformed completion or forged result cannot be mistaken for completed deletion by recovery or replay',async()=>{
 const f=await fixture();await toFinal(f);f.lose();await assert.rejects(f.save(f.request));
 const control=await f.original.readControl(),key=control.pending.key,manifest=await f.store.read(f.journal,key),resultId=hash(key,'RESULT');
 f.db.set(f.journal+'/'+resultId,{_id:resultId,company:'NCT',stockOperationProtocol:2,digest:manifest.digest,baseGeneration:0,outcome:{ok:true,operationId:key,generation:1}});
 assert.equal((await f.inspect()).status,'REVIEW_FILE_DELETE_NOT_COMPLETED');await assert.rejects(f.save(f.request),/lacks completed/);assert.equal((await f.original.readControl()).generation,0);f.db.delete(f.journal+'/'+resultId);
 const row=f.db.get('PurchaseOrders/'+f.request.input.id);row.details.documentDeletion=null;assert.equal((await f.inspect()).status,'REVIEW_IMAGE_CONFLICT');await assert.rejects(f.save(f.request),/image conflict/);
});

test('generated runtime uses same coordinator for original staged deletion, no new route or duplicate-identity plan',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../prototypes/stock-current-state/stockCurrentCommands.js'),'utf8');
 const runtime=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({createCurrentOrderFileSave,createPurchaseDeleteProtocol});',{createHash:crypto.createHash,randomBytes:crypto.randomBytes,StockRuntimeBuffer:Buffer});
 const f=await fixture();f.deps.createFileProtocol=({request,staff})=>runtime.createPurchaseDeleteProtocol({company:'NCT',staff,request,store:f.store,documentService:f.service,now:()=>new Date('2026-10-22T08:30:00Z')});
 const done=await runtime.createCurrentOrderFileSave(f.deps)(f.request);assert.equal(done.stockGeneration,1);assert.equal(done.savedAt,'2026-10-22T08:30:00.000Z');assert.equal(f.commands.length,1);
});
