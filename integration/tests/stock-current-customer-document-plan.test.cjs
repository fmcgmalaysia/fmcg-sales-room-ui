const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {captureOriginalCustomerDocumentPlan,assertCustomerDocumentPlan,uploadCustomerDocumentSlot}=require('../prototypes/stock-current-state/customer-document-plan.cjs');
const {createCustomerAccountOperations,customerAccountVersion}=load('customerAccountLedger.js'),copy=value=>JSON.parse(JSON.stringify(value));
function fixture(company='NCT',type='CUSTOMER_RECEIPT'){
 const context={company,activity:[],customers:[{id:'C',name:'Customer: Test'}]},staff={memberId:'SOURCE_SALES/S',staffId:'S',staffName:'Sales',customerId:'C',canSelectShipment:true,canUploadCustomerDocument:true};
 const input={action:'DOCUMENT',type,customerId:'C',number:'DOC/1',date:'2026-10-22',currency:'usd',amountCents:10000,reason:'Original document',shipmentId:'',base64:Buffer.from('%PDF-1.4\nOriginal PDF').toString('base64'),version:customerAccountVersion(context)};
 const args={company,staff,input,context,requestId:'11111111-1111-4111-8111-111111111111',slot:'Original_File_00001',createCustomerAccountOperations,now:()=>new Date('2026-10-22T12:00:00Z')};
 return{args,capture:()=>captureOriginalCustomerDocumentPlan(args)};
}
test('original customer receipt/CN/debit prepare keeps all original fields and fixed file descriptor, without a legacy write or upload',async()=>{
 for(const company of ['NCT','GHR'])for(const type of ['CUSTOMER_RECEIPT','SALES_CN','DEBIT_NOTE']){
  const f=fixture(company,type),before=JSON.stringify(f.args.context),plan=await f.capture();assert.equal(plan.event.action,'CUSTOMER_ACCOUNT_DOCUMENT_SAVED');assert.equal(plan.upload.action,'UPLOAD');assert.equal(plan.upload.department,'SALES');assert.equal(plan.upload.fileId,f.args.slot);
  assert.equal(plan.event.details.document.amountCents,10000);assert.equal(plan.event.details.document.currency,'USD');assert.equal(plan.event.details.document.name,'2026-10-22 Customer- Test '+type+' DOC-1.pdf');
  assert.equal(JSON.stringify(plan).includes(f.args.input.base64),false);assert.equal(JSON.stringify(f.args.context),before);assert.equal(assertCustomerDocumentPlan({...f.args,plan}),true);
 }
});
test('original Source role, customer, version, date, amount, duplicate and PDF checks still refuse rather than being reimplemented or relaxed',async()=>{
 for(const change of ['permission','source','customer','version','date','amount','pdf','canonical','size']){
  const f=fixture();if(change==='permission')f.args.staff.canUploadCustomerDocument=false;if(change==='source')f.args.staff.memberId='MASTER/S';if(change==='customer')f.args.input.customerId='OTHER';if(change==='version')f.args.input.version='STALE';if(change==='date')f.args.input.date='2026-02-30';if(change==='amount')f.args.input.amountCents=0;if(change==='pdf')f.args.input.base64=Buffer.from('NOTPDF').toString('base64');if(change==='canonical')f.args.input.base64+='=';if(change==='size')f.args.input.base64=Buffer.from('%PDF-'+ 'x'.repeat(3*1024*1024)).toString('base64');
  await assert.rejects(f.capture(),/authorized|scope|delegation|changed|date|PDF|Enter|valid/);
 }
 const f=fixture(),plan=await f.capture();f.args.context.activity.push(plan.event);f.args.input.version=customerAccountVersion(f.args.context);await assert.rejects(f.capture(),/already recorded/);
});
test('Sales Invoice attachment still requires exact original Support invoice and cannot post or synthesize one',async()=>{
 const f=fixture('NCT','SALES_INV');await assert.rejects(f.capture(),/must match/);
 // Use ORIGINAL ledger event shape to supply an already-existing invoice, not a
 // new invoice operation. No current or live invoice is created by this test.
 const shipment={id:'SHIP',company:'NCT',customerId:'C',currency:'USD',status:'REQUESTED',lines:[{taskId:'T',quantity:1,sources:[{sourceTaskId:'T',quantity:1}]}]};
 f.args.context.activity.push({_id:'OLD',title:'OLD',description:'SHIP',action:'CUSTOMER_SHIPMENT_CHANGED',result:'SAVED',activityTime:'2026-10-20T00:00:00Z',details:{beforeRevision:'',shipment:copy(shipment)}});
 f.args.context.activity.push({_id:'INVOICE',title:'INVOICE',description:'SHIP',action:'CUSTOMER_SHIPMENT_CHANGED',result:'SAVED',activityTime:'2026-10-21T00:00:00Z',details:{beforeRevision:'OLD',shipment:{...shipment,status:'INVOICED',invoice:{number:'DOC/1',date:'2026-10-22',currency:'USD',amountCents:10000,rateToMyr:4}}}});
 f.args.input.shipmentId='SHIP';f.args.input.version=customerAccountVersion(f.args.context);
 const plan=await f.capture();assert.equal(plan.event.details.document.shipmentId,'SHIP');assert.equal(f.args.context.activity.length,2);
 f.args.input.amountCents++;await assert.rejects(f.capture(),/must match/);
});
test('upload utility sends only exact original immutable file identity and PDF; altered descriptor/content or wrong receipt never confirms',async()=>{
 const f=fixture(),plan=await f.capture(),calls=[];
 const documentService=async command=>{calls.push(copy(command));return{ok:true,...plan.upload};};
 const receipt=await uploadCustomerDocumentSlot({...f.args,plan,documentService});assert.equal(receipt.fileId,f.args.slot);assert.deepEqual(calls,[{...plan.upload,base64:f.args.input.base64}]);
 for(const changed of [{...plan,upload:{...plan.upload,fileId:'Other_File_00001'}},{...plan,event:{...plan.event,initiatedByStaffId:'OTHER'}}])await assert.rejects(uploadCustomerDocumentSlot({...f.args,plan:changed,documentService}),/conflict/);
 await assert.rejects(uploadCustomerDocumentSlot({...f.args,input:{...f.args.input,base64:Buffer.from('%PDF-Changed').toString('base64')},plan,documentService}),/conflict/);
 await assert.rejects(uploadCustomerDocumentSlot({...f.args,plan,documentService:async()=>({ok:true,...plan.upload,sha256:'OTHER'})}),/unconfirmed/);assert.equal(calls.length,1);
});
