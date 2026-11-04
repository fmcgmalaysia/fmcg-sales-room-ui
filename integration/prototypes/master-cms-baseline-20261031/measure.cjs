// Diagnostic only: executes existing writers against isolated in-memory stores.
// No network, Wix deployment, credentials, or production data writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),tests=path.join(root,'integration/tests'),backend=path.join(root,'integration/backend');
const clone=x=>JSON.parse(JSON.stringify(x)),bytes=x=>Buffer.byteLength(JSON.stringify(x));
const hashes={};
function load(name,cache={}){
 if(cache[name])return cache[name];
 // Independent production receiving repair is deliberately absent from checkout.
 let source=name==='warehouseReceiving.js'?execFileSync('git',['show','fc76b37:integration/backend/'+name],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(backend,name),'utf8');
 hashes[name]=require('node:crypto').createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
 const bindings={};source=source.replace(/^import \{([^}]+)\} from '([^']+)';\r?$/gm,(_,names,target)=>{const result=target.startsWith('backend/')?load(target.slice(8),cache):require(target);for(const part of names.split(',')){const [a,b]=part.trim().split(/\s+as\s+/);bindings[b||a]=result[a];}return '';});
 const names=[...source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(x=>x[1]);
 cache[name]=vm.runInNewContext('(function(){'+source.replace(/^export /gm,'')+'\nreturn {'+names.join(',')+'};})()', {...bindings,Date,JSON,Error,Object,Array,Number,Promise,Set,Map,String,Math});return cache[name];
}
function fixture(file,name='fixture'){
 const filename=path.join(tests,file),local=createRequire(filename),module={exports:{}};
 const req=id=>id==='node:test'?()=>{}:id==='./load-master-module.cjs'?load:local(id);
 vm.runInNewContext('(function(require,module,exports,__filename,__dirname){'+fs.readFileSync(filename,'utf8')+'\nmodule.exports={'+name+'};})',{Buffer,Date,console,process})(req,module,module.exports,filename,tests);
 return module.exports[name]();
}
function observed(store,rows){
 const log=[];let peak=rows.size;
 for(const name of ['read','all','one','insert','update','remove'])if(store[name]){
  const original=store[name];store[name]=async(...args)=>{const entry={name,collection:args[0],inputBytes:bytes(args)};log.push(entry);const result=await original(...args);entry.returnedRows=Array.isArray(result)?result.length:result&&typeof result==='object'?1:0;entry.returnedBytes=bytes(result??null);peak=Math.max(peak,rows.size);return result;};
 }
 return {log,peak:()=>peak};
}
const measurements=[];
function snapshot(rows){return new Map([...rows].map(([key,value])=>[key,JSON.stringify(value)]));}
async function measure(label,rows,obs,fn){
 const before=snapshot(rows),start=obs.log.length,result=await fn(),after=snapshot(rows),calls=obs.log.slice(start),added=[...after].filter(([key])=>!before.has(key)),changed=[...after].filter(([key,value])=>before.has(key)&&before.get(key)!==value);
 const byAction={};for(const [,text]of added){const row=JSON.parse(text),key=row.action||row.details?.kind||'ENTITY';byAction[key]=(byAction[key]||0)+1;}
 const out={label,retainedAdditional:after.size-before.size,newRows:added.length,updatedRows:changed.length,newByAction:byAction,retainedJsonByteDelta:[...after.values()].reduce((n,x)=>n+Buffer.byteLength(x),0)-[...before.values()].reduce((n,x)=>n+Buffer.byteLength(x),0),calls:Object.fromEntries(['read','all','one','insert','update','remove'].map(name=>[name,calls.filter(x=>x.name===name).length])),allRowsReturned:calls.filter(x=>x.name==='all').reduce((n,x)=>n+x.returnedRows,0)};
 measurements.push(out);return result;
}
async function repeated(label,rows,obs,fn){const result=await measure(label,rows,obs,fn);assert.equal(measurements.at(-1).retainedAdditional,0,label);assert.equal(measurements.at(-1).calls.insert,0,label);return result;}
async function run(){
 // Real intake core: one order is two entities + initial cost per line and two markers.
 const rows=new Map(),store={read:async(c,id)=>clone(rows.get(c+'/'+id)||null),insert:async(c,row)=>{assert(!rows.has(c+'/'+row._id));rows.set(c+'/'+row._id,clone(row));return row;}},obs=observed(store,rows),{createNctIntake,createNctReceiptReader}=load('nctIntake.js');
 const intake=createNctIntake({store,captureCosts:async codes=>Object.fromEntries(codes.map(unitBarcode=>[unitBarcode,{unitBarcode,costCurrency:'MYR',costStatus:'CAPTURED',costIssues:[],capturedAt:'2026-10-31T00:00:00Z',lpPc:1,lpCtn:12,disc1:0,disc2:0,disc3:0,netCostCtn:12,cbmPerCtn:.01}]))});
 const body={sourceSiteId:'5292b63a-30e5-4c0e-8762-a1b127bbc651',destination:'NCT',orderId:'SYNTHETIC-CMS',customerId:'C',customerCompanyName:'SYNTHETIC',submissionId:'SUB',submittedByStaffId:'S',submittedByStaffName:'TEST',transactionCurrency:'USD',fxRate:4,submittedAt:'2026-10-31T00:00:00Z',lines:Array.from({length:10},(_,i)=>({sourceLineId:'L'+i,unitBarcode:'SKU'+i,itemName:'SYNTHETIC',packingSize:'12 x1',qtyCtn:100,eaPerCtn:12,sellingPricePc:2}))};
 await measure('intake:10 lines',rows,obs,()=>intake(body));assert.equal(rows.size,32);
 await repeated('intake:same submission replay',rows,obs,()=>intake(body));
 await repeated('intake:receipt read only',rows,obs,()=>createNctReceiptReader({store})(body));
 const p=fixture('purchase-operations.test.cjs'),pobs=observed(p.store,p.rows),{taskEditVersion}=load('purchaseTaskIdentity.js');
 const plan={...p.base,operation:'PLAN',input:{taskId:p.id,version:taskEditVersion(p.task()),transportMode:'SUPPLIER_DELIVER',planRevision:'',totalCtn:250,reason:'',costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:250,freeCtn:0,prices:{lpPc:1,lpCtn:16,disc1:0,disc2:0,disc3:0}}}};
 await measure('purchase:plan one source',p.rows,pobs,()=>p.operate(plan));await repeated('purchase:plan original replay',p.rows,pobs,()=>p.operate(plan));
 const po={...p.base,requestId:'22222222-2222-4222-8222-222222222222',operation:'PO',input:{taskIds:[p.id],versions:p.versions(),poNumber:'SYNTHETIC-PO'}};
 await measure('purchase:create PO one source',p.rows,pobs,()=>p.operate(po));await repeated('purchase:PO original replay',p.rows,pobs,()=>p.operate(po));
 const w=fixture('warehouse-receiving.test.cjs'),wobs=observed(w.store,w.records),w1={...w.base,input:await w.input(80)};
 await measure('warehouse:receipt first80',w.records,wobs,()=>w.operations.save(w1));await repeated('warehouse:receipt original replay',w.records,wobs,()=>w.operations.save(w1));
 await measure('warehouse:receipt second20',w.records,wobs,async()=>w.operations.save({...w.base,requestId:'22222222-2222-4222-8222-222222222222',input:await w.input(20,'DELIVERY')}));
 const a=fixture('customer-allocation-save.test.cjs'),aobs=observed(a.store,a.records),ar={...a.base,input:a.input()};
 await measure('purchase:own200+free20+borrow30',a.records,aobs,()=>a.save(ar));await repeated('purchase:allocation original replay',a.records,aobs,()=>a.save(ar));
 const {readAllocationLoans}=load('customerAllocationContext.js');const loan=readAllocationLoans(a.activity())[0];a.tasks.push({...a.tasks[2],id:'NEW',warehouse:{hasPhysicalReceipt:true,accepted:30},procurement:{totalCtn:30,customerCtn:0,expectedExtra:30}});
 const repay={...a.base,requestId:'22222222-2222-4222-8222-222222222222',input:{action:'ALLOCATE',planMode:'REPAY',version:a.version(),loanId:loan.id,quantity:30}};
 await measure('purchase:repay30',a.records,aobs,()=>a.save(repay));await repeated('purchase:repay original replay',a.records,aobs,()=>a.save(repay));assert.equal(readAllocationLoans(a.activity())[0].outstanding,0);
 const d=await fixture('desk-delivery.test.cjs','setup'),dobs=observed(d.store,d.records),send=await d.sendRequest();
 const sent=await measure('support:open Desk task',d.records,dobs,()=>d.packingSave(send));await repeated('support:Desk original replay',d.records,dobs,()=>d.packingSave(send));
 const loaded=await d.loadRequest(sent.list,80);await measure('warehouse:Loaded80 of100',d.records,dobs,()=>d.packingSave(loaded));await repeated('warehouse:Loaded original replay',d.records,dobs,()=>d.packingSave(loaded));assert.equal((await d.stock()).onHand,70);
 const q=fixture('purchase-margin-refresh.test.cjs'),qobs=observed(q.store,q.rows);await measure('read:changed GP cache',q.rows,qobs,()=>q.refresh(q.input()));await repeated('read:unchanged GP cache',q.rows,qobs,()=>q.refresh(q.input()));
 const f=fixture('account-settlement.test.cjs'),frows=new Map([['PurchaseOrders/PO',{_id:'PO',company:'NCT',details:f.details}]]),fstore={read:async(c,id)=>clone(frows.get(c+'/'+id)||null),insert:async(c,row)=>{assert(!frows.has(c+'/'+row._id));frows.set(c+'/'+row._id,clone(row));return row;},update:async(c,row)=>{frows.set(c+'/'+row._id,clone(row));return row;},remove:async(c,id)=>frows.delete(c+'/'+id)},fobs=observed(fstore,frows),{createAccountSettlementOperations,projectAccountSettlement}=load('accountSettlement.js');
 const listOrders=async()=>{const details=frows.get('PurchaseOrders/PO').details;return [{...f.row,version:JSON.stringify(details),supplierShortName:'SYNTHETIC',...projectAccountSettlement(f.row,details)}];};
 let docSerial=0;const payments=createAccountSettlementOperations({store:fstore,listOrders,documentService:async input=>input.action==='ALLOCATE'?{fileId:'SYNTHETIC-'+(++docSerial)}:{...input,ok:true},names:{NCT:{activity:'NCTActivity'}}});
 for(const seq of [1,2]){const request={company:'NCT',staff:{memberId:'M',staffId:'F',staffName:'TEST'},requestId:String(seq).padStart(8,'0')+'-3333-4333-8333-333333333333',input:{id:'PO',version:(await listOrders())[0].version,action:'DOCUMENT_UPLOAD',type:'PAYMENT',recipientChoice:'OTHER',paymentSource:'CASH',date:'2026-10-31',number:'SYNTHETIC-'+seq,cents:50000,base64:Buffer.from('%PDF-1.4\nSYNTHETIC-'+seq).toString('base64'),reason:'Synthetic existing payment'}};await measure('finance:payment50% #'+seq,frows,fobs,()=>payments.save(request));await repeated('finance:payment original replay #'+seq,frows,fobs,()=>payments.save(request));}
 assert.equal((await listOrders())[0].finance.paidCents,100000);assert.equal(frows.get('PurchaseOrders/PO').details.finance.payments.length,2);
 return {kind:'ISOLATED_CURRENT_WRITER_FOOTPRINT',productionWrites:0,networkLatencyMeasured:false,receivingSource:'fc76b37 (independent deployed fix)',sourceHashes:hashes,measurements};
}
if(require.main===module)run().then(result=>{const destination=process.argv[2];if(destination)fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.measurements,null,2));}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,load,observed,fixture};
