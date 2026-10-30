const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const load=require('./load-master-module.cjs');
const {purchaseDocumentStates}=load('purchaseDocumentPolicy.js');
const p=require('../prototypes/docs-state-colors-20261030/stage.cjs').plan();
const finance={window:{},document:{addEventListener(){}}};vm.runInNewContext(p.assets.get('account-room/payment-layout.js').toString(),finance);
const app=p.assets.get('purchase-live/app.js').toString(),purchase={esc:String,documentIssueNote:()=>''};
vm.runInNewContext(app.slice(app.indexOf('  function purchaseDocs('),app.indexOf('  function purchaseCurrentDocuments('))+';this.docs=purchaseDocs',purchase);
function both(documents=[],issues=[],requirements=[]){const row={id:'P',documentStates:purchaseDocumentStates(documents,issues,requirements)};return {purchase:purchase.docs(row),finance:finance.window.accountPaymentLayout.docs(row)};}
const button=(html,type)=>html.match(new RegExp('<button[^>]+(?:data-po-doc-type|data-document-type)="'+type+'"[^>]*>'))[0];
test('all five missing document types use Purchase pending and Finance orange from one projection',()=>{
 const html=both();for(const type of ['PO','PI','DO','INV','CN']){assert.match(button(html.purchase,type),/po-doc-badge pending/);assert.match(button(html.finance,type),/acc-doc orange/);}
});
test('Finance report and review states stay red in both departments until actually resolved',()=>{
 const documents=[{type:'INV',fileId:'I',linked:true}],issue={type:'INV',status:'OPEN'};
 for(const status of ['OPEN','AWAITING_REVIEW']){const html=both(documents,[{...issue,status}]);assert.match(button(html.purchase,'INV'),/problem/);assert.match(button(html.finance,'INV'),/acc-doc red/);}
 const html=both(documents,[{...issue,status:'RESOLVED'}]);assert.match(button(html.purchase,'INV'),/available/);assert.match(button(html.finance,'INV'),/acc-doc green/);
});
test('Purchase invalidates a PO or needs CN and both departments receive the same red state',()=>{
 for(const [type,html]of [['PO',both([{type:'PO',linked:true,fileId:'OLD',superseded:true,invalidated:true}])],['CN',both([],[],[{pending:true}])]]){
  assert.match(button(html.purchase,type),/problem/);assert.match(button(html.finance,type),/acc-doc red/);
 }
 const alias=both([{type:'SO',linked:true,fileId:'S'}],[{type:'SO',status:'OPEN'}]);assert.match(button(alias.finance,'PI'),/acc-doc red/);assert.match(button(alias.purchase,'PI'),/problem/);
});
test('Finance keeps its neutral disabled default when no shared state has arrived',()=>{
 const html=finance.window.accountPaymentLayout.docs({id:'P',documents:[{type:'PO',linked:true,fileId:'unverified'}]});
 for(const type of ['PO','PI','DO','INV','CN'])assert.match(button(html,type),/acc-doc waiting[^>]+disabled/);
});
test('release changes four public resources only and leaves all backend and other room resources out',()=>{
 assert.equal(p.assets.size,94);assert.equal(p.changed.length,4);
 for(const[file,bytes]of p.assets)if(!p.changed.includes(file))assert.ok(bytes.equals(p.baseline.get(file)),file);
 for(const file of ['purchase-live/style.css','account-room/payment-layout.css'])assert.match(p.assets.get(file).toString(),/#F58A00/);
 new vm.Script(p.assets.get('account-room/payment-layout.js').toString());
});
