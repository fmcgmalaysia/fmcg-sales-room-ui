const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {applyPurchaseProgress}=load('purchaseProgress.js');
function stage(overrides={},poOverrides={}){
 const row={id:'T',ord:100,inc:null,procurement:{totalCtn:100},stage:'NEW_INCOMING',archived:true,...overrides};
 const po={taskIds:['T'],documents:[],finance:{},...poOverrides};
 applyPurchaseProgress({company:'NCT',tasks:[row]},[],poOverrides===null?[]:[po]);return row;
}
test('progress uses current document and review facts without changing stored quantities',()=>{
 assert.equal(stage({},null).stage,'WAITING_FOR_PO');
 assert.equal(stage().stage,'WAITING_FOR_SUPPLIER_INV');
 const documents=[{type:'PI',linked:true}];
 assert.equal(stage({},{documents}).stage,'WAITING_FOR_ACC_REVIEW');
 assert.equal(stage({},{documents,paymentHandoff:{review:{stage:'REVIEWING'}}}).stage,'WAITING_FOR_PAYMENT');
 assert.equal(stage({},{documents,paymentHandoff:{status:'PAID',unreadCount:1}}).stage,'WAITING_FOR_PURCHASE_NOTED');
 const row=stage({},{documents,paymentHandoff:{status:'PAID',unreadCount:0}});assert.equal(row.stage,'WAITING_FOR_GOODS');assert.equal(row.ord,100);assert.equal(row.inc,null);assert.equal(row.archived,false);
});
test('credit terms and real receipts advance operational work independently of unpaid supplier liability',()=>{
 assert.equal(stage({},{documents:[{type:'INV',linked:true}],termDays:14}).stage,'WAITING_FOR_GOODS');
 assert.equal(stage({warehouse:{hasPhysicalReceipt:true,accepted:60,issue:false}}).stage,'WAITING_FOR_GOODS');
 assert.equal(stage({warehouse:{hasPhysicalReceipt:true,accepted:100,issue:false}}).stage,'WAITING_FOR_REPACKING');
 assert.equal(stage({warehouse:{hasPhysicalReceipt:true,accepted:90,issue:true},shortage:{customerDecision:'WAIT'}},{finance:{receiptResolved:true}}).stage,'WAITING_FOR_GOODS');
 assert.equal(stage({warehouse:{hasPhysicalReceipt:true,accepted:90,issue:true},shortage:{customerDecision:'STOP'}},{finance:{receiptResolved:true}}).stage,'WAITING_FOR_REPACKING');
});
test('additional supplier source follows its allocated invoice portions and never archives before dispatch and finance check',()=>{
 const base={id:'SHIP',company:'NCT',customerId:'C',currency:'MYR',lines:[{taskId:'CUSTOMER',quantity:10,sources:[{sourceTaskId:'CHILD',quantity:10}]}]};
 const events=[],push=(status)=>{const shipment={...base,status,...(status!=='REQUESTED'?{invoice:{number:'SI',amountCents:100000,currency:'MYR',rateToMyr:1}}:{})};events.push({title:'E'+events.length,action:'CUSTOMER_SHIPMENT_CHANGED',result:'SAVED',description:'SHIP',activityTime:'2026-10-12T03:00:00Z',details:{beforeRevision:events.at(-1)?.title||'',shipment}});};
 const row={id:'CHILD',procurementSource:true,ord:0,warehouse:{hasPhysicalReceipt:true,accepted:10},procurement:{totalCtn:10}},po={taskIds:['CHILD'],documents:[],invoiceChecked:true,paymentCompleted:true,finance:{receiptResolved:true}};
 const read=()=>applyPurchaseProgress({company:'NCT',tasks:[{...row}]},events,[po]).tasks[0];
 push('REQUESTED');push('INVOICED');assert.equal(read().stage,'WAITING_FOR_SHIPMENT');assert.equal(read().archived,false);
 push('DISPATCHED');po.invoiceChecked=false;assert.equal(read().archived,false);assert.equal(read().stage,'WAITING_FOR_ACC_REVIEW');
 po.invoiceChecked=true;assert.equal(read().stage,'SHIPPED');assert.equal(read().archived,true);
});
