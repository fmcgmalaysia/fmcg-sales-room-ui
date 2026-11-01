'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),load=require('./load-master-module.cjs'),release=require('../prototypes/purchase-payment-message-20261031/stage.cjs').plan(),app=release.assets.get('purchase-live/app.js').toString(),chat=release.assets.get('master-shared/task-chat.js').toString();
function helper(name,next,source=app,scope={}){const text=source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'('));return vm.runInNewContext(text+';'+name,{...scope});}
const editable=helper('purchaseRequestEditable','purchaseFileRecord');
const pending=()=>({id:'PO',state:'ACTIVE',procurementContentLocked:false,procurementHandoff:{stage:'SUBMITTED',submitted:true,stale:false,submission:{at:'2026-10-30T17:18:00Z',paymentRequest:{requestedCents:10000}}}});
test('unpaid current request remains editable, but a paid, closed, unknown or reviewed request has no edit permission',()=>{
 assert.equal(editable(pending()),true);
 for(const change of [{procurementContentLocked:true},{procurementContentLocked:undefined},{invoiceChecked:true},{supplierAccount:{closed:true}},{paymentHandoff:{review:{}}},{procurementHandoff:{...pending().procurementHandoff,ownership:{}}}])assert.equal(editable({...pending(),...change}),false);
});
test('Requested retains22px capsule and original timestamp with a space instead of T',()=>{
 const cell=helper('purchasePaymentCell','requestQuote',app,{esc:String,shortTime:()=> '31-10-26 01:18'})(pending());assert.match(cell,/Requested/);assert.match(cell,/>31-10-26 01:18<\/small>/);assert.doesNotMatch(cell,/26T|data-po-request-edit/);
});
const {transitionProcurementHandoff,procurementSubmissionVersion,projectPaymentHandoff,paymentReviewVersion}=load('paymentHandoff.js');
function submitted(){const row={company:'NCT',id:'P',number:'PO',supplierId:'S',taskIds:['T'],amount:100,contentVersion:'V',paymentRequestRevision:'R',termDays:0,finance:{paidCents:0,creditAppliedCents:0,payments:[]},documents:[{fileId:'PO',type:'PO',linked:true},{fileId:'INV',type:'INV',linked:true,declaredCents:10000}]},details={procurementHandoff:{schema:1,stage:'SUBMITTED',submission:{version:'',at:'2026-10-31T01:00:00Z',byStaffId:'P',paymentRequest:{requestedCents:10000}}}};details.procurementHandoff.submission.version=procurementSubmissionVersion(row);return {row,details};}
const identity={by:'Buyer',byStaffId:'P',at:'2026-10-31T02:00:00Z'},input={action:'REQUEST_PAYMENT',reason:'Edit request',purpose:'FULL',requestedCents:10000,basisFileId:'INV',termDays:0};
test('stale browser cannot replace a submitted request after first payment, including deleted proof or subsequent refund',()=>{
 for(const variant of ['paid','deleted-proof','refunded']){const {row,details}=submitted(),payment={id:'PAY',cents:5000,confirmed:true,direction:'PAYMENT',proof:{linked:variant!=='deleted-proof'}};details.finance={payments:[payment,...(variant==='refunded'?[{...payment,id:'REF',direction:'REFUND'}]:[])]};const before=JSON.stringify(details);assert.throws(()=>transitionProcurementHandoff(row,details,input,identity,'PURCHASE'),/permanently locked/);assert.equal(JSON.stringify(details),before);}
});
test('payment lock does not change Finance50percent then50percent settlement arithmetic',()=>{
 const {row}=submitted();row.finance.payableCents=10000;const details={paymentHandoff:{review:{version:paymentReviewVersion(row),requestedCents:10000,paidAtReviewCents:0}}};row.finance.paidCents=5000;assert.equal(projectPaymentHandoff(row,details).paymentHandoff.status,'PARTLY_PAID');assert.equal(projectPaymentHandoff(row,details).paymentHandoff.balanceCents,5000);row.finance.paidCents=10000;assert.equal(projectPaymentHandoff(row,details).paymentHandoff.status,'PAID');
});
const {buildTaskChatWorkspace}=load('taskChatWorkspace.js');
test('existing PO facts become message presentation with actual department labels and no copied facts or changed visibility',()=>{
 const updates=[{id:'R',body:'Receiving updated'},{id:'D',body:'Supplier document uploaded'},{id:'P',body:'Payment or document recorded'}],data={company:'NCT',department:'PURCHASE',orders:[{company:'NCT',id:'PO',history:[{id:'D',action:'SUPPLIER_DOCUMENT_UPLOADED'},{id:'P',action:'ACCOUNT_DOCUMENT_UPLOAD',changes:{type:'PAYMENT'}}]}],delivery:[],legacy:{threads:[{id:'PO',updates}]}},before=JSON.stringify(data),out=buildTaskChatWorkspace(data).tasks[0].updates;
 assert.equal(out.length,3);assert.deepEqual(Array.from(out,u=>u.displayFrom),['WAREHOUSE','PURCHASE','ACCOUNT']);assert(out.every(u=>u.presentation==='MESSAGE'));assert.equal(out[0].from,undefined);assert.equal(out[1].from,undefined);assert.equal(out[2].from,'ACCOUNT');assert.equal(out[2].notify,true);assert.equal(JSON.stringify(data),before);
});
test('Message preview includes existing visible business updates without creating index or Drive message rows',async()=>{
 const {createTaskChatService}=load('taskChatService.js');let writes=0;const ops=createTaskChatService({hash:()=> 'a'.repeat(64),index:{find:async()=>[],insert:async()=>writes++,update:async()=>writes++},drive:async()=>{writes++;throw Error('No Drive call expected');},resolve:async()=>({tasks:[{kind:'PO',id:'PO',peers:['ACCOUNT'],updates:[{id:'R',presentation:'MESSAGE',displayFrom:'WAREHOUSE',body:'Receiving updated',at:'2026-10-31T01:00:00Z'},{id:'P',presentation:'MESSAGE',from:'ACCOUNT',body:'Payment proof uploaded',at:'2026-10-31T02:00:00Z',notify:true}]}]})});
 const thread=(await ops.list({company:'NCT',department:'PURCHASE',staff:{staffId:'P'}})).threads[0];assert.equal(thread.lastIncoming.id,'P');assert.equal(thread.updates.length,2);assert.equal(thread.unread,1);assert.equal(writes,0);
});
test('notification bubble and Message preview identify Finance instead of hard-coded Purchaser',()=>{
 const scope={english:false,department:'PURCHASE',esc:String,time:()=> '31 Oct, 02:00',current:{peer:'ACCOUNT'},dialog:{querySelector:()=>null}},start=chat.indexOf('function messageBody('),end=chat.indexOf('function renderBubbles(',start);vm.runInNewContext(chat.slice(start,end)+';this.show=decisionBubble;this.preview=messagePreview;',scope);const m={id:'P',presentation:'MESSAGE',from:'ACCOUNT',displayFrom:'ACCOUNT',body:'Payment proof uploaded',by:'LAW',at:'now',notify:true};assert.match(scope.show(m),/tc-bubble in/);assert.match(scope.show(m),/Finance Dept\. · LAW/);assert.match(scope.show(m),/data-tc-system="P"/);assert.match(scope.preview(m),/^Finance Dept\.: /);assert.doesNotMatch(scope.show(m),/Purchaser Dept/);
});
test('Finance bubbles stay English and existing Purchase decision bubbles keep their sender label',()=>{
 const start=chat.indexOf('function messageBody('),end=chat.indexOf('function renderBubbles(',start),scope={english:true,department:'ACCOUNT',esc:String,time:()=> '31 Oct, 02:00',current:{peer:'PURCHASE'}};vm.runInNewContext(chat.slice(start,end)+';this.show=decisionBubble;',scope);const html=scope.show({presentation:'MESSAGE',from:'PURCHASE',body:'Stop Waiting',bodyZh:'停止等货',by:'Buyer'});assert.match(html,/Purchaser Dept/);assert.match(html,/Stop Waiting/);assert.doesNotMatch(html,/停止等货/);
});
test('existing SEND, READ, ACK, request payloads and nonaffected static resources stay exact',()=>{
 const prior=release.baseline.get('master-shared/task-chat.js').toString();for(const [start,end]of [['async function loadPage','function enqueue'],['function enqueue','window.departmentMessages=']]){const range=s=>s.slice(s.indexOf(start),s.indexOf(end));assert.equal(range(chat),range(prior));}
 assert.equal(release.changed.length,6);assert.equal(release.assets.size,98);for(const [file,body]of release.assets)if(!release.changed.includes(file))assert(body.equals(release.baseline.get(file)),file);new vm.Script(app);new vm.Script(chat);
});
