const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
function fixtureFrom(name,exported){const file=path.join(__dirname,name),module={exports:{}},local=createRequire(file);vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports={'+exported+'};',{module,exports:module.exports,require:id=>id==='node:test'?()=>{}:local(id),Buffer,console,__dirname:path.dirname(file),__filename:file});return module.exports;}
const {fixture}=fixtureFrom('purchase-allocation-drafts.test.cjs','fixture');
function amended(gap=0){const f=fixture(),root=f.workspace.tasks[0];root.ord=500;root.po='NCT-PO-500';root.procurement={revision:'P1',totalCtn:500,draftPlan:false,transportMode:'SUPPLIER_DELIVER'};root.supplyAllocation={gap};f.ui.open('A');f.ui.click({dataset:{allocationAmend:'A'}});f.edit('A','qty','300');return f;}
test('500 to 300 creates one remainder200; choosing supplier never duplicates WAITING even with gap200',()=>{
 for(const gap of [0,200]){const f=amended(gap),d=f.ui.serialize().rows.find(row=>!row.taskId);assert.equal(d.qty,'200');f.edit(d.key,'supplierId','S2');const rows=f.ui.serialize().rows;assert.equal(rows.filter(row=>!row.hidden&&!row.supplierId).length,0);assert.equal(rows.filter(row=>!row.hidden).reduce((sum,row)=>sum+Number(row.qty),0),500);assert.equal(f.submissions.length,0);}
});
test('row save amends only original PO and preserves second supplier draft and purpose control',()=>{
 const f=amended(),draft=f.ui.serialize().rows.find(row=>!row.taskId);f.edit(draft.key,'supplierId','S2');f.edit(draft.key,'transportMode','SELF_COLLECT');f.ui.click({dataset:{allocationSave:'A'}});assert.equal(f.submissions.length,1);const request=f.submissions[0];assert.equal(request.operation,'PLAN');assert.equal(request.input.totalCtn,300);const root=f.workspace.tasks[0];root.procurement={...root.procurement,totalCtn:300,revision:'P2',costing:request.input.costing};root.editVersion='V2';f.ui.receipt(request,{ok:true});f.ui.receivedWorkspace();const rows=f.ui.serialize().rows;assert.equal(rows.find(row=>row.key===draft.key).qty,'200');assert.equal(rows.filter(row=>!row.hidden&&!row.supplierId).length,0);assert.match(f.node('#allocationRows').innerHTML,/Supply purpose/);assert.equal(root.po,'NCT-PO-500');assert.equal(f.submissions.length,1);
});
test('saved PO uses plain text with pencil; financial lock removes all edit controls',()=>{
 const f=fixture(),root=f.workspace.tasks[0];root.po='NCT-PO';root.procurement={revision:'P1',totalCtn:100,transportMode:'SUPPLIER_DELIVER'};f.ui.open('A');let html=f.node('#allocationRows').innerHTML;assert.doesNotMatch(html,/<input|<select/);assert.match(html,/data-allocation-amend/);root.financeSubmitted=true;f.ui.open('A');html=f.node('#allocationRows').innerHTML;assert.doesNotMatch(html,/<input|<select|data-allocation-amend/);assert.match(html,/Purchase order locked/);assert.match(f.node('#allocationConfirmations').innerHTML,/采购单已锁定/);f.ui.click({dataset:{allocationAmend:'A'}});f.edit('A','qty','1');assert.equal(f.submissions.length,0);
});
test('additional stock does not cover unplaced customer demand',()=>{const f=amended(),draft=f.ui.serialize().rows.find(row=>!row.taskId);f.edit(draft.key,'supplierId','S2');f.edit(draft.key,'supplyPurpose','STOCK');assert.equal(f.ui.serialize().rows.find(row=>!row.supplierId&&!row.hidden).qty,'200');assert.match(f.node('#allocationSummary').innerHTML,/待安排 <b>200 CTN/);});
test('normal split covers all 200 ordered cartons and asks only for the note on 5 surplus FOC cartons',()=>{
 const f=fixture(),root=f.workspace.tasks[0];
 root.ord=200;
 root.po='NCT-PO-FIRST';
 root.procurement={revision:'P1',totalCtn:100,draftPlan:false,transportMode:'SUPPLIER_DELIVER'};
 f.ui.open('A');
 const draft=f.ui.serialize()?.rows.find(row=>!row.taskId)?.key||'draft-1';
 for(const [field,value] of Object.entries({supplierId:'S2',mode:'FOC',paid:'100',free:'5',lpPc:'2',lpCtn:'48',disc1:'0',disc2:'0',disc3:'0',transportMode:'SUPPLIER_DELIVER'}))f.edit(draft,field,value);
 assert.equal(f.ui.serialize().rows.filter(row=>!row.hidden&&!row.supplierId).length,0);
 assert.match(f.node('#allocationStockNote').textContent,/200 CTN.*5 CTN.*尚未形成库存/);
 f.ui.click({dataset:{allocationSave:draft}});
 assert.equal(f.submissions.length,0);
 assert.match(f.ui.serialize().issue,/5 surplus CTN/);
 f.ui.edit({target:{id:'allocationReason',value:'Supplier offered 5 FOC cartons'}});
 f.ui.click({dataset:{allocationSave:draft}});
 assert.equal(f.submissions.length,1);
 const request=f.submissions[0];
 assert.equal(request.operation,'ADD_SOURCE');
 assert.equal(request.input.quantity,105);
 assert.equal(request.input.costing.paidCtn,100);
 assert.equal(request.input.costing.freeCtn,5);
 assert.equal(request.input.supplyPurpose,undefined);
 const {planPurchaseShares}=require('./load-master-module.cjs')('purchasePlan.js');
 const plan=planPurchaseShares(f.workspace,[],'A','new-source',request.input.quantity);
 assert.equal(plan.customerCtn,100);
 assert.equal(plan.extraCtn,5);
 assert.equal(plan.shares.reduce((sum,row)=>sum+row.customerCtn,0),200);
});
function imageFixture(records={},fail=false){let reads=[];const wixData={query(collection){return {hasSome(field,ids){this.ids=ids;return this;},limit(){return this;},async find(){reads.push([collection,this.ids]);if(fail)throw Error('offline');return {items:(records[collection]||[]).filter(row=>this.ids.includes(row._id))};}};}};let code=fs.readFileSync(path.join(__dirname,'../../backend/nctSalesIntake.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function submitNctSalesOrder','async function submitNctSalesOrder');const ctx={wixData,URL};vm.runInNewContext(code+'\nthis.enrich=withSubmissionImages;this.image=submissionImage;',ctx);return {...ctx,reads};}
test('Submit resolves selection ID to its own product ID in batches, never by barcode',async()=>{const f=imageFixture({WixBuyerListItems:[{_id:'SEL',payload:JSON.stringify({customerId:'C',productId:'PRODUCT'})}],FMCGMALAYSIA:[{_id:'PRODUCT',image:'wix:image://v1/a~mv2.jpg/name.jpg'},{_id:'OTHER',image:'https://example.com/wrong.png'}]});const result=await f.enrich([{itemId:'SEL',barcode:'DUP'}],'C');assert.equal(result[0].productImageUrl,'https://static.wixstatic.com/media/a~mv2.jpg');assert.equal(f.reads.length,2);assert.equal(f.reads[1][1][0],'PRODUCT');});
test('wrong customer, missing identity and unavailable image service cannot attach another product or block Submit',async()=>{for(const fail of [false,true]){const f=imageFixture({WixBuyerListItems:[{_id:'SEL',payload:JSON.stringify({customerId:'OTHER',productId:'PRODUCT'})}],FMCGMALAYSIA:[{_id:'PRODUCT',image:'https://example.com/wrong.png'}]},fail);const lines=[{itemId:'SEL'},{itemId:'MISSING'}];assert.deepEqual(await f.enrich(lines,'C'),lines);}});
test('image normalization refuses unsafe URLs and malformed Wix image IDs',()=>{const f=imageFixture();for(const input of ['javascript:alert(1)','http://example.com/a.png','https://user:pass@example.com/a.png','wix:image://v1/%ZZ/a.png'])assert.equal(f.image(input),'');assert.equal(f.image({imageInfo:{url:'https://static.wixstatic.com/media/test.png'}}),'https://static.wixstatic.com/media/test.png');});
