const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('prototypes/account-workspace-20261017/draft.js','utf8');
function setup(){
 const nodes={},listeners={};
 const document={querySelector:s=>nodes[s]||null,addEventListener:(k,f)=>listeners[k]=f};
 nodes['#detail']={open:true,addEventListener(){},close(){this.open=false;}};
 const context=vm.createContext({document,structuredClone,Date,setTimeout(){}});
 const end="$('#detail').addEventListener('click',e=>{if(e.target===$('#detail'))$('#detail').close();});render();";
 assert.ok(source.includes(end));
 vm.runInContext(source.replace(end,`let lastBody='';modal=(r,h,b)=>{lastBody=b;};render=()=>{$('#detail').open=false;};showNotice=()=>{};globalThis.api={requests,record,savePayment,paymentList,supplierBanks,get body(){return lastBody;},canDeleteProof,removeProof,formatPaidAmount,proof:()=>{draftProofs=[{id:'file1',name:'sample.pdf',href:'sample.pdf',uploadedBy:'ACCOUNT-DEMO'}];}};`),context);
 const api=context.api,r=api.requests[0];r.reviewed=true;r.stage='REVIEW';
 function form(choice,amount='200.00',ref='REF-1'){
  for(const [id,value] of Object.entries({paidAmount:amount,paidDate:'2026-10-17',paidAccount:'CASH',paidReference:ref,paidNote:''}))nodes['#'+id]={value};
  nodes['#recordError']={textContent:''};nodes['#detail'].open=true;
  nodes['input[name="recipientChoice"]:checked']=choice?{value:choice}:null;api.proof();
 }
 return {api,r,nodes,form,listeners};
}
test('missing selection blocks payment and leaves amount/status unchanged',()=>{
 const {api,r,nodes,form}=setup();form(null);api.savePayment(r);
 assert.equal(r.payments.length,0);assert.equal(r.paid,0);assert.equal(r.stage,'REVIEW');assert.match(nodes['#recordError'].textContent,/Confirm the recipient/);
});
test('two instalments independently preserve supplier snapshot and Other account',()=>{
 const {api,r,form}=setup();form('SUPPLIER');api.savePayment(r);
 assert.equal(r.paid,20000);assert.equal(r.stage,'PARTIAL');assert.equal(r.payments[0].recipientBank.bankAccountNo,'001234567890');
 api.supplierBanks['KOH SOON HUAT'].bankAccountNo='009999';
 form('OTHER','230.00','REF-2');api.savePayment(r);
 assert.equal(r.paid,43000);assert.equal(r.stage,'PAID');assert.equal(r.payments.length,2);
 assert.equal(r.payments[0].recipientBank.bankAccountNo,'001234567890');assert.equal(r.payments[1].recipientChoice,'OTHER');assert.equal(r.payments[1].recipientBank,null);
 assert.match(api.body,/Other account/);assert.doesNotMatch(api.body,/009999/);assert.equal((api.body.match(/>Download</g)||[]).length,2);
 api.savePayment(r);assert.equal(r.payments.length,2);
});
test('missing bank disables supplier choice and save; Other account remains possible',()=>{
 const {api,r,nodes,form}=setup();delete api.supplierBanks[r.supplier];api.record(r);
 assert.match(api.body,/value="SUPPLIER" disabled/);assert.match(api.body,/value="OTHER"/);
 form('SUPPLIER');api.savePayment(r);assert.equal(r.payments.length,0);assert.match(nodes['#recordError'].textContent,/missing/);
 form('OTHER');api.savePayment(r);assert.equal(r.payments.length,1);assert.equal(r.payments[0].recipientBank,null);
});
test('overpayment, duplicate reference and missing proof cannot change paid balance',()=>{
 const {api,r,nodes,form}=setup();form('SUPPLIER','431.00');api.savePayment(r);assert.equal(r.paid,0);
 form('SUPPLIER');api.savePayment(r);assert.equal(r.paid,20000);
 form('OTHER','100.00','REF-1');api.savePayment(r);assert.equal(r.paid,20000);assert.match(nodes['#recordError'].textContent,/already recorded/);
 api.record(r);nodes['#detail'].open=true;nodes['#paidReference'].value='REF-3';api.savePayment(r);assert.equal(r.paid,20000);assert.match(nodes['#recordError'].textContent,/pay slip/);
});
test('historical records remain unknown and new form has no default selection',()=>{
 const {api,r}=setup();api.paymentList(api.requests[3]);assert.match(api.body,/Not recorded/);api.record(r);assert.doesNotMatch(api.body,/ checked/);
});

test('reference and note are optional, blank references do not collide',()=>{const {api,r,form}=setup();form('OTHER','200.00','');api.savePayment(r);form('OTHER','230.00','');api.savePayment(r);assert.equal(r.paid,43000);assert.equal(r.payments.length,2);});
test('file deletion permissions allow uploader or SUPER ADMIN only',()=>{const {api}=setup(),f={uploadedBy:'OWNER'};assert.equal(api.canDeleteProof(f,{staffId:'OWNER',role:'ACCOUNT'}),true);assert.equal(api.canDeleteProof(f,{staffId:'ADMIN',role:'SUPER ADMIN'}),true);assert.equal(api.canDeleteProof(f,{staffId:'OTHER',role:'ACCOUNT'}),false);});
test('money blur formatting retains two decimals without rounding invalid input',()=>{const {api}=setup(),input={value:'65'};api.formatPaidAmount(input);assert.equal(input.value,'65.00');input.value='1.234';api.formatPaidAmount(input);assert.equal(input.value,'1.234');});

test('removing saved proof retains payment amount and audited metadata',()=>{const {api,r,form}=setup();form('OTHER','65.00','');api.savePayment(r);const payment=r.payments[0];api.removeProof('file1',payment.id);assert.equal(r.paid,6500);assert.equal(r.stage,'PARTIAL');assert.equal(payment.proofs[0].deletedBy,'ACCOUNT-DEMO');assert.equal(payment.proofs[0].href,undefined);assert.equal(r.proof,false);assert.match(api.body,/No file attached/);});
