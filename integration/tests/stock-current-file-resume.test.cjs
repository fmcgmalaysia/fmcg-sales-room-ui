const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createSegmentedFencedProof}=require('../prototypes/stock-current-state/segmented-fenced-proof.cjs');
const {createOrderFileFencedStore}=require('../prototypes/stock-current-state/order-file-fenced-store.cjs');
const {createCustomerDocumentFencedStore}=require('../prototypes/stock-current-state/customer-document-fenced-store.cjs');
const {createPurchaseDeleteProtocol}=require('../prototypes/stock-current-state/purchase-delete-protocol.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),CAS='CONTROL_CAS_CANDIDATE';
function fixtureFrom(name){const file=require.resolve('./'+name);return vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',{require:createRequire(file),Map,Buffer});}
const order=fixtureFrom('stock-current-order-file-fence.test.cjs'),customer=fixtureFrom('stock-current-customer-document-fence.test.cjs'),deletion=fixtureFrom('stock-current-purchase-delete-protocol.test.cjs');
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
async function setup(kind,coordination=CAS){
 const f=kind==='customer'?await customer():kind==='delete'?await deletion():await order(kind==='purchase'?{}:{department:'ACCOUNT',multi:kind==='account',proofDelete:kind==='proof'});
 const calls=[],files=new Map(),entered=deferred(),release=deferred();let hold=false,side='after',wrong=false;
 const service=async command=>{calls.push(copy(command));const held=hold;hold=false;
  if(held&&side==='before'){entered.resolve();await release.promise;}
  const old=files.get(command.fileId);if(old)assert.deepEqual(old,copy(command));else files.set(command.fileId,copy(command));
  if(held&&side==='after'){entered.resolve();await release.promise;}
  return{ok:true,...command,...(command.action==='TRASH'?{trashed:true}:{}),...(wrong?{sha256:'WRONG'}:{})};};
 if(kind==='customer')f.deps.createDocumentProtocol=({request,staff})=>createSegmentedFencedProof({company:'NCT',store:createCustomerDocumentFencedStore({company:'NCT',staff,request,store:f.store,documentService:service,coordination}),domainWrites:true,stepsPerInvocation:1,coordination});
 else f.deps.createFileProtocol=({request,staff})=>kind==='delete'?createPurchaseDeleteProtocol({company:'NCT',staff,request,store:f.store,documentService:service,coordination,stepsPerInvocation:1,now:()=>new Date('2026-10-24T02:00:00Z')}):createSegmentedFencedProof({company:'NCT',store:createOrderFileFencedStore({company:'NCT',department:kind==='purchase'?'PURCHASE':'ACCOUNT',staff,request,store:f.store,documentService:service,coordination}),domainWrites:true,stepsPerInvocation:1,coordination});
 f.save=kind==='customer'?require('../prototypes/stock-current-state/current-sales-document-save.cjs').createCurrentSalesDocumentSave(f.deps):require('../prototypes/stock-current-state/current-order-file-save.cjs').createCurrentOrderFileSave(f.deps);
 const finish=async()=>{for(let i=0;i<20;i++){const done=await f.save(f.request);if(done.ok)return done;}throw Error('Unbounded same-request resume');};
 const ids=(f.original||f.base).ids;
 return{...f,ids,finish,calls,files,entered,release,hold:value=>{hold=true;side=value;},wrong:value=>wrong=value};
}
for(const kind of ['purchase','account','proof','customer','delete'])test(kind+': CAS still rejects wrong receipts, changed payload and revoked actor before resuming',{timeout:3000},async()=>{
 const f=await setup(kind);await beforeCallback(f,kind);f.wrong(true);await assert.rejects(f.save(f.request),/unconfirmed/);
 const count=f.calls.length;await assert.rejects(f.save({...f.request,input:{...f.request.input,reason:'changed'}}),/pending|identity/);assert.equal(f.calls.length,count);
 const staffId=f.request.stockIdentity.staffId;f.setStaff({staffId:'REVOKED'});await assert.rejects(f.save(f.request),/actor|identity|delegation/);assert.equal(f.calls.length,count);
 f.setStaff({staffId});f.wrong(false);assert.equal((await f.finish()).ok,true);assert.equal(f.files.size,kind==='account'?2:1);
});
for(const kind of ['purchase','account','proof','delete'])test(kind+': a CMS write delayed after all callback checks cannot overwrite a later version',{timeout:3000},async()=>{
 const f=await setup(kind);await beforeCallback(f,kind);const reached=deferred(),release=deferred(),cas=f.store.compareAndSet;let held=false;
 f.store.compareAndSet=async(c,id,version,row)=>{if(!held&&c==='PurchaseOrders'&&(kind!=='delete'||row.details.documentDeletion===null)){held=true;reached.resolve();await release.promise;}return cas(c,id,version,row);};
 const old=f.save(f.request).then(value=>({value}),error=>({error}));try{await Promise.race([reached.promise,old.then(result=>{throw result.error||Error('CAS not held');})]);await f.finish();
  const row=await f.store.read('PurchaseOrders',f.request.input.id),later={...row,_version:'NEXT_VERSION',details:{...row.details,laterEdit:'retained'}};
  await cas('PurchaseOrders',row._id,row._version,later);release.resolve();assert.ok((await old).error);assert.deepEqual(copy(await f.store.read('PurchaseOrders',row._id)),copy(later));
 }finally{release.resolve();await old;}
});
async function beforeCallback(f,kind){
 for(let i=0;i<15;i++){await f.save(f.request);const control=await f.store.read(f.journal,f.ids.controlId);if(kind==='delete'?control.pending?.phase==='VERIFY'&&control.pending.cursor===1:control.pending?.phase==='BEFORE'&&control.pending.cursor===1)return;}
 throw Error('Missing pre-callback checkpoint');
}
for(const kind of ['purchase','account','proof','customer','delete']){
 test(kind+': existing exclusive lock cannot resume while the first file callback is still running',{timeout:3000},async()=>{
  const f=await setup(kind,'EXCLUSIVE_LOCK');await beforeCallback(f,kind);f.hold('after');const old=f.save(f.request).then(value=>({value}),error=>({error}));await f.entered.promise;
  try{await assert.rejects(f.save(f.request),/Duplicate/);assert.equal(f.db.has(f.journal+'/'+f.ids.lockId),true);}finally{f.release.resolve();await old;}
  assert.equal((await f.finish()).ok,true);
 });
 for(const side of ['before','after'])test(kind+': CAS resumes while old '+side+'-effect callback is unresolved; late return cannot overwrite a later edit',{timeout:3000},async()=>{
  const f=await setup(kind);await beforeCallback(f,kind);f.hold(side);let settled=false;const old=f.save(f.request).then(value=>({value}),error=>({error})).finally(()=>settled=true);
  try{await Promise.race([f.entered.promise,old.then(result=>{throw result.error||Error('Callback never held');})]);const done=await f.finish();assert.equal(done.stockGeneration,1);assert.equal(settled,false);assert.equal(f.db.has(f.journal+'/'+f.ids.lockId),false);
   if(kind!=='customer'){const row=await f.store.read('PurchaseOrders',f.request.input.id);await f.store.compareAndSet('PurchaseOrders',row._id,row._version,{...row,_version:'LATER_BUSINESS_VERSION',details:{...row.details,laterEdit:'preserved'}});}
   const before=copy([...f.db]);f.release.resolve();const result=await old;assert.ok(result.error,'old callback is rejected after control advances');assert.deepEqual(copy([...f.db]),before);
   assert.equal(f.files.size,kind==='account'?2:1);assert.equal([...f.db.values()].filter(row=>row.action==='CUSTOMER_ACCOUNT_DOCUMENT_SAVED').length,kind==='customer'?1:0);
   if(kind!=='customer'){const row=await f.store.read('PurchaseOrders',f.request.input.id);assert.equal(row.details.audit.length,1);assert.equal(row.details.laterEdit,'preserved');}
  }finally{f.release.resolve();await old;}
 });
}
