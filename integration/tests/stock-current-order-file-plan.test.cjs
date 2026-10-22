const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {captureOriginalOrderFilePlan}=require('../prototypes/stock-current-state/original-order-file-plan.cjs');
const {createPurchaseOrderOperations,projectPurchaseOrders}=load('purchaseOrderWorkflow.js'),{createAccountSettlementOperations}=load('accountSettlement.js');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs'),copy=value=>JSON.parse(JSON.stringify(value));
const file=require.resolve('./stock-current-purchase-order-record.test.cjs'),base=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',{require:createRequire(file),Map,Buffer});
const pdf=value=>Buffer.from('%PDF-1.4\n'+value).toString('base64');
function fixture(department='PURCHASE',company='NCT',saved=true){
 const f=base(company,saved),staff={memberId:'M',staffId:department==='PURCHASE'?'P':'A',staffName:department,role:department},
  suppliers=[{title:'S',bankName:'BANK',bankAccountNo:'123'}],rows=()=>projectPurchaseOrders({company,workspace:f.context,records:f.records});
 if(saved)for(const doc of f.records[0].details.documents)Object.assign(doc,{name:doc.type+'.pdf',uploadedByStaffId:staff.staffId,uploadedBy:staff.staffName,uploadedAt:'2026-10-21T00:00:00.000Z'});
 const input=extra=>({id:rows()[0].id,version:rows()[0].version,action:department==='PURCHASE'?'DOCUMENT':'DOCUMENT_UPLOAD',type:department==='PURCHASE'?'PI':'DO',
  number:'NEW1',date:'2026-10-22',reason:'Original file reason',base64:pdf('first'),...extra});
 const args=extra=>({...f.args,department,staff,rows:rows(),suppliers,createAccountSettlementOperations,input:input(extra),slots:['fixed_file_slot_0001']});
 return{...f,staff,suppliers,rows,input,args};
}
async function legacy(args){
 const journal=args.company==='NCT'?'NCTActivity':'NCTActivity1',db=new Map(args.records.map(row=>['PurchaseOrders:'+row._id,copy(row)])),effects=[],writes=[];let allocation=0;
 const store={all:async c=>c==='PurchaseOrders'?[...db].filter(([key])=>key.startsWith(c+':')).map(([,row])=>copy(row)):c==='SharedSuppliers'?copy(args.suppliers):(()=>{throw Error('Scope');})(),
  read:async(c,id)=>copy(db.get(c+':'+id)||null),insert:async(c,row)=>{if(db.has(c+':'+row._id))throw Error('Duplicate');db.set(c+':'+row._id,copy(row));if(c==='PurchaseOrders')writes.push(copy(row));return copy(row);},
  update:async(c,row)=>{db.set(c+':'+row._id,copy(row));if(c==='PurchaseOrders')writes.push(copy(row));return copy(row);},remove:async(c,id)=>db.delete(c+':'+id)};
 const documentService=async command=>{effects.push(copy(command));if(command.action==='ALLOCATE')return{ok:true,fileId:args.slots[allocation++]};return{ok:true,...command,base64:undefined,...(command.action==='TRASH'?{trashed:true}:{})};};
 const shared={store,documentService,now:args.now,names:{[args.company]:{activity:journal}}},operations=args.department==='PURCHASE'?createPurchaseOrderOperations({...shared,readWorkspace:async()=>copy(args.context)}):createAccountSettlementOperations({...shared,listOrders:async()=>copy(args.rows)});
 const result=await operations.save({company:args.company,staff:args.staff,requestId:args.requestId,input:args.input});
 return{result,record:db.get('PurchaseOrders:'+args.input.id),effects,writes};
}

test('both companies original Purchase upload preparation is pure and preserves exact original resulting record/name/audit',async()=>{
 for(const company of ['NCT','GHR'])for(const saved of [false,true]){
  const f=fixture('PURCHASE',company,saved),args=f.args(),before=JSON.stringify({context:f.context,records:f.records}),captured=await captureOriginalOrderFilePlan(args);
  assert.equal(JSON.stringify({context:f.context,records:f.records}),before);assert.equal(captured.uploads.length,1);assert.equal(captured.trash,null);
  assert.equal(captured.prepared.expected,saved?hash(f.records[0]):null);assert.equal(captured.uploads[0].name,'2026-10-22 SUP PI NEW1.pdf');
  const original=await legacy(args),expected=copy(captured.prepared.record);expected.details.documents.at(-1).url='https://drive.google.com/file/d/'+args.slots[0]+'/view';
  assert.deepEqual(original.record,expected);assert.equal(original.writes.length,1);assert.equal(original.result.poId,args.input.id);
  assert.equal(JSON.stringify(captured).includes('base64'),false);
 }
});

test('original Account DO and six-proof payment prepare preserve bank/direction/amount and exact original resulting record',async()=>{
 for(const company of ['NCT','GHR'])for(const type of ['DO','PAYMENT']){
  const f=fixture('ACCOUNT',company),args=f.args(type==='PAYMENT'?{type,cents:12300,paymentSource:'CASH',recipientChoice:'SUPPLIER',recipientBank:{bankName:'BANK',bankAccountNo:'123'},attachments:Array.from({length:5},(_,i)=>({base64:pdf('extra-'+i)}))}:{type});
  if(type==='PAYMENT')args.slots=Array.from({length:6},(_,i)=>'fixed_file_slot_000'+i);
  const before=JSON.stringify(f.records),captured=await captureOriginalOrderFilePlan(args),original=await legacy(args);
  assert.equal(JSON.stringify(f.records),before);assert.deepEqual(captured.prepared.record,original.record);assert.equal(captured.uploads.length,type==='PAYMENT'?6:1);
  assert.equal(JSON.stringify(captured).includes('base64'),false);assert.equal(captured.prepared.audit.actorStaffId,'A');
  if(type==='PAYMENT'){const payment=captured.prepared.record.details.finance.payments.at(-1);assert.equal(payment.cents,12300);assert.equal(payment.proofs.length,6);assert.deepEqual(payment.recipientBank,{bankName:'BANK',bankAccountNo:'123'});assert.equal(captured.uploads.every(command=>command.department==='ACCOUNT'),true);}
 }
});

test('original existing-payment attachment changes no recorded amount and preserves refund restrictions',async()=>{
 const f=fixture('ACCOUNT');f.records[0].details.finance={payments:[{id:'PAY',cents:500,confirmed:true,reference:'OLD',date:'2026-10-21',proof:{fileId:'old_payment_proof',linked:true,sha256:'old'}}]};
 const args=f.args({type:'PAYMENT',paymentId:'PAY'}),captured=await captureOriginalOrderFilePlan(args),original=await legacy(args);
 assert.deepEqual(captured.prepared.record,original.record);assert.equal(captured.prepared.record.details.finance.payments.length,1);assert.equal(captured.prepared.record.details.finance.payments[0].cents,500);
 assert.equal(captured.prepared.record.details.finance.payments[0].proofs.length,2);
 await assert.rejects(captureOriginalOrderFilePlan(f.args({type:'PAYMENT',direction:'REFUND',cents:99999})),/Refund cannot exceed/);
});

test('Purchase deletion captures original pending-unlink contract, never substitutes an upload-style single final write',async()=>{
 const f=fixture(),args={...f.args({action:'DELETE_DOCUMENT',fileId:'PO'}),slots:[]},before=JSON.stringify(f.records),captured=await captureOriginalOrderFilePlan(args),original=await legacy(args);
 assert.equal(JSON.stringify(f.records),before);assert.equal(captured.prepared.record,undefined);assert.equal(captured.uploads.length,0);assert.equal(captured.trash.fileId,'PO');
 assert.equal(captured.prepared.expected,hash(f.records[0]));assert.equal(original.writes.length,2,'original unlink-before-trash plus final audit are distinct');
 assert.equal(original.writes[0].details.documents[0].linked,false);assert.equal(original.writes[0].details.documentDeletion.requestId,args.requestId);
 assert.equal(original.record.details.documents[0].deletion.state,'DELETED');assert.equal(original.record.details.audit[0].id,captured.prepared.event.id);
 assert.equal(original.effects[0].action,'TRASH');
});

test('Account proof deletion preserves original uploader/admin policy and exact after-image without changing stock or amount',async()=>{
 for(const company of ['NCT','GHR']){
  const f=fixture('ACCOUNT',company);f.records[0].details.finance={payments:[{id:'PAY',cents:100,confirmed:true,proof:{fileId:'proof_to_delete',name:'proof.pdf',linked:true,sha256:'hash',uploadedByStaffId:'A'}}]};
  const args={...f.args({action:'PAYMENT_FILE_DELETE',paymentId:'PAY',fileId:'proof_to_delete'}),slots:[]},captured=await captureOriginalOrderFilePlan(args),original=await legacy(args);
  assert.deepEqual(captured.prepared.record,original.record);assert.equal(captured.trash.department,'ACCOUNT');assert.equal(captured.prepared.record.details.finance.payments[0].cents,100);
  assert.equal(f.records[0].details.finance.payments[0].deletedProofs,undefined);
  args.staff={...args.staff,staffId:'OTHER'};await assert.rejects(captureOriginalOrderFilePlan(args),/uploader/);
  args.staff.role='SUPER ADMIN';assert.equal((await captureOriginalOrderFilePlan(args)).prepared.audit.actorStaffId,'OTHER');
 }
});

test('original PDF, duplicate, stale version, supplier bank, issue and financial locks execute before any external effect',async()=>{
 const f=fixture();for(const patch of [{base64:'bad'},{version:'OLD'},{reason:''},{type:'INV',declaredCents:0},{issueId:'missing'}])await assert.rejects(captureOriginalOrderFilePlan(f.args(patch)));
 f.records[0].details.documentDeletion={requestId:'OTHER'};await assert.rejects(captureOriginalOrderFilePlan(f.args()),/deletion is pending/);
 const a=fixture('ACCOUNT');await assert.rejects(captureOriginalOrderFilePlan(a.args({type:'PAYMENT',cents:200,recipientChoice:'SUPPLIER',paymentSource:'CASH',recipientBank:{bankName:'BANK',bankAccountNo:'WRONG'}})),/bank account/);
 const duplicate=a.args({type:'PAYMENT',cents:200,recipientChoice:'OTHER',paymentSource:'CASH',attachments:[{base64:pdf('first')}]});duplicate.slots.push('fixed_file_slot_0002');await assert.rejects(captureOriginalOrderFilePlan(duplicate),/already selected/);
 const d=fixture();d.records[0].details.documents[0].uploadedByStaffId='OTHER';await assert.rejects(captureOriginalOrderFilePlan({...d.args({action:'DELETE_DOCUMENT',fileId:'PO'}),slots:[]}),/original uploader/);
});

test('unmigrated/foreign records, reused slots or unrelated prepared record changes are refused without legacy apply',async()=>{
 const f=fixture();delete f.records[0]._version;await assert.rejects(captureOriginalOrderFilePlan(f.args()),/context required/);
 const g=fixture();g.records[0].company='GHR';await assert.rejects(captureOriginalOrderFilePlan(g.args()),/context required/);
 const h=fixture(),args=h.args();args.slots=['bad'];await assert.rejects(captureOriginalOrderFilePlan(args),/context required/);
 const altered=h.args();altered.createPurchaseOrderOperations=deps=>createPurchaseOrderOperations({...deps,store:{...deps.store,insert:async(c,row)=>{
  if(row.details?.kind==='PREPARED')row.details.plan.record.details.stockSentinel=99;return deps.store.insert(c,row);
 }}});await assert.rejects(captureOriginalOrderFilePlan(altered),/unrelated/);assert.equal(h.records[0].details.stockSentinel,undefined);
 const external=h.args();external.createPurchaseOrderOperations=deps=>({save:async()=>deps.documentService({action:'TRASH',company:'NCT'})});await assert.rejects(captureOriginalOrderFilePlan(external),/External/);
});
