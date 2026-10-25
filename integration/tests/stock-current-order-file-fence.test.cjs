const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {createCurrentOrderFileSave}=require('../prototypes/stock-current-state/current-order-file-save.cjs'),{createOrderFileFencedStore}=require('../prototypes/stock-current-state/order-file-fenced-store.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs'),{WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const {projectPurchaseOrders}=load('purchaseOrderWorkflow.js'),copy=value=>JSON.parse(JSON.stringify(value));
const filename=require.resolve('./stock-current-order-file-plan.test.cjs'),base=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',{require:createRequire(filename),Map,Buffer});
async function fixture({department='PURCHASE',company='NCT',saved=true,proofDelete=false,multi=false}={}){
 const f=base(department,company,saved),db=new Map(f.records.map(row=>['PurchaseOrders/'+row._id,copy(row)])),effects=[],files=new Map();let staff=copy(f.staff),allocations=0,reads=0,auths=0,cmsLosses=0,late,wrongReceipt=false,loseFile=false,loseCms=false;
 if(proofDelete)db.get('PurchaseOrders/'+f.input().id).details.finance={payments:[{id:'PAY',cents:100,confirmed:true,proof:{fileId:'proof_to_delete',name:'proof.pdf',sha256:'hash',linked:true,uploadedByStaffId:'A'}}]};
 const records=()=>[...db].filter(([key])=>key.startsWith('PurchaseOrders/')).map(([,row])=>copy(row)),rows=()=>projectPurchaseOrders({company,workspace:f.context,records:records()});
 const store={read:async(c,id)=>copy(db.get(c+'/'+id)||null),insert:async(c,row)=>{if(db.has(c+'/'+row._id))throw Error('Duplicate');db.set(c+'/'+row._id,copy(row));if(c==='PurchaseOrders'&&loseCms){loseCms=false;cmsLosses++;throw Error('Lost CMS reply');}},
  compareAndSet:async(c,id,version,row)=>{if(db.get(c+'/'+id)?._version!==version)throw Error('Conflict');db.set(c+'/'+id,copy(row));if(c==='PurchaseOrders'&&loseCms){loseCms=false;cmsLosses++;throw Error('Lost CMS reply');}},
  compareAndRemove:async(c,id,attempt)=>{if(db.get(c+'/'+id)?.attempt!==attempt)throw Error('Attempt changed');db.delete(c+'/'+id);}};
 const original=createSegmentedFencedProof({company,store,domainWrites:true});await original.initialize();const journal=original.ids.journal;
 Object.assign(db.get(journal+'/'+original.ids.controlId),{mode:'ACTIVE',schemaVersion:1,writerBuild:'TEST'});
 const documentService=async command=>{effects.push(copy(command));const immutable={...copy(command)};delete immutable.base64;
  if(files.has(command.fileId))assert.deepEqual(files.get(command.fileId),immutable);else files.set(command.fileId,immutable);
  if(late)await late();if(loseFile){loseFile=false;throw Error('Lost file reply');}
  return{ok:true,...command,...(command.action==='TRASH'?{trashed:true}:{}),...(wrongReceipt?{sha256:'WRONG'}:{})};};
 const deps={company,department,store,coverage:Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])),authenticateOriginal:async()=>{auths++;return copy(staff);},
  readOriginalContext:async()=>{reads++;return{context:copy(f.context),records:records(),rows:rows(),suppliers:copy(f.suppliers)};},
  createFileProtocol:({request,staff})=>createSegmentedFencedProof({company,store:createOrderFileFencedStore({company,department,request,staff,store,documentService}),domainWrites:true,stepsPerInvocation:1}),
  allocateDocumentSlot:async()=> 'fixed_file_slot_'+String(++allocations).padStart(4,'0'),createPurchaseOrderOperations:f.args().createPurchaseOrderOperations,
  createAccountSettlementOperations:f.args().createAccountSettlementOperations,now:()=>new Date('2026-10-22T07:00:00Z')};
 const input={...f.input(),version:rows()[0].version,...(proofDelete?{action:'PAYMENT_FILE_DELETE',paymentId:'PAY',fileId:'proof_to_delete'}:{}),
  ...(multi?{type:'PAYMENT',cents:200,recipientChoice:'SUPPLIER',recipientBank:{bankName:'BANK',bankAccountNo:'123'},paymentSource:'CASH',attachments:[{base64:Buffer.from('%PDF-1.4\nsecond').toString('base64')}]}:{})};
 const request={requestId:f.args().requestId,input,stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:staff.staffId,memberId:staff.memberId}},save=createCurrentOrderFileSave(deps);
 const finish=async()=>{for(let i=0;i<18;i++){const result=await save(request);if(result.ok)return result;assert.equal(result.pending,true);}throw Error('Unbounded order file operation');};
 return{...f,db,store,original,journal,files,effects,request,deps,save,finish,counts:()=>({allocations,reads,auths,cmsLosses}),setStaff:patch=>staff={...staff,...patch},
  wrongReceipt:value=>wrongReceipt=value,loseFile:()=>loseFile=true,loseCms:()=>loseCms=true,late:fn=>late=fn};
}

test('both companies original Purchase/Account uploads and Account proof trash use same fence and exactly one original metadata audit',async()=>{
 for(const company of ['NCT','GHR'])for(const config of [{department:'PURCHASE',saved:false},{department:'PURCHASE'},{department:'ACCOUNT'},{department:'ACCOUNT',multi:true},{department:'ACCOUNT',proofDelete:true}]){
  const f=await fixture({company,...config});assert.equal((await f.save(f.request)).pending,true);assert.equal(f.effects.length,0);
  const done=await f.finish(),row=f.db.get('PurchaseOrders/'+f.request.input.id);assert.equal(done.stockGeneration,1);assert.equal(done.poId,row._id);assert.equal(row.details.audit.length,1);
  assert.equal(f.files.size,config.multi?2:1);assert.equal(f.counts().reads,1);assert.equal(f.counts().allocations,config.proofDelete?0:config.multi?2:1);
  const count=f.effects.length;assert.deepEqual(await f.save(f.request),done);assert.equal(f.effects.length,count);assert.equal(f.db.has('StockProducts/1'),false);
  assert.equal(JSON.stringify([...f.db.values()]).includes('base64'),false);assert.equal(f.context.tasks[0].ord,100);
 }
});

test('lost external and CMS replies replay only same slots/plan without duplicate proof, audit, amount or stock mutation',async()=>{
 for(const department of ['PURCHASE','ACCOUNT']){
  const f=await fixture({department,multi:department==='ACCOUNT'});await f.save(f.request);f.loseFile();await assert.rejects(f.save(f.request),/Lost file reply/);
  assert.equal(f.db.get('PurchaseOrders/'+f.request.input.id).details.audit.length,0);f.setStaff({staffName:'Renamed'});f.loseCms();
  assert.equal((await f.finish()).ok,true);assert.equal(f.counts().cmsLosses,1,'lost CMS callback is confirmed by exact read, not a duplicate write');
  assert.equal(f.files.size,department==='ACCOUNT'?2:1);assert.equal(f.counts().allocations,department==='ACCOUNT'?2:1);assert.equal(f.counts().reads,1);
  const row=f.db.get('PurchaseOrders/'+f.request.input.id);assert.equal(row.details.audit.length,1);assert.equal(row.details.audit[0].actor,department);if(department==='ACCOUNT')assert.equal(row.details.finance.payments.length,1);
 }
});

test('wrong file receipts never link metadata; same request resumes after service correction',async()=>{
 for(const config of [{},{department:'ACCOUNT',multi:true},{department:'ACCOUNT',proofDelete:true}]){
  const f=await fixture(config);await f.save(f.request);f.wrongReceipt(true);await assert.rejects(f.save(f.request),/unconfirmed/);
  assert.equal(f.db.get('PurchaseOrders/'+f.request.input.id).details.audit.length,0);await assert.rejects(f.original.readSnapshot(async()=>null),/pending/);
  f.wrongReceipt(false);assert.equal((await f.finish()).stockGeneration,1);assert.equal(f.db.get('PurchaseOrders/'+f.request.input.id).details.audit.length,1);
 }
});

test('changed payload, staff ID, coverage, stale original version or invalid bank refuse before new allocation/file callback',async()=>{
 const f=await fixture();await f.save(f.request);await assert.rejects(f.save({...f.request,input:{...f.request.input,number:'OTHER'}}),/pending|identity/);
 f.setStaff({staffId:'OTHER'});await assert.rejects(f.save(f.request),/actor/);assert.equal(f.effects.length,0);assert.equal(f.counts().allocations,1);
 const stale=await fixture();stale.request.input.version='OLD';await assert.rejects(stale.save(stale.request),/changed/);assert.equal(stale.counts().allocations,0);
 const invalid=await fixture({department:'ACCOUNT',multi:true});invalid.request.input.recipientBank.bankAccountNo='WRONG';await assert.rejects(invalid.save(invalid.request),/bank account/);assert.equal(invalid.counts().allocations,0);
 const closed=await fixture();closed.deps.coverage.RECEIPT.verified=false;await assert.rejects(closed.save(closed.request),/coverage/);assert.equal(closed.counts().allocations,0);
 const deletion=await fixture();deletion.request.input.action='DELETE_DOCUMENT';await assert.rejects(deletion.save(deletion.request),/file fence/);
 await assert.rejects(createCurrentOrderFileSave({...deletion.deps,createFileProtocol:()=>deletion.original})(deletion.request),/staged/);assert.equal(deletion.counts().allocations,0);
});

test('late external callbacks after owner/checkpoint change cannot write metadata or release another execution lock',async()=>{
 const f=await fixture();await f.save(f.request);f.late(async()=>{f.db.get(f.journal+'/'+f.original.ids.controlId)._version='CHANGED';});
 await assert.rejects(f.save(f.request),/fence changed/);assert.equal(f.db.get('PurchaseOrders/'+f.request.input.id).details.audit.length,0);
 const g=await fixture();await g.save(g.request);g.late(async()=>{g.db.get(g.journal+'/'+g.original.ids.lockId).attempt='OTHER';});
 await assert.rejects(g.save(g.request),/Attempt changed/);assert.equal(g.db.get(g.journal+'/'+g.original.ids.lockId).attempt,'OTHER');assert.equal(g.db.get('PurchaseOrders/'+g.request.input.id).details.audit.length,0);
});

test('direct arbitrary file write or removal without exact manifest cannot invoke external service or mutate business rows',async()=>{
 const f=await fixture(),staff=f.staff,adapter=createOrderFileFencedStore({company:'NCT',department:'PURCHASE',staff,request:f.request,store:f.store,documentService:async()=>{throw Error('Unexpected file');}}),row=copy(f.db.get('PurchaseOrders/'+f.request.input.id));
 await assert.rejects(adapter.compareAndSet('PurchaseOrders',row._id,row._version,row),/APPLY fence/);
 assert.throws(()=>adapter.compareAndRemove('PurchaseOrders',row._id,'FORGED'),/owned/);assert.equal(f.effects.length,0);
});

test('original retained final audit is required on replay and a pre-migration same-ID audit cannot be adopted',async()=>{
 const f=await fixture();await f.finish();const row=f.db.get('PurchaseOrders/'+f.request.input.id),audit=copy(row.details.audit[0]);
 row.details.audit.push(audit);await assert.rejects(f.save(f.request),/receipt requires review/);row.details.audit=[];await assert.rejects(f.save(f.request),/receipt requires review/);
 const g=await fixture();g.db.get('PurchaseOrders/'+g.request.input.id).details.audit.push(audit);g.request.input.version=projectPurchaseOrders({company:'NCT',workspace:g.context,records:[copy(g.db.get('PurchaseOrders/'+g.request.input.id))]})[0].version;
 await assert.rejects(g.save(g.request),/Preexisting original file audit/);assert.equal(g.counts().allocations,0);assert.equal(g.effects.length,0);
});

test('generated runtime executes original multifile prepare/save with injected existing Buffer/crypto and no Node require',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../prototypes/stock-current-state/stockCurrentCommands.js'),'utf8');assert.equal(source.includes('require('),false);
 const runtime=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({createCurrentOrderFileSave,createOrderFileFencedStore});',{createHash:crypto.createHash,randomBytes:crypto.randomBytes,StockRuntimeBuffer:Buffer});
 const f=await fixture({department:'ACCOUNT',multi:true});f.deps.createFileProtocol=({request,staff})=>createSegmentedFencedProof({company:'NCT',store:runtime.createOrderFileFencedStore({company:'NCT',department:'ACCOUNT',request,staff,store:f.store,documentService:async command=>({ok:true,...command})}),domainWrites:true});
 const done=await runtime.createCurrentOrderFileSave(f.deps)(f.request);assert.equal(done.stockGeneration,1);assert.equal(f.counts().allocations,2);assert.equal(f.db.get('PurchaseOrders/'+done.poId).details.audit.length,1);
});
