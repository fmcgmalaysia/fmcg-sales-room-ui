const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {projectWarehouseOrders,createWarehouseOperations,requireWarehouseStaff,readWarehouseReceipts}=load('warehouseReceiving.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const records=new Map(),tasks=[{id:'T',orderId:'O',sourceLineId:'L',barcode:'001',name:'PRODUCT',packing:'12 x 1',ord:90,procurement:{totalCtn:100}}];
 const po={id:'PO',version:'V',taskIds:['T'],company:'NCT',number:'NCT-PO-01',customerId:'C',customerName:'CUSTOMER',documents:[]};let fail=false;
 const store={all:async c=>[...records].filter(([key])=>key.startsWith(c+'/')).map(([,v])=>clone(v)),read:async(c,id)=>clone(records.get(c+'/'+id)||null),insert:async(c,row)=>{if(records.has(c+'/'+row._id))throw Error('duplicate');records.set(c+'/'+row._id,clone(row));if(row.action==='WAREHOUSE_RECEIPT_SAVED'&&fail){fail=false;throw Error('response lost');}return clone(row);},remove:async(c,id)=>records.delete(c+'/'+id)};
 const readOrders=async company=>projectWarehouseOrders({company,purchaseOrders:company==='NCT'?[po]:[],tasks,activity:await store.all(company+'Activity')});
 const operations=createWarehouseOperations({store,names:{NCT:{activity:'NCTActivity'},GHR:{activity:'GHRActivity'}},readOrders,now:()=>new Date('2026-10-11T02:00:00Z')});
 const base={company:'NCT',staff:{memberId:'M',staffId:'S',staffName:'HIA'},requestId:'11111111-1111-4111-8111-111111111111'};
 const input=async(accepted,kind='PARTIAL')=>({id:'PO',version:(await readOrders('NCT'))[0].version,action:'RECEIVE',lines:[{taskId:'T',accepted,rejected:0,kind,reason:'Two deliveries agreed'}]});
 return {records,store,readOrders,operations,base,input,tasks,po,fail:()=>fail=true};
}
test('two deliveries accumulate once; customer capped and excess kept separate',async()=>{
 const f=fixture();await f.operations.save({...f.base,input:await f.input(80)});
 let row=(await f.readOrders('NCT'))[0];assert.equal(row.status,'PARTIAL');assert.equal(row.lines[0].customerReceived,80);assert.equal(row.lines[0].extraReceived,0);
 await f.operations.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input:await f.input(20,'DELIVERY')});
 row=(await f.readOrders('NCT'))[0];assert.equal(row.status,'COMPLETE');assert.equal(row.lines[0].customerReceived,90);assert.equal(row.lines[0].extraReceived,10);assert.equal(row.history.length,2);assert.equal(row.history[0].by,'HIA');assert.equal(f.tasks[0].ord,90);
});
test('lost receipt acknowledgement replays same identity without doubled cartons',async()=>{
 const f=fixture(),input=await f.input(80);f.fail();await assert.rejects(f.operations.save({...f.base,input}),/response lost/);
 await f.operations.save({...f.base,input});await f.operations.save({...f.base,input});
 const row=(await f.readOrders('NCT'))[0];assert.equal(row.lines[0].accepted,80);assert.equal(row.history.length,1);
});
test('shortage requires reason, over-receipt and foreign PO are rejected',async()=>{
 const f=fixture(),input=await f.input(80,'SHORT');input.lines[0].reason='';await assert.rejects(f.operations.save({...f.base,input}),/reason/);
 await assert.rejects(f.operations.save({...f.base,input:await f.input(101)}),/exceed/);
 await assert.rejects(f.operations.save({...f.base,company:'GHR',input:await f.input(80)}),/changed/);
 assert.equal((await f.readOrders('NCT'))[0].status,'WAITING');
});
test('rejected cartons are never accepted stock; replacement must explicitly resolve problem',async()=>{
 const f=fixture(),input=await f.input(80,'DAMAGED');input.lines[0].rejected=20;await f.operations.save({...f.base,input});
 let row=(await f.readOrders('NCT'))[0];assert.equal(row.status,'ISSUE');assert.equal(row.lines[0].remaining,20);
 const next=await f.input(20,'DELIVERY'),base={...f.base,requestId:'22222222-2222-4222-8222-222222222222'};
 await assert.rejects(f.operations.save({...base,input:next}),/Confirm/);next.lines[0].resolveIssue=true;await f.operations.save({...base,input:next});
 row=(await f.readOrders('NCT'))[0];assert.equal(row.status,'COMPLETE');assert.equal(row.lines[0].rejected,20);
});
test('stale browser form cannot overwrite a new receipt',async()=>{
 const f=fixture(),input=await f.input(80);await f.operations.save({...f.base,input});
 await assert.rejects(f.operations.save({...f.base,requestId:'22222222-2222-4222-8222-222222222222',input}),/changed/);
});
test('warehouse rejects ambiguous audit chain and unauthorized purchaser',()=>{
 assert.throws(()=>readWarehouseReceipts('PO',[{title:'A',description:'PO',action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',details:{beforeRevision:'missing'}}]),/history/);
 const member={_id:'M',loginEmail:'a@example.com',status:'APPROVED'},records=[{title:'S',description:'M',staffName:'HIA',staffEmail:'a@example.com',staffStatus:'ACTIVE',departments:['PURCHASE']}];
 assert.throws(()=>requireWarehouseStaff(member,records),/not authorized/);records[0].departments=['WAREHOUSE'];assert.equal(requireWarehouseStaff(member,records).staffId,'S');
});
