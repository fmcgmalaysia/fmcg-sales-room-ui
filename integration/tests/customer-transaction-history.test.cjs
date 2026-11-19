const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectCustomerTransactionHistory:project}=load('customerTransactionHistory.js');
const clone=x=>JSON.parse(JSON.stringify(x)),at='2026-11-01T08:00:00Z';
function shipment(id,{company='NCT',customer='A',currency='USD',qty=40,price=16.8,status='DISPATCHED',number='SI-'+id,desk=2}={}){
 const line={taskId:'T-'+id,orderId:'O-'+customer,sourceLineId:'L-'+id,barcode:'SKU',name:'Product',packing:'24 x 1',quantity:qty,sources:[{sourceTaskId:'PRIVATE-SUPPLIER-SOURCE',quantity:qty}]};
 const base={id,company,customerId:customer,currency,desk,status:'REQUESTED',lines:[line]};
 const event=(revision,before,body)=>({title:revision,description:id,action:'CUSTOMER_SHIPMENT_CHANGED',result:'SAVED',activityTime:at,details:{beforeRevision:before,shipment:body}});
 const invoice={...base,status:'INVOICED',lines:[{...line,sellingPriceCtn:price,netCostCtn:12,rateToMyr:4,sourceSecret:'PRIVATE'}],invoice:{number,date:'2026-11-01',currency,amountCents:Math.round(qty*price*100),rateToMyr:4,at,by:'Staff',byStaffId:'PRIVATE-ID'}};
 return [event(id+'-R','',base),...(status==='REQUESTED'?[]:[event(id+'-I',id+'-R',invoice)]),...(status==='DISPATCHED'?[event(id+'-D',id+'-I',{...invoice,status,dispatch:{at,reference:'TEST-DO',reason:'PRIVATE NOTE'}})]:[])];
}
function document(id,{company='NCT',customerId='A',type='CUSTOMER_RECEIPT',currency='USD',amountCents=10000,...extra}={}){
 return {action:'CUSTOMER_ACCOUNT_DOCUMENT_SAVED',result:'SAVED',details:{document:{id,company,customerId,type,currency,amountCents,number:'REF-'+id,date:'2026-11-01',fileId:'file-test-'+id,sha256:'a'.repeat(64),at,by:'Staff',reason:'PRIVATE NOTE',...extra}}};
}
function support(id,{company='NCT',customerId='A',orderId='O-A',scope='ORDER',code='DO',invoiceId='',...extra}={}){
 return {action:'SUPPORT_DOCUMENT_UPLOADED',result:'SAVED',details:{document:{id,company,customerId,orderId,scope,code,invoiceId,fileId:'file-support-'+id,sha256:'b'.repeat(64),at,byStaffId:'PRIVATE-ID',name:code+'.pdf',size:100,amountCents:0,...extra}}};
}
const context=(activity,company='NCT')=>({company,activity,tasks:[{id:'T',customerId:'A',orderId:'O-A',netCostCtn:999,cbmPerCtn:99}],customers:[{id:'A',name:'A'},{id:'B',name:'B'}]});
test('dispatched portions enter history despite unpaid supplier; invoiced-only portions remain outside history but inside receivables',()=>{
 const c=context([...shipment('ONE'),...shipment('TWO',{status:'INVOICED',qty:60})]),before=JSON.stringify(c),r=project(c,'A');
 assert.equal(r.shipments.length,1);assert.equal(r.shipments[0].lines[0].quantity,40);assert.equal(r.account.entries.length,2);assert.equal(r.account.balances[0].invoiceCents,168000);assert.equal(JSON.stringify(c),before);
});
test('two receipts do not mark either of two invoices paid or allocate money twice',()=>{
 const r=project(context([...shipment('ONE',{qty:100,price:10}),...shipment('TWO',{qty:100,price:20}),document('FIRST',{amountCents:150000}),document('SECOND',{amountCents:150000})]),'A');
 assert.equal(r.account.balances[0].receiptCents,300000);assert.equal(r.account.balances[0].balanceCents,0);assert.equal(r.account.invoiceMatching,'EXPLICIT_ALLOCATIONS');assert.equal(r.transactions.reduce((n,row)=>n+row.dueCents,0),300000);assert.equal(r.account.unapplied.reduce((n,row)=>n+row.amountCents,0),300000);assert.equal(r.account.entries.filter(x=>x.type==='CUSTOMER_RECEIPT').length,2);assert.ok(r.shipments.every(x=>!('paid' in x)&&!('balanceCents' in x)));
});
test('prepayment, CN, debit and overpayment stay customer/currency postings rather than stock movements',()=>{
 const c=context([...shipment('ONE',{qty:100,price:10}),document('USD',{amountCents:120000}),document('SGD',{currency:'SGD',amountCents:99900}),document('CREDIT',{type:'SALES_CN',amountCents:5000}),document('DEBIT',{type:'DEBIT_NOTE',amountCents:2000})]);
 const r=project(c,'A');assert.equal(r.account.balances.find(x=>x.currency==='USD').balanceCents,-23000);assert.equal(r.account.balances.find(x=>x.currency==='SGD').balanceCents,-99900);assert.equal(r.shipments[0].lines[0].quantity,100);
});
test('customer B records and files never appear in customer A',()=>{
 const r=project(context([...shipment('ONE'),...shipment('TWO',{customer:'B'}),document('B',{customerId:'B'}),support('B',{customerId:'B',orderId:'O-B'})]),'A');
 assert.equal(r.shipments.length,1);assert.equal(r.account.entries.length,1);assert.equal(r.documents.length,0);assert.doesNotMatch(JSON.stringify(r),/O-B|REF-B/);
});
test('same invoice number in NCT and GHR has company-scoped identity and balances',()=>{
 const nct=project(context(shipment('N',{number:'SI-1'})),'A'),ghr=project(context(shipment('G',{company:'GHR',number:'SI-1',currency:'SGD',price:30}),'GHR'),'A');
 assert.notEqual(nct.shipments[0].id,ghr.shipments[0].id);assert.equal(nct.company,'NCT');assert.equal(ghr.company,'GHR');assert.equal(ghr.account.balances[0].currency,'SGD');
});
test('all approved Support customer files are visible without posting reference amounts',()=>{
 const r=project(context([...shipment('ONE'),...['SI','DO','CN','PL','CF','BL','INS','SO','BC','$'].map(code=>support(code==='$'?'PAYMENT':code,{code,...(code==='SI'?{scope:'INVOICE',invoiceId:'ONE'}:{}),...(code==='$'?{amountCents:100}: {})}))]),'A');
 assert.deepEqual(Array.from(r.documents,x=>x.code).sort(),['$','BC','BL','CF','CN','DO','INS','PL','SI','SO']);assert.equal(r.account.balances[0].balanceCents,67200);
});

test('private old PDFs expose no customer URL until same-file delivery is confirmed',()=>{
 const d=support('OLD'),c=context([d]);let r=project(c,'A');assert.equal(r.documents[0].ready,false);assert.equal(r.documents[0].url,null);
 c.activity.push({action:'CUSTOMER_DOCUMENT_DELIVERED',result:'SAVED',details:{document:{sourceDocumentId:'OLD',...Object.fromEntries(['company','customerId','fileId','sha256'].map(k=>[k,d.details.document[k]]))}}});
 r=project(c,'A');assert.equal(r.documents[0].ready,true);assert.equal(r.documents[0].url,'https://drive.google.com/file/d/file-support-OLD/view');
});
test('customer-level Support proof appears before any order, while replaced proof stays out of current library',()=>{
 const d=support('OLD',{scope:'CUSTOMER',orderId:'',code:'$',customerDeliveryVersion:1,customerLinkReady:true}),next=support('NEW',{scope:'CUSTOMER',orderId:'',code:'$',replacesDocumentId:'OLD',customerDeliveryVersion:1,customerLinkReady:true});
 const r=project({...context([d,next]),tasks:[]},'A');assert.equal(r.documents.length,1);assert.equal(r.documents[0].id,'NEW');assert.equal(r.documents[0].ready,true);assert.equal(r.account.entries.length,0);assert.equal(r.shipments.length,0);
});
test('wrong order, unrelated invoice and wrong Desk file cannot attach to a shipped invoice',()=>{
 const r=project(context([...shipment('ONE'),support('WRONG-ORDER',{orderId:'OTHER'}),support('WRONG-INVOICE',{scope:'INVOICE',invoiceId:'NO'}),support('WRONG-DESK',{scope:'DESK',desk:3,invoiceId:'ONE'}),support('RIGHT',{scope:'DESK',desk:2,invoiceId:'ONE'})]),'A');
 assert.equal(r.documents.length,1);assert.equal(r.shipments[0].documents[0].id,'RIGHT');
});
test('all fields are explicitly allowlisted; no procurement costs, private notes, FX or staff IDs leak',()=>{
 const r=project(context([...shipment('ONE'),document('PAY'),support('DO')]),'A');assert.doesNotMatch(JSON.stringify(r),/sourceTaskId|netCost|rateToMyr|sourceSecret|PRIVATE|byStaffId|reason/);assert.equal(r.shipments[0].lines[0].cbm,null);assert.equal(r.shipments[0].lines[0].netKg,null);
});
test('matching Sales PDF is attached without posting another receivable; duplicate Drive reference appears once in library',()=>{
 const s=support('SI',{code:'SI',scope:'INVOICE',invoiceId:'ONE'}),d=document('SI',{type:'SALES_INV',shipmentId:'ONE',number:'SI-ONE',amountCents:67200,fileId:s.details.document.fileId});
 const r=project(context([...shipment('ONE'),s,d]),'A');assert.equal(r.account.entries.length,1);assert.equal(r.account.balances[0].balanceCents,67200);assert.equal(r.documents.length,1);assert.equal(r.shipments[0].documents.length,1);
});
test('damaged invoice chain and unsafe file reference fail closed without writing or returning partial account',()=>{
 const broken=shipment('ONE');broken[2].details.shipment.lines[0].quantity=41;assert.throws(()=>project(context(broken),'A'),/Shipment|snapshot/);
 assert.throws(()=>project(context([document('BAD',{fileId:'javascript:alert(1)'})]),'A'),/file requires review/);
});
test('repeated reads are deterministic, non-mutating and create no journal or duplicate history',()=>{
 const c=context([...shipment('ONE'),document('PAY')]),before=clone(c),one=JSON.stringify(project(c,'A'));for(let i=0;i<100;i++)assert.equal(JSON.stringify(project(c,'A')),one);assert.deepEqual(c,before);
});
test('blank/invalid customer and company reject; customer without transactions returns empty genuine records',()=>{
 assert.throws(()=>project(context([]),''),/identity/);assert.throws(()=>project(context([],'INVALID'),'A'),/identity/);const r=project(context([]),'A');assert.equal(r.shipments.length,0);assert.equal(r.account.entries.length,0);assert.equal(r.account.balances.length,0);
});
