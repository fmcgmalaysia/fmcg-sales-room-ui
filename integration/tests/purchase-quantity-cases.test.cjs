const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectQuantityCases,quantityCasesVersion,createQuantityCaseOperations,customerCaseFeedback}=load('purchaseQuantityCases.js');
function harness(){
 const rows=new Map(),clone=value=>JSON.parse(JSON.stringify(value));
 const store={all:async()=>[...rows.values()].map(clone),read:async(c,id)=>clone(rows.get(id)||null),insert:async(c,row)=>{if(rows.has(row._id))throw Error('duplicate');rows.set(row._id,clone(row));return clone(row);},remove:async(c,id)=>rows.delete(id)};
 const workspace={company:'NCT',tasks:[{id:'A',ord:200,po:'PO-A',customerId:'C',supplierId:'S-A',netCostCtn:100,procurement:{totalCtn:180,revision:'P-A'},warehouse:null},{id:'B',ord:0,po:'PO-B',customerDemandTaskId:'A',procurementSource:true,supplierId:'S-B',procurement:{totalCtn:10,revision:'P-B'},warehouse:null}]};
 const now=()=>new Date('2026-10-12T06:00:00Z'),staff={staffId:'P',staffName:'PLANNER',memberId:'MP',canDecideQuantityCase:true};
 const operate=createQuantityCaseOperations({store,names:{NCT:{activity:'Activity'}},readWorkspace:async()=>clone(workspace),now});let sequence=0;
 const cases=async()=>projectQuantityCases(workspace,await store.all());
 const request=async(kind,customerDecision='STOP',supplierDecision='PENDING')=>({company:'NCT',staff,requestId:String(++sequence).padStart(8,'0')+'-1111-4111-8111-111111111111',input:{action:'DECIDE',id:(await cases()).find(row=>row.kind===kind).id,version:quantityCasesVersion(workspace,await store.all()),customerDecision,supplierDecision,expectedDate:'2026-10-15',reason:'Internal supplier issue',customerMessage:'Available quantities confirmed'}});
 const receive=async(accepted,issue=true)=>{workspace.tasks[0].warehouse={accepted,rejected:0,issue};const id='RECEIPT-'+sequence+'-'+accepted;await store.insert('Activity',{_id:id,title:id,action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',description:'PO-A',details:{lines:[{taskId:'A',planned:180,accepted,issue}]}});};
 return {workspace,store,cases,request,operate,receive};
}
test('unplaced ten and supplier short receipt ten stay independent with owner and employee audit',async()=>{
 const h=harness();let cases=await h.cases();assert.equal(cases.length,1);assert.equal(cases[0].quantity,10);assert.equal(cases[0].financeRequired,false);
 const request=await h.request('UNPLACED');const result=await h.operate(request);assert.deepEqual(await h.operate(request),result);
 await h.receive(170);cases=await h.cases();assert.equal(cases.length,2);
 const first=cases.find(row=>row.kind==='UNPLACED'),second=cases.find(row=>row.kind==='RECEIPT');
 assert.equal(first.status,'RESOLVED');assert.equal(first.decision.by,'PLANNER');assert.equal(first.decision.at,'2026-10-12T06:00:00.000Z');assert.equal(second.quantity,10);assert.equal(second.status,'OPEN');assert.equal(second.owner,'PURCHASE');assert.equal(second.financeRequired,true);assert.equal(second.decision,null);
 assert.equal(customerCaseFeedback(cases).customerDecision,'PENDING','previous stop cannot close a later receipt shortage');
 await h.operate(await h.request('RECEIPT','STOP','REFUND'));cases=await h.cases();assert.equal(cases.find(row=>row.kind==='RECEIPT').owner,'ACCOUNT');assert.equal(cases.find(row=>row.kind==='RECEIPT').status,'OPEN');assert.equal(customerCaseFeedback(cases).customerDecision,'STOP');
 assert.equal(h.workspace.tasks[0].ord,200);
});
test('ordinary partial delivery has no high-risk receipt case',async()=>{
 const h=harness();await h.receive(100,false);assert.equal((await h.cases()).filter(row=>row.kind==='RECEIPT').length,0);
});
test('replenishment updates physical cartons but retains the financial review case',async()=>{
 const h=harness();await h.receive(170);await h.operate(await h.request('RECEIPT','WAIT','REPLENISH'));await h.receive(180,false);
 const receipt=(await h.cases()).find(row=>row.kind==='RECEIPT');assert.equal(receipt.quantity,0);assert.equal(receipt.status,'OPEN');assert.equal(receipt.decision.supplierDecision,'REPLENISH');
});
test('reducing supplier plan after shortage cannot erase supplier liability',async()=>{
 const h=harness();await h.receive(170);h.workspace.tasks[0].procurement={totalCtn:170,revision:'REDUCED'};
 assert.equal((await h.cases()).find(row=>row.kind==='RECEIPT').quantity,10);
});
test('a fresh sourcing change reopens the unplaced case and stale saves are rejected',async()=>{
 const h=harness();await h.operate(await h.request('UNPLACED'));const stale=await h.request('UNPLACED');h.workspace.tasks[1].procurement={totalCtn:15,revision:'NEW'};
 await assert.rejects(h.operate(stale),/changed/);const item=(await h.cases()).find(row=>row.kind==='UNPLACED');assert.equal(item.quantity,5);assert.equal(item.status,'OPEN');assert.equal(item.decision,null);
});
test('quantity decisions cannot be submitted by another department or with another company identity',async()=>{
 const h=harness(),request=await h.request('UNPLACED');await assert.rejects(h.operate({...request,staff:{...request.staff,canDecideQuantityCase:false}}),/authorized/);await assert.rejects(h.operate({...request,company:'GHR'}),/authorized/);
});
