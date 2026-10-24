const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs'),{hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const {captureOriginalWarehousePhotoPlan}=require('../prototypes/stock-current-state/warehouse-photo-plan.cjs');
const {prependWarehousePhotoReceipts,createWarehousePhotoFencedStore}=require('../prototypes/stock-current-state/warehouse-photo-fenced-store.cjs');
const source=require.resolve('./stock-current-warehouse-photo-plan.test.cjs'),copy=value=>JSON.parse(JSON.stringify(value));
const {original,service}=vm.runInNewContext(fs.readFileSync(source,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';({original:fixture,service});',
 {require:createRequire(source),__dirname:path.dirname(source),Map,Buffer});
async function fixture(count=2,coordination='EXCLUSIVE_LOCK'){
 const{args}=await original();args.input.photos=Array.from({length:count},()=>copy(args.input.photos[0]));args.slots=Array.from({length:count},(_,index)=>'fixed-original-slot-12345-'+index);
 const prepared=await captureOriginalWarehousePhotoPlan(args),rows=new Map(),drive=service(),commands=[],domain=[];let lostUpload=false,lostReceipt=false,delayedUpload=false,delayed=[],prepares=0,attempts=0;
 const request={requestId:args.requestId,input:args.input,stockProtocol:1,stockBuild:'TEST',stockGeneration:0};
 const base={read:async(c,id)=>copy(rows.get(c+'/'+id)||null),insert:async(c,row)=>{
  if(rows.has(c+'/'+row._id))throw Error('Already exists');rows.set(c+'/'+row._id,copy(row));
  if(row.stockPhotoProtocol||row.action==='WAREHOUSE_PREPARATION_SAVED'||c==='StockProducts')domain.push(copy(row));
  if(lostReceipt&&row.stockPhotoProtocol){lostReceipt=false;throw Error('Lost receipt acknowledgement');}
 },compareAndSet:async(c,id,version,row)=>{if(rows.get(c+'/'+id)?._version!==version)throw Error('Condition mismatch');rows.set(c+'/'+id,copy(row));},
 compareAndRemove:async(c,id,attempt)=>{if(rows.get(c+'/'+id)?.attempt!==attempt)throw Error('Lock changed');rows.delete(c+'/'+id);}};
 let hold;
 const documentService=async command=>{
  commands.push(copy(command));
  assert.equal((await base.read('NCTActivity',protocol.ids.controlId)).pending.phase,'APPLY');
  assert.equal(domain.some(row=>row.action==='WAREHOUSE_PREPARATION_SAVED'),false,'no original evidence before all immutable file receipts');
  if(delayedUpload){delayedUpload=false;delayed.push(()=>drive.upload(command));throw Error('Unknown remote callback');}
  const blocked=hold;hold=null;if(blocked?.stage==='before'){blocked.enter();await blocked.gate;}
  const result=drive.upload(command);if(blocked?.stage==='after'){blocked.enter();await blocked.gate;}
  if(lostUpload){lostUpload=false;throw Error('Lost upload acknowledgement');}return result;
 };
 const store=createWarehousePhotoFencedStore({company:'NCT',staff:args.staff,request,store:base,documentService,coordination});
 const protocol=createSegmentedFencedProof({company:'NCT',store,domainWrites:true,stepsPerInvocation:1,coordination,newAttempt:()=> 'ATTEMPT'+ ++attempts});await protocol.initialize();
 const control=await base.read('NCTActivity',protocol.ids.controlId);rows.set('NCTActivity/'+control._id,{...control,mode:'ACTIVE'});
 const plan=prependWarehousePhotoReceipts({...args,prepared,plan:{writes:[{collection:'NCTActivity',before:null,after:{...prepared.event,company:'NCT'}},
  {collection:'StockProducts',before:null,after:{_id:'PRODUCT',company:'NCT',revision:1}}]}});
 const envelope={company:'NCT',writer:'WAREHOUSE_PREPARATION',input:request.input,stockProtocol:1,stockBuild:'TEST',stockGeneration:0};
 const command={requestId:args.requestId,memberId:args.staff.memberId,input:envelope,prepare:async()=>{prepares++;return plan;}};
 const finish=async()=>{for(let index=0;index<50;index++){const result=await protocol.commit(command);if(result.ok)return result;}throw Error('Bounded resume did not finish');};
 return{...args,request,prepared,plan,rows,base,store,protocol,drive,commands,domain,command,finish,delayed,
  holdUpload:(stage)=>{let enter,release;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);hold={stage,enter,gate};return{entered,release};},
  loseUpload:()=>{lostUpload=true;},loseReceipt:()=>{lostReceipt=true;},delayUpload:()=>{delayedUpload=true;},prepares:()=>prepares};
}

test('counterexample: default exclusive photo invocation still running prevents a second same-operation resume', {timeout:5000},async()=>{
 const f=await fixture(1),held=f.holdUpload('after'),old=f.finish();await held.entered;
 try{await assert.rejects(f.finish(),/Already exists/);assert.equal(f.domain.length,0);assert.ok((await f.protocol.readControl()).pending);}
 finally{held.release();await old;}
});
for(const stage of ['before','after'])test('R2 '+stage+' remote upload: retry finishes while original is unresolved; late upload cannot undo newer stock', {timeout:5000},async()=>{
 const f=await fixture(2,'CONTROL_CAS_CANDIDATE'),held=f.holdUpload(stage);
 let settled=false;const old=f.finish().then(value=>({value}),error=>({error})).finally(()=>settled=true);await held.entered;
 try{
  assert.equal((await f.finish()).ok,true);assert.equal(settled,false,'old invocation must genuinely remain running');assert.equal(f.prepares(),1);
  assert.equal(f.drive.files.size,2);assert.deepEqual(f.commands[0],f.commands[1]);
  const normal=createSegmentedFencedProof({company:'NCT',store:f.base,domainWrites:true,coordination:'CONTROL_CAS_CANDIDATE'});
  const before=await f.base.read('StockProducts','PRODUCT');
  await normal.commit({requestId:'33333333-3333-4333-8333-333333333333',memberId:f.staff.memberId,input:{later:true},prepare:async()=>({writes:[{collection:'StockProducts',before,after:{...before,revision:2}}]})});
  const current=JSON.stringify([...f.rows]);held.release();assert.ok((await old).error);assert.equal(JSON.stringify([...f.rows]),current);
  assert.equal(f.drive.files.size,2);assert.equal(f.domain.filter(row=>row.action==='WAREHOUSE_PREPARATION_SAVED').length,1);
  assert.equal(await f.base.read('NCTActivity',f.protocol.ids.lockId),null,'no exclusive lock exists');
 }finally{held.release();await old;}
});
test('one upload per bounded invocation under durable same pending manifest; receipts precede original evidence and stock revision',async()=>{
 const f=await fixture();let result;
 for(let index=0;index<30;index++){
  const calls=f.commands.length;result=await f.protocol.commit(f.command);assert.ok(f.commands.length-calls<=1);
  if(result.ok)break;await assert.rejects(f.protocol.readSnapshot(()=>[]),/pending/);
 }
 assert.equal(result.ok,true);assert.equal(f.prepares(),1);assert.equal(f.drive.files.size,2);assert.equal(f.commands.every(command=>command.action==='PHOTO_UPLOAD'),true);
 assert.deepEqual(f.domain.map(row=>row.action||'PRODUCT'),['WAREHOUSE_PHOTO_CONFIRMED','WAREHOUSE_PHOTO_CONFIRMED','WAREHOUSE_PREPARATION_SAVED','PRODUCT']);
 const before=f.commands.length;assert.deepEqual(await f.finish(),result);assert.equal(f.commands.length,before);assert.equal((await f.protocol.readControl()).generation,1);
});
for(const coordination of ['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'])for(const loss of ['loseUpload','loseReceipt','delayUpload'])test(coordination+' '+loss+': same UUID/immutable slot recovery, never a second stock event or borrowed file destination',async()=>{
 const f=await fixture(2,coordination);f[loss]();
 if(loss==='loseReceipt')await f.finish();else await assert.rejects(f.finish(),/Lost upload|Unknown remote/);
 if(loss!=='loseReceipt'){
  assert.equal((await f.protocol.readControl()).generation,0);assert.ok((await f.protocol.readControl()).pending);
  assert.equal(f.domain.some(row=>row.action==='WAREHOUSE_PREPARATION_SAVED'),false);assert.equal(f.prepares(),1);
 }
 await f.finish();assert.equal(f.drive.files.size,2);assert.equal(f.prepares(),1);assert.equal(f.domain.filter(row=>row.action==='WAREHOUSE_PREPARATION_SAVED').length,1);
 const current=JSON.stringify([...f.rows]);for(const callback of f.delayed)callback();assert.equal(JSON.stringify([...f.rows]),current,'late immutable external callback cannot change stock or event');
 assert.equal(f.drive.files.size,2);assert.equal((await f.protocol.readControl()).generation,1);
});
for(const coordination of ['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'])test(coordination+' unprepared/direct photo writes, moved slot ordering, forged metadata and changed operation digest refuse before any external callback',async()=>{
 const f=await fixture(2,coordination),first=f.plan.writes[0].after;
 await assert.rejects(f.store.insert('NCTActivity',first),/Durable pending/);assert.equal(f.commands.length,0);
 await assert.rejects(f.store.compareAndSet('NCTActivity',first._id,'V',first),/insert-only/);
 const changed=copy(f.plan);changed.writes.reverse();
 await assert.rejects((async()=>{for(let index=0;index<20;index++)await f.protocol.commit({...f.command,prepare:async()=>changed});})(),/precede/);assert.equal(f.commands.length,0);assert.equal(f.domain.length,0);assert.ok((await f.protocol.readControl()).pending,'unverified plan stays pending, never auto-released');
 await assert.rejects(f.protocol.commit({...f.command,input:{...f.command.input,input:{...f.command.input.input,note:'Changed'}}}),/pending|reused/);
 assert.equal(f.commands.length,0);
});
