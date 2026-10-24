const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {captureOriginalPackingPhotoPlan,assertPackingPhotoUploads}=require('../prototypes/stock-current-state/packing-photo-plan.cjs');
const {createPackingPhotoFencedStore}=require('../prototypes/stock-current-state/packing-photo-fenced-store.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {createCurrentPackingService}=require('../prototypes/stock-current-state/current-packing-service.cjs');
const {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const {createPackingListOperations,packingVersion}=load('packingListOperations.js'),copy=value=>JSON.parse(JSON.stringify(value));
const filename=require.resolve('./stock-current-packing-service-v2.test.cjs'),original=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',{require:createRequire(filename),Map});
const photo=(size=30)=>{const bytes=Buffer.alloc(size,2);bytes[0]=255;bytes[1]=216;bytes[2]=255;return{mimeType:'image/jpeg',base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')};};
function originalCapture(company='NCT'){
 const staff={staffId:'W',memberId:'M',staffName:'Warehouse',packingDepartment:'WAREHOUSE'},context={company,sourceVersion:'V',tasks:[],lists:[{id:'LIST',company,customerId:'C',currency:'USD',revision:'REV0',status:'PROCESSING',lines:[{taskId:'T',quantity:50,packed:40,loaded:30,photos:[],reason:''}]}]};
 const input={action:'PHOTOS',id:'LIST',taskId:'T',revision:'REV0',version:packingVersion(context),photoStage:'PACKING',photos:[photo()]};
 return{company,staff,input,context,requestId:'11111111-1111-4111-8111-111111111111',createPackingListOperations,now:()=>new Date('2026-10-22T12:00:00Z'),slots:['original-packing-slot-00001']};
}
async function fixture(coordination='EXCLUSIVE_LOCK'){
 const f=await original(),commands=[],allocated=[],files=new Map();let lose=false,waiter=null,entered;
 const documentService=async command=>{
  commands.push(copy(command));if(files.has(command.fileId))assert.deepEqual(files.get(command.fileId),copy(command));else files.set(command.fileId,copy(command));
  if(waiter){const pending=waiter;waiter=null;entered();await pending;}
  if(lose){lose=false;throw Error('Lost packing upload reply');}const result={ok:true,...command};delete result.base64;return result;
 };
 const deps={...f.deps,createPhotoProtocol:({request,staff})=>({...createSegmentedFencedProof({company:'NCT',domainWrites:true,stepsPerInvocation:1,coordination,
  store:createPackingPhotoFencedStore({company:'NCT',staff,request,store:f.store,documentService,coordination})}),readSnapshot:f.protocol.readSnapshot}),
  allocatePhotoSlots:async count=>{const result=Array.from({length:count},(_,index)=>'original-packing-slot-'+String(allocated.length+index+1).padStart(5,'0'));allocated.push(...result);return result;}};
 const service=createCurrentPackingService({company:'NCT',items:deps.items,store:f.store,protocol:f.protocol,coverage:Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])),authorityDependencies:deps});
 let ids=10;
 const command=async(department,action,details={})=>{const read=await service.read({department}),list=read.lists[0];return{department,requestId:'22222222-2222-4222-8222-'+String(++ids).padStart(12,'0'),stockProtocol:1,stockBuild:'TEST',stockGeneration:read.stockCurrent.stockGeneration,
  stockIdentity:{staffId:'S',memberId:'M'},input:{action,id:list.id,revision:list.revision,version:read.version,...details}};};
 const complete=async request=>{for(let i=0;i<60;i++){const before=commands.length,result=await service.save(request);assert.ok(commands.length-before<=1,'one external upload per bounded invocation');if(!result.pending)return result;}throw Error('Packing photo did not finish');};
 await complete(await command('SUPPORT','SEND'));await complete(await command('WAREHOUSE','START'));
 await complete(await command('WAREHOUSE','PROGRESS',{lines:[{taskId:'T',packed:50,loaded:40,reason:'Container full'}]}));
 return{...f,deps,service,command,complete,commands,allocated,files,documentService,lose:()=>lose=true,
  wait:()=>{let release;waiter=new Promise(resolve=>release=resolve);return{entered:new Promise(resolve=>entered=resolve),release};}};
}

for(const stage of ['upload','businessCAS'])test('R2 real packing flow resumes hanging '+stage+' then refuses stale completion after a newer packing edit', {timeout:5000},async()=>{
 const f=await fixture('CONTROL_CAS_CANDIDATE'),request=await f.command('WAREHOUSE','PHOTOS',{taskId:'T',photoStage:'LOADING',photos:[photo()]}),physical=JSON.stringify([...f.db].filter(([key])=>key.startsWith('StockPositions:')));
 let held;
 if(stage==='upload')held=f.wait();else{
  let enter,release,once=true;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>enter=resolve),atomic=f.store.compareAndSet;
  f.store.compareAndSet=async(c,id,version,row)=>{if(once&&row.action==='SUPPORT_PACKING_LIST_CURRENT'){once=false;enter();await gate;}return atomic(c,id,version,row);};held={entered,release};
 }
 let settled=false;const old=f.complete(request).then(value=>({value}),error=>({error})).finally(()=>settled=true);await held.entered;
 try{
  await assert.rejects(f.service.save({...request,input:{...request.input,photoStage:'PACKING'}}),/pending|reused|conflict/);
  assert.equal((await f.complete(request)).ok,true);assert.equal(settled,false);
  assert.equal(f.allocated.length,1);assert.equal(f.files.size,1);
  await f.complete(await f.command('WAREHOUSE','PROGRESS',{lines:[{taskId:'T',packed:50,loaded:45,reason:'Later loading'}]}));
  const current=JSON.stringify([...f.db]);held.release();assert.ok((await old).error);assert.equal(JSON.stringify([...f.db]),current);
  const read=await f.service.read({department:'WAREHOUSE'});assert.equal(read.lists[0].lines[0].loaded,45);assert.equal(read.lists[0].lines[0].photos.length,1);
  assert.equal([...f.db.values()].filter(row=>row.action==='PACKING_PHOTO_CONFIRMED').length,1);assert.equal(JSON.stringify([...f.db].filter(([key])=>key.startsWith('StockPositions:'))),physical);
 }finally{held.release();await old;}
});
test('both-company photo capture runs original validation with fixed server IDs, no legacy apply or physical quantity edit',async()=>{
 for(const company of ['NCT','GHR']){
  const f=originalCapture(company),before=JSON.stringify(f.context),plan=await captureOriginalPackingPhotoPlan(f);assert.equal(plan.uploads[0].fileId,f.slots[0]);
  assert.equal(plan.record.details.list.lines[0].packed,40);assert.equal(plan.record.details.list.lines[0].loaded,30);assert.equal(JSON.stringify(f.context),before);
  assert.equal(JSON.stringify(plan).includes(f.input.photos[0].base64),false);assert.equal(assertPackingPhotoUploads({...f,plan}),true);
  for(const patch of [{name:'Changed'},{poId:'Other'},{fileId:'invalid'},{sha256:'0'.repeat(64)}]){const altered=copy(plan);Object.assign(altered.uploads[0],patch);assert.throws(()=>assertPackingPhotoUploads({...f,plan:altered}),/conflict/);}
 }
});
test('original invalid photo bytes/hash/role/closed list and size limits fail before any server ID allocation',async()=>{
 for(const variant of ['hash','bytes','role','closed','history','total']){
  const f=originalCapture();if(variant==='hash')f.input.photos[0].sha256='0'.repeat(64);if(variant==='bytes')f.input.photos[0].base64='invalid';
  if(variant==='role')f.staff.packingDepartment='SUPPORT';if(variant==='closed')f.context.lists[0].invoiceId='INVOICE';
  if(variant==='history')f.context.lists[0].lines[0].photos=Array.from({length:30},(_,index)=>({fileId:'old-packing-photo-'+index,sha256:photo().sha256,stage:'PACKING',mimeType:'image/jpeg',size:30,name:'Old '+index,at:'2026-10-21T12:00:00Z',by:'Warehouse'}));
  if(variant==='total'){f.input.photos=[photo(800000),photo(800000),photo(800000)];f.slots=['valid-slot-11111','valid-slot-22222','valid-slot-33333'];}
  f.input.version=packingVersion(f.context);
  await assert.rejects(captureOriginalPackingPhotoPlan(f),variant==='closed'?/closed or has an invoice/:variant==='history'?/history is full/:undefined);
 }
 const f=await fixture(),request=await f.command('WAREHOUSE','PHOTOS',{taskId:'T',photoStage:'PACKING',photos:[{...photo(),sha256:'0'.repeat(64)}]});
 await assert.rejects(f.service.save(request),/content/);assert.equal(f.allocated.length,0);assert.equal(f.commands.length,0);
});
test('actual packing service photo slots survive lost upload reply and bounded replay without duplicating evidence or physical stock',async()=>{
 const f=await fixture(),physical=JSON.stringify([...f.db].filter(([key])=>key.startsWith('StockPositions:'))),request=await f.command('WAREHOUSE','PHOTOS',{taskId:'T',photoStage:'LOADING',photos:[photo(),photo(40)]}),identity=copy(request);
 f.lose();await assert.rejects(f.complete(request),/Lost packing upload/);assert.ok((await f.protocol.readControl()).pending);assert.equal(f.allocated.length,2);
 await assert.rejects(f.protocol.readSnapshot(()=>assert.fail('pending must hide mixed state')),/pending/);
 const result=await f.complete(request);assert.equal(result.ok,true);assert.deepEqual(request,identity);assert.equal(f.files.size,2);assert.equal(f.allocated.length,2);assert.deepEqual(f.commands[0],f.commands[1]);
 const count=f.commands.length;assert.deepEqual(await f.complete(request),result);assert.equal(f.commands.length,count);
 const read=await f.service.read({department:'WAREHOUSE'}),line=read.lists[0].lines[0];assert.equal(line.quantity,50);assert.equal(line.packed,50);assert.equal(line.loaded,40);assert.equal(line.photos.length,2);
 assert.equal([...f.db.values()].filter(row=>row.action==='PACKING_PHOTO_CONFIRMED').length,2);assert.equal(JSON.stringify([...f.db]).includes(photo().base64),false);
 assert.equal(JSON.stringify([...f.db].filter(([key])=>key.startsWith('StockPositions:'))),physical);assert.equal(read.lists[0].invoiceId,undefined);
});
for(const coordination of ['EXCLUSIVE_LOCK','CONTROL_CAS_CANDIDATE'])test(coordination+' reissued employee cannot adopt photo plan; same original employee renamed resumes original audit and keeps slot IDs',async()=>{
 const f=await fixture(coordination),request=await f.command('WAREHOUSE','PHOTOS',{taskId:'T',photoStage:'PACKING',photos:[photo()]});f.lose();await assert.rejects(f.complete(request));
 const originalRead=f.deps.readStaffRecords,records=await originalRead();f.deps.readStaffRecords=async()=>records.map(row=>({...row,title:'S2',staffName:'Replacement'}));
 await assert.rejects(f.service.save(request),/identity/);await assert.rejects(f.service.save({...request,stockIdentity:{staffId:'S2',memberId:'M'}}),/pending|identity/);
 f.deps.readStaffRecords=async()=>records.map(row=>({...row,staffName:'Renamed'}));assert.equal((await f.complete(request)).ok,true);assert.equal(f.allocated.length,1);
 const row=[...f.db.values()].find(item=>item.action==='PACKING_PHOTO_CONFIRMED');assert.equal(row.initiatedByStaffName,'LAW');
});
test('photo adapter refuses unowned direct writes/receipt updates/unrelated lock release and a late callback after changed fence',async()=>{
 const f=await fixture(),request=await f.command('WAREHOUSE','PHOTOS',{taskId:'T',photoStage:'PACKING',photos:[photo()]}),staff={staffId:'S',memberId:'M',staffName:'LAW',packingDepartment:'WAREHOUSE'};
 const adapter=createPackingPhotoFencedStore({company:'NCT',staff,request,store:f.store,documentService:f.documentService});
 await assert.rejects(adapter.insert('NCTActivity',{_id:'OTHER',action:'SUPPORT_PACKING_LIST_CURRENT'}),/pending/);
 await assert.rejects(adapter.compareAndSet('NCTActivity','OTHER','V',{_id:'OTHER',action:'PACKING_PHOTO_CONFIRMED'}),/insert-only/);
 assert.throws(()=>adapter.compareAndRemove('StockProducts','OTHER','attempt'),/owned/);assert.equal(f.commands.length,0);
 const waiting=f.wait(),pending=f.complete(request);await waiting.entered;
 const control=f.db.get('NCTActivity:'+f.protocol.ids.controlId);control._version='Changed while external callback unresolved';waiting.release();
 await assert.rejects(pending,/fence changed/);assert.equal([...f.db.values()].filter(row=>row.action==='PACKING_PHOTO_CONFIRMED').length,0);
 assert.ok((await f.protocol.readControl()).pending);assert.equal(f.files.size,1,'late immutable file may exist but cannot commit business evidence or stock');
});
