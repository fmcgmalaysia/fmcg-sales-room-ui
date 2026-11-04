const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createQuantityCaseOperations,projectQuantityCases,quantityCasesVersion,customerCaseFeedback}=load('purchaseQuantityCases.js');
const {projectAccountSettlement}=load('accountSettlement.js');
function setup(){
 const rows=new Map(),clone=v=>JSON.parse(JSON.stringify(v));
 const receipt={_id:'R',title:'R',action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',activityTime:'2026-10-26T00:00:00.000Z',details:{lines:[{taskId:'T',planned:100,accepted:90,issue:true,kind:'SHORT',reason:'Supplier short-shipped 供应商少发货'}]}};rows.set('R',receipt);
 const workspace={company:'NCT',tasks:[{id:'T',ord:100,po:'PO',customerId:'C',supplierId:'S',procurement:{totalCtn:100},warehouse:{accepted:90,issue:true}}]};
 const store={all:async()=>clone([...rows.values()]),read:async(c,id)=>clone(rows.get(id)||null),insert:async(c,row)=>{if(rows.has(row._id))throw Error('duplicate');rows.set(row._id,clone(row));return row;},remove:async(c,id)=>rows.delete(id)};
 const operate=createQuantityCaseOperations({store,names:{NCT:{activity:'A'}},readWorkspace:async()=>clone(workspace),now:()=>new Date('2026-10-26T01:00:00Z')});
 const request=async(solution,supplier,extra={})=>{const activity=await store.all(),item=projectQuantityCases(workspace,activity)[0];return {company:'NCT',staff:{staffId:'P',memberId:'M',staffName:'Purchase',canDecideQuantityCase:true},requestId:'10000000-1111-4111-8111-111111111111',input:{action:'DECIDE',id:item.id,version:quantityCasesVersion(workspace,activity),supplierDeliveryDecision:solution,supplierDecision:supplier,reason:'Selected supplier response',...extra}};};
 return {operate,request,store,workspace,read:async()=>projectQuantityCases(workspace,await store.all())};
}
test('supplier wait persists without inventing dates or customer updates',async()=>{
 const h=setup(),r=await h.request('WAIT','PENDING');await h.operate(r);const [item]=await h.read();
 assert.equal(item.warehouseFeedback.reason,'Supplier short-shipped 供应商少发货');assert.equal(item.quantity,10);assert.equal(item.decision.supplierDeliveryDecision,'WAIT');
 assert.equal(item.decision.customerDecision,'PENDING');assert.equal(item.decision.customerMessage,'');assert.equal(item.decision.expectedDate,null);assert.equal(h.workspace.tasks[0].ord,100);
 assert.deepEqual(await h.operate(r),{ok:true,company:'NCT',requestId:r.requestId,caseId:item.id});
});
for(const outcome of ['CN_PROMISED','FUTURE_DEDUCTION','SUPPLIER_REFUSED'])test('supplier stop '+outcome+' does not cancel customer demand or clear finance risk',async()=>{
 const h=setup();await h.operate(await h.request('STOP',outcome,{customerDecision:'STOP',customerMessage:'Must not overwrite customer instructions'}));const [item]=await h.read();
 assert.equal(item.decision.supplierDecision,outcome);assert.equal(item.decision.customerDecision,'PENDING');assert.equal(item.decision.customerMessage,'');assert.equal(customerCaseFeedback([item]).customerDecision,'PENDING');assert.equal(item.status,'OPEN');assert.equal(item.owner,'ACCOUNT');
 const result=projectAccountSettlement({id:'PO',company:'NCT',contentVersion:'V',documents:[],warehouse:{complete:false,issues:true},receiptLines:[{hasReceipt:true,planned:100,accepted:90,issue:true,decision:item.decision}],quantityCases:[item]},{});
 assert.equal(result.finance.receiptResolved,false);assert.equal(result.invoiceChecked,false);assert.equal(result.canArchive,false);
});
test('stop requires one recognized outcome and wait refuses a stop outcome',async()=>{
 const h=setup();await assert.rejects(h.operate(await h.request('STOP','PENDING')),/exactly one/);
 const other=setup();await assert.rejects(other.operate(await other.request('WAIT','CN_PROMISED')),/exactly one/);
});
