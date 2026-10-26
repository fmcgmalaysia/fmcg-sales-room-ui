const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs'),{createHash}=require('node:crypto');
const {createQuantityCaseOperations,projectQuantityCases,quantityCasesVersion}=load('purchaseQuantityCases.js');
const {projectWarehouseOrders}=load('warehouseReceiving.js');
const {projectDepartmentMessages}=load('departmentMessages.js');
const {buildTaskChatWorkspace}=load('taskChatWorkspace.js');
const {createTaskChatService}=load('taskChatService.js');
const clone=v=>JSON.parse(JSON.stringify(v));
function setup(second=false){
 const task={id:'T',orderId:'O',sourceLineId:'L',ord:50,po:'PO-001',customerId:'C',supplierId:'S',procurement:{totalCtn:50},warehouse:{accepted:45,issue:true}};
 const workspace={company:'NCT',tasks:[task],customers:[],suppliers:[]};
 if(second)workspace.tasks.push({...task,id:'U',sourceLineId:'LU',ord:20,procurement:{totalCtn:20},warehouse:null});
 const records=new Map(),receipt={_id:'RECEIPT',title:'RECEIPT',description:'PO',action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',activityTime:'2026-09-30T10:00:00.000Z',initiatedByStaffName:'Warehouse',details:{beforeRevision:'',lines:[{taskId:'T',orderId:'O',sourceLineId:'L',planned:50,accepted:45,rejected:0,beforeAccepted:0,beforeRejected:0,issue:true,kind:'SHORT',reason:'Short delivery 供应商少发货'}]}};records.set(receipt._id,receipt);
 const store={all:async()=>clone([...records.values()]),read:async(c,id)=>clone(records.get(id)||null),insert:async(c,row)=>{if(records.has(row._id))throw Error('duplicate');records.set(row._id,clone(row));return row;},remove:async(c,id)=>records.delete(id)};
 const operate=createQuantityCaseOperations({store,names:{NCT:{activity:'A'}},readWorkspace:async()=>clone(workspace),now:()=>new Date('2026-10-26T02:00:00Z')});
 const request=async(delivery,outcome)=>{const activity=await store.all(),item=projectQuantityCases(workspace,activity).find(i=>i.taskId==='T'&&i.kind==='RECEIPT');return {company:'NCT',staff:{staffId:'P',staffName:'Purchase',memberId:'MP',canDecideQuantityCase:true},requestId:'77777777-1111-4111-8111-111111111111',input:{action:'DECIDE',id:item.id,version:quantityCasesVersion(workspace,activity),supplierDeliveryDecision:delivery,supplierDecision:outcome,reason:'Supplier response selected'}};};
 const po=async()=>({id:'PO',version:'V',taskIds:workspace.tasks.map(t=>t.id),company:'NCT',number:'PO-001',customerId:'C',customerName:'Customer',documents:[],history:[],quantityCases:projectQuantityCases(workspace,await store.all())});
 const read=async()=>projectWarehouseOrders({company:'NCT',purchaseOrders:[await po()],tasks:workspace.tasks,activity:await store.all()})[0];
 return {workspace,store,operate,request,po,read};
}
for(const outcome of ['CN_PROMISED','FUTURE_DEDUCTION','SUPPLIER_REFUSED'])test('confirmed '+outcome+' completes receiving work without pretending cartons arrived',async()=>{
 const f=setup(),request=await f.request('STOP',outcome);await f.operate(request);await f.operate(request);
 const row=await f.read();assert.equal(row.workroomStatus,'COMPLETE');assert.equal(row.receivingStoppedWaiting,true);assert.equal(row.workroomCompletedAt,'2026-10-26T02:00:00.000Z');
 assert.equal(row.status,'ISSUE');assert.equal(row.completedAt,null);assert.equal(row.lines[0].planned,50);assert.equal(row.lines[0].accepted,45);assert.equal(row.lines[0].remaining,5);assert.equal(row.approvedReceiptTarget,null);assert.equal(f.workspace.tasks[0].ord,50);
 const events=await f.store.all();assert.equal(events.filter(e=>e.action==='PURCHASE_QUANTITY_CASE_DECIDED').length,1);
 const order=await f.po();
 for(const department of ['WAREHOUSE','ACCOUNT']){
  const staff={staffId:department,staffName:department,departments:[department]},legacy=projectDepartmentMessages({company:'NCT',department,staff,orders:[order],activity:events});
  const updates=legacy.threads[0].updates.filter(e=>e.from==='PURCHASE');assert.equal(updates.length,1);assert.equal(updates[0].notify,true);assert.match(updates[0].body,/stopped waiting/);assert.ok(updates[0].bodyZh);
  const model=buildTaskChatWorkspace({company:'NCT',department,orders:[order],delivery:[],legacy});
  const service=createTaskChatService({resolve:async()=>model,index:{find:async()=>[]},drive:async()=>{throw Error('Unexpected Drive write');},hash:x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')});
  const list=await service.list({company:'NCT',department,staff});assert.equal(list.threads[0].peer,'PURCHASE');assert.equal(list.threads[0].unread,1);assert.equal(list.threads[0].updates.filter(e=>e.from==='PURCHASE').length,1);
 }
});
test('waiting remains in progress and another pending product prevents whole-PO completion',async()=>{
 const waiting=setup();await waiting.operate(await waiting.request('WAIT','PENDING'));assert.equal((await waiting.read()).workroomStatus,'ISSUE');assert.equal((await waiting.read()).workroomCompletedAt,null);
 const f=setup(true);await f.operate(await f.request('STOP','CN_PROMISED'));assert.equal((await f.read()).workroomStatus,'ISSUE');assert.equal((await f.read()).lines[1].remaining,20);
});
test('automatic supplier notification remains isolated to its company and addressed task',async()=>{
 const f=setup();await f.operate(await f.request('STOP','CN_PROMISED'));const order=await f.po(),activity=await f.store.all();
 for(const [company,taskIds]of [['GHR',['T']],['NCT',['OTHER']]]){const result=projectDepartmentMessages({company,department:'ACCOUNT',staff:{staffId:'F',staffName:'Finance',departments:['ACCOUNT']},orders:[{...order,company,taskIds}],activity});assert.equal(result.threads[0].updates.filter(e=>e.from==='PURCHASE').length,0);}
});
