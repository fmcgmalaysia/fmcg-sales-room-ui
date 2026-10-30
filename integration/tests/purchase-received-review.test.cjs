'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const prior=require('../prototypes/purchase-personal-row-order-20261030/stage.cjs').plan();
const {patch}=require('../prototypes/purchase-received-review-20261031/patch.cjs');
const source=patch(prior.assets.get('purchase-live/app.js').toString());
function render(item){
 const calls=[],classes=[],nodes={receiptSolution:{value:''},receiptStopOptions:{hidden:true,querySelectorAll:()=>[]}};
 const begin=source.indexOf('  function receiptDecisionEditor('),end=source.indexOf('  function quantityCaseEditor(',begin);
 const run=vm.runInNewContext('(()=>{let dialogContext;'+source.slice(begin,end)+';return {open:receiptDecisionEditor,context:()=>dialogContext};})()',{
  formDialog:(title,po,body,actions,kind)=>calls.push({title,po,body,actions,kind}),qtyDigits:String,
  esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
  modal:{classList:{add:name=>classes.push(name)}},document:{querySelector:s=>nodes[s.slice(1)]}
 });
 const before=JSON.stringify(item);run.open({id:'TASK',po:'SYNTHETIC-PO'},item);
 assert.equal(JSON.stringify(item),before,'opening review must not mutate the shared case');
 return {...calls[0],context:run.context(),classes};
}
const complete={kind:'RECEIPT',id:'CASE',planned:100,accepted:100,quantity:0,receivingIssue:false,warehouseFeedback:{reason:'Prior short delivery <historical>'},financeRequired:true,status:'OPEN',owner:'ACCOUNT'};
test('a replenished receipt retains history and financial review without another Purchase decision',()=>{
 const r=render(complete);assert.equal(r.title,'Receipt Review 收货核对');assert.match(r.body,/Goods received in full/);
 assert.match(r.body,/原收货异常保留供财务核对/);assert.match(r.body,/100 CTN/);assert.match(r.body,/0 CTN/);
 assert.match(r.body,/Prior short delivery &lt;historical>/);assert.equal(r.actions,'');
 assert(r.classes.includes('receipt-feedback-dialog'),'retain the compact receiving dialog layout');
 assert.doesNotMatch(r.body,/receiptSolution|saveReceiptDecision|below the P.O.|Stop waiting/);
 assert.equal(r.context.kind,'receipt-review');assert.equal(complete.financeRequired,true);assert.equal(complete.status,'OPEN');
});
test('an actual remaining shortage retains its existing actionable supplier decision',()=>{
 const r=render({...complete,accepted:70,quantity:30,receivingIssue:true});assert.equal(r.title,'Receiving Shortfall 收货差额');
 assert.match(r.body,/below the P.O./);assert.match(r.body,/receiptSolution/);assert.match(r.actions,/saveReceiptDecision/);
 assert.equal(r.context.kind,'quantity-case');
});
for(const issue of [true,undefined])test('zero missing quantity does not hide unresolved or unknown receipt state: '+issue,()=>{
 const r=render({...complete,receivingIssue:issue});assert.match(r.actions,/saveReceiptDecision/);assert.notEqual(r.context.kind,'receipt-review');
});
test('unknown missing quantity is never presented as received in full',()=>{
 const r=render({...complete,quantity:null});assert.notEqual(r.context.kind,'receipt-review');assert.match(r.actions,/saveReceiptDecision/);
});
test('the assembled client remains valid and the new review uses the existing dialog without a new write action',()=>{
 assert.doesNotThrow(()=>new vm.Script(source));
 assert.match(source,/Receipt review 收货核对/);
 const added=source.slice(source.indexOf("if(item.quantity===0&&item.receivingIssue===false)"),source.indexOf('    const decision=item.decision||{},current='));
 assert.doesNotMatch(added,/postMessage|fetch\(|saveReceiptDecision|quantityCaseSave/);
});
