const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const cache={},moduleFor=name=>load(name,cache),clone=value=>JSON.parse(JSON.stringify(value));
const {projectPurchaseWorkspace}=moduleFor('purchaseProjection.js');
const {projectPreparation,createPreparationOperations}=moduleFor('warehousePreparation.js');
const {projectPackingContext}=moduleFor('packingListContext.js');
const {projectStockCard}=moduleFor('stockCardProjection.js');
const at='2026-10-29T01:00:00Z';
function fixture({main=50,child=45,allocated=false}={}){
 const records=new Map(),raw={company:'NCT',staff:{staffId:'S',staffName:'Synthetic operator'},suppliers:[],
  orders:[{title:'ORDER',sourceLineId:'LINE',submissionId:'SUB',customerId:'C',customerCompanyName:'Synthetic customer',description:'BAR',image:'Synthetic product',imageAltText:'24 x 1',orderId:24,orderQtyInCtn:100,transactionCurrency:'USD'}],
  tasks:[{title:'ROOT',description:'ORDER',imageAltText:'LINE',purchaseQtyInCtn:100,receivedQtyInCtn:0,ourPoNumber:'PO-ROOT',supplierId:'S1'},
   {title:'CHILD',description:'ORDER',imageAltText:'LINE',purchaseQtyInCtn:0,receivedQtyInCtn:0,procurementSource:true,customerDemandTaskId:'ROOT',ourPoNumber:'PO-CHILD',supplierId:'S2'}]};
 const add=event=>records.set(event.title,{_id:event.title,activityTime:at,initiatedByStaffId:'S',initiatedByStaffName:'Synthetic operator',...event});
 add({title:'INTAKE',description:'ORDER',action:'ORDER_RECEIVED',result:'ACCEPTED',details:{submissionId:'SUB',taskIds:['ROOT']}});
 add({title:'SOURCE',description:'ORDER',image:'LINE',imageAltText:'CHILD',action:'PURCHASE_SOURCE_ADDED',result:'SAVED',details:{parentTaskId:'ROOT',submissionId:'SUB'}});
 for(const [id,received]of [['ROOT',main],['CHILD',child]]){
  add({title:'PLAN-'+id,description:'ORDER',image:'LINE',imageAltText:id,action:'PURCHASE_PLAN_SAVED',result:'SAVED',details:{beforeRevision:'',totalCtn:50}});
  add({title:'RECEIVE-'+id,description:'PO-'+id,action:'WAREHOUSE_RECEIPT_SAVED',result:'SAVED',details:{beforeRevision:'',lines:[{taskId:id,orderId:'ORDER',sourceLineId:'LINE',accepted:received,rejected:0,beforeAccepted:0,beforeRejected:0,kind:'DELIVERY'}]}});
  if(allocated)add({title:'ALLOC-'+id,imageAltText:id,action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',details:{beforeRevision:'',targets:[{taskId:'ROOT',quantity:received}]}});
 }
 add({title:'SHARES',imageAltText:'ROOT',action:'PURCHASE_SOURCE_SHARES_SAVED',result:'SAVED',details:{beforeRevision:'',shares:[{taskId:'ROOT',totalCtn:50,customerCtn:50},{taskId:'CHILD',totalCtn:50,customerCtn:50}]}});
 const context=()=>{const activity=clone([...records.values()]);return {...projectPurchaseWorkspace({...clone(raw),activity}),activity};};
 const store={all:async()=>clone([...records.values()]),read:async(c,id)=>clone(records.get(id)||null),insert:async(c,row)=>{if(records.has(row._id))throw Error('duplicate');records.set(row._id,clone(row));return clone(row);},update:async(c,row)=>{records.set(row._id,clone(row));return clone(row);},remove:async(c,id)=>records.delete(id)};
 const staff={memberId:'MEMBER',staffId:'S',staffName:'Synthetic operator',canPrepareWarehouse:true};
 const save=createPreparationOperations({store,names:{NCT:{activity:'N'}},readContext:async()=>context(),documentService:async()=>{throw Error('External calls forbidden');},now:()=>new Date(at)});
 let serial=0;
 const request=action=>{const row=projectPreparation(context()).find(row=>row.taskId==='ROOT');return {company:'NCT',staff,requestId:String(++serial).padStart(8,'0')+'-1111-4111-8111-111111111111',input:{id:row.id,version:row.version,...action}};};
 return {context,records,request,save};
}
test('real receipt projection keeps physical Ready95 visible with allocation0, while preparation save remains blocked',async()=>{
 const f=fixture(),c=f.context(),root=c.tasks.find(row=>row.id==='ROOT');
 assert.equal(root.sourcing.receivedCtn,95);assert.equal(root.inc,0);assert.equal(c.allocations.length,0);
 assert.equal(projectPackingContext(c).tasks[0].ready,95);assert.equal(projectPreparation(c)[0].allocated,0);
 const stock=projectStockCard(c).items[0];assert.equal(stock.onHand,95);assert.equal(stock.reservedUsable,95);assert.equal(stock.available,0);
 await assert.rejects(f.save(f.request({action:'PACK'})),/allocated goods are insufficient/);
 assert.equal(f.context().activity.filter(row=>row.action==='WAREHOUSE_PREPARATION_SAVED').length,0);
 assert.equal(projectStockCard(f.context()).items[0].onHand,95);
});
test('actual additional-source allocations feed root inc95 through the unchanged receipt projector',()=>{
 const f=fixture({allocated:true}),c=f.context(),root=c.tasks.find(row=>row.id==='ROOT');
 assert.equal(root.inc,95);assert.equal(root.sourcing.receivedCtn,95);assert.equal(projectPackingContext(c).tasks[0].ready,95);
});
test('actual raw receipt and allocation composition preserves cumulative Loaded80→100 without duplicate deduction',async()=>{
 const f=fixture({child:50,allocated:true});assert.equal(f.context().tasks.find(row=>row.id==='ROOT').inc,100);
 await f.save(f.request({action:'PACK'}));await f.save(f.request({action:'LOAD',loaded:80,note:'Partial load'}));
 assert.equal(projectStockCard(f.context()).items[0].onHand,20);assert.equal(projectPackingContext(f.context()).tasks[0].ready,20);
 const request=f.request({action:'LOAD',loaded:100});await f.save(request);await f.save(request);
 assert.equal(projectStockCard(f.context()).items[0].onHand,0);assert.equal(projectPackingContext(f.context()).tasks[0].ready,0);
});
