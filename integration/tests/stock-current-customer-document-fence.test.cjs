const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {createCustomerDocumentFencedStore}=require('../prototypes/stock-current-state/customer-document-fenced-store.cjs'),{createCurrentSalesDocumentSave}=require('../prototypes/stock-current-state/current-sales-document-save.cjs');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs'),{WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs');
const {createCustomerAccountOperations,customerAccountVersion}=load('customerAccountLedger.js'),copy=value=>JSON.parse(JSON.stringify(value));
async function fixture(company='NCT'){
 const db=new Map(),files=new Map(),uploads=[],journal=company==='NCT'?'NCTActivity':'NCTActivity1';let allocations=0,auths=0,loseFile=false,loseEvent=false,late,reads=0;
 let staff={memberId:'SOURCE_SALES/S',staffId:'S',staffName:'Sales',customerId:'C',canSelectShipment:true,canUploadCustomerDocument:true};
 const store={read:async(c,id)=>copy(db.get(c+'/'+id)||null),insert:async(c,row)=>{if(db.has(c+'/'+row._id))throw Error('Duplicate');db.set(c+'/'+row._id,copy(row));if(loseEvent&&row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'){loseEvent=false;throw Error('Lost original event reply');}},
  compareAndSet:async(c,id,version,row)=>{if(db.get(c+'/'+id)?._version!==version)throw Error('Conflict');db.set(c+'/'+id,copy(row));},compareAndRemove:async(c,id,attempt)=>{if(db.get(c+'/'+id)?.attempt!==attempt)throw Error('Attempt changed');db.delete(c+'/'+id);}};
 const base=createSegmentedFencedProof({company,store,domainWrites:true});await base.initialize();Object.assign(db.get(journal+'/'+base.ids.controlId),{mode:'ACTIVE',schemaVersion:1,writerBuild:'TEST'});
 const context=()=>({company,activity:[...db.entries()].filter(([key])=>key.startsWith(journal+'/')).map(([,row])=>copy(row)),customers:[{id:'C',name:'Customer'}],tasks:[]});
 const documentService=async command=>{uploads.push(copy(command));assert.equal(command.action,'UPLOAD');if(files.has(command.fileId))assert.deepEqual(files.get(command.fileId),copy(command));else files.set(command.fileId,copy(command));if(late)await late();if(loseFile){loseFile=false;throw Error('Lost file reply');}return{ok:true,...command};};
 const deps={company,store,coverage:Object.fromEntries(WRITERS.map(writer=>[writer,{verified:true,build:'TEST'}])),authenticateOriginalDelegation:async()=>{auths++;return copy(staff);},
  readContext:async()=>{reads++;return context();},createCustomerAccountOperations,now:()=>new Date('2026-10-22T12:00:00Z'),allocateDocumentSlot:async selected=>{assert.equal(selected,company);return'Original_File_0000'+ ++allocations;},
  createDocumentProtocol:({request,staff})=>createSegmentedFencedProof({company,store:createCustomerDocumentFencedStore({company,staff,request,store,documentService}),domainWrites:true,stepsPerInvocation:1})};
 const request={requestId:'11111111-1111-4111-8111-111111111111',stockProtocol:1,stockBuild:'TEST',stockGeneration:0,stockIdentity:{staffId:'S',memberId:'SOURCE_SALES/S'},
  input:{action:'DOCUMENT',customerId:'C',type:'CUSTOMER_RECEIPT',number:'DOC-1',date:'2026-10-22',currency:'USD',amountCents:10000,reason:'Original file',base64:Buffer.from('%PDF-1.4\nOriginal').toString('base64'),version:customerAccountVersion(context())}};
 const save=createCurrentSalesDocumentSave(deps),finish=async()=>{for(let step=0;step<12;step++){const result=await save(request);if(result.ok)return result;assert.equal(result.pending,true);}throw Error('Unbounded file save');};
 return{company,journal,db,files,uploads,store,base,deps,request,save,finish,context,counts:()=>({allocations,auths,reads}),loseFile:()=>loseFile=true,loseEvent:()=>loseEvent=true,setStaff:value=>staff={...staff,...value},late:callback=>late=callback};
}
test('NCT/GHR original file posts once through bounded common fence, using immutable event itself as confirmation without extra CMS receipt',async()=>{
 for(const company of ['NCT','GHR']){const f=await fixture(company),first=await f.save(f.request);assert.equal(first.pending,true);assert.equal(f.files.size,0);assert.equal(f.counts().allocations,1);
  const final=await f.finish();assert.equal(final.company,company);assert.equal(final.stockGeneration,1);assert.equal(f.files.size,1);assert.equal(f.uploads.length,1);
  assert.equal([...f.db.values()].filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED').length,1);assert.equal([...f.db.values()].some(row=>/CONFIRMED/.test(row.action||'')),false);
  assert.equal(JSON.stringify([...f.db.values()]).includes(f.request.input.base64),false);assert.equal([...f.db.keys()].some(key=>/^(StockProducts|StockClaims|StockPositions|NCTTasks|NCTTasks1|PurchaseOrders)\//.test(key)),false);
  assert.deepEqual(await f.save(f.request),final);assert.equal(f.counts().allocations,1);assert.equal(f.uploads.length,1);
 }
});
test('lost upload reply retries same server file ID, lost CMS reply confirms exact event, and employee rename does not rewrite prepared identity',async()=>{
 const f=await fixture();await f.save(f.request);f.loseFile();await assert.rejects(f.save(f.request),/Lost file reply/);assert.equal(f.files.size,1);assert.equal([...f.db.values()].some(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'),false);
 f.setStaff({staffName:'Renamed Sales'});f.loseEvent();const final=await f.finish();assert.equal(final.ok,true);assert.equal(f.files.size,1);assert.equal(f.uploads.length,2);assert.equal(f.uploads[0].fileId,f.uploads[1].fileId);assert.equal(f.counts().allocations,1);
 assert.equal([...f.db.values()].find(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED').initiatedByStaffName,'Sales');
});
test('changed same UUID, another employee, closed coverage and stale original business input cannot allocate or upload a new file',async()=>{
 const f=await fixture();await f.save(f.request);await assert.rejects(f.save({...f.request,input:{...f.request.input,number:'DIFFERENT'}}),/identity|pending/);assert.equal(f.counts().allocations,1);assert.equal(f.files.size,0);
 f.setStaff({staffId:'OTHER'});await assert.rejects(f.save(f.request),/identity|delegation/);assert.equal(f.files.size,0);
 const closed=await fixture();closed.deps.coverage.RECEIPT.verified=false;await assert.rejects(closed.save(closed.request),/coverage/);assert.equal(closed.counts().allocations,0);
 const stale=await fixture();stale.request.input.version='STALE';await assert.rejects(stale.save(stale.request),/changed/);assert.equal(stale.counts().allocations,0);assert.equal(stale.files.size,0);
});
test('late file acknowledgement after checkpoint/owner change cannot insert original document or clear another owner lock',async()=>{
 const f=await fixture();await f.save(f.request);f.late(async()=>{const control=f.db.get(f.journal+'/'+f.base.ids.controlId);control._version='ADMIN_CHANGED';});
 await assert.rejects(f.save(f.request),/fence changed/);assert.equal(f.files.size,1);assert.equal([...f.db.values()].some(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'),false);
 const g=await fixture();await g.save(g.request);g.late(async()=>{g.db.get(g.journal+'/'+g.base.ids.lockId).attempt='OTHER_OWNER';});
 await assert.rejects(g.save(g.request),/Attempt changed/);assert.equal(g.db.get(g.journal+'/'+g.base.ids.lockId).attempt,'OTHER_OWNER');assert.equal([...g.db.values()].some(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'),false);
});
test('document event cannot be conditionally rewritten, deleted or disguised as protocol metadata',async()=>{
 const f=await fixture(),done=await f.finish(),row=[...f.db.values()].find(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'),staff={memberId:'SOURCE_SALES/S',staffId:'S',staffName:'Sales',customerId:'C',canSelectShipment:true,canUploadCustomerDocument:true};
 const adapter=createCustomerDocumentFencedStore({company:'NCT',staff,request:f.request,store:f.store,documentService:async()=>{throw Error('Unexpected file call');}});
 assert.throws(()=>adapter.compareAndSet(f.journal,done.documentId,row._version,{...row,stockOperationProtocol:2}),/insert-only/);
 assert.throws(()=>adapter.compareAndRemove(f.journal,done.documentId,'FORGED'),/exact owned/);
 await assert.rejects(adapter.insert(f.journal,{...row,action:'STOCK_PLAN_MANIFEST',stockOperationProtocol:2}),/fence/);
 assert.deepEqual(await f.store.read(f.journal,done.documentId),row);
});
test('mismatched upload receipt cannot append ledger event; correcting service resumes original retained slot without allocation',async()=>{
 const f=await fixture();f.deps.createDocumentProtocol=({request,staff})=>createSegmentedFencedProof({company:'NCT',store:createCustomerDocumentFencedStore({company:'NCT',request,staff,store:f.store,documentService:async command=>({ok:true,...command,sha256:'WRONG'})}),domainWrites:true,stepsPerInvocation:1});
 const bad=createCurrentSalesDocumentSave(f.deps);await bad(f.request);await assert.rejects(bad(f.request),/upload unconfirmed/);
 assert.equal([...f.db.values()].some(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED'),false);assert.equal(f.counts().allocations,1);
 const done=await f.finish();assert.equal(done.ok,true);assert.equal(f.counts().allocations,1);assert.equal(f.files.size,1);
});
test('generated private command runtime maps existing Buffer/crypto builtins and runs real original document prepare/save without Node require',async()=>{
 const folder=path.join(__dirname,'../prototypes/stock-current-state'),source=fs.readFileSync(path.join(folder,'stockCurrentCommands.js'),'utf8');
 assert.equal(source.includes('require('),false);assert.match(source,/import \{ Buffer as StockRuntimeBuffer \} from 'buffer'/);
 const runtime=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';({createCurrentSalesDocumentSave,createCustomerDocumentFencedStore});',{createHash:crypto.createHash,randomBytes:crypto.randomBytes,StockRuntimeBuffer:Buffer});
 const f=await fixture();f.deps.createDocumentProtocol=({request,staff})=>createSegmentedFencedProof({company:'NCT',store:runtime.createCustomerDocumentFencedStore({company:'NCT',request,staff,store:f.store,documentService:async command=>({ok:true,...command})}),domainWrites:true});
 const done=await runtime.createCurrentSalesDocumentSave(f.deps)(f.request);assert.equal(done.ok,true);assert.equal(done.stockGeneration,1);assert.equal(f.counts().allocations,1);assert.equal([...f.db.values()].filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED').length,1);
});
