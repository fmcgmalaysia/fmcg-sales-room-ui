const test=require('node:test'), assert=require('node:assert/strict'), load=require('./load-master-module.cjs');
const {financeInventoryOutlook}=load('financeInventoryOutlook.js');
const {calculatePlanCosting}=load('purchasePlan.js');
const at='2026-11-28T08:00:00.000Z',dec='2026-11-30T16:00:00.000Z';
function sample() {
  const raw={company:'NCT',orders:[],tasks:[],activity:[]};
  const add=(arr,obj,time=at)=>arr.push({_createdDate:time,_updatedDate:time,...obj});
  const event=(obj,time=at)=>add(raw.activity,{activityTime:time,result:'SAVED',...obj},time);
  for(const [customer,id,date,items] of [
    ['AVATA','QA-001','2026-12-12',[['Chocolate biscuits',30,50,30,35,0,5],['Canned coffee',25,48,15,32,8,0],['Lemon soda',20,40,20,26,0,8],['Almond butter',15,60,10,45,5,0],['Instant noodles',10,40,0,24,6,0]]],
    ['ALAMAK','QA-002','2026-12-18',[['Wafer assortment',80,48,30,33.6,40,0]]]]){
    const ids=[];
    for(const [i,[name,demand,sale,held,cost,po,free]] of items.entries()){
      const task=id+'-'+i,line='L'+i,total=held+po+free,received=held+free;
      ids.push(task);
      add(raw.orders,{title:id,sourceLineId:line,submissionId:id,customerId:customer,customerCompanyName:customer,description:task,image:name,imageAltText:'1 EA',orderId:1,orderQtyInCtn:demand,transactionCurrency:'MYR',sellingPricePc:sale,estimatedShipmentDate:date});
      add(raw.tasks,{_id:task,title:task,description:id,imageAltText:line,purchaseQtyInCtn:demand,ourPoNumber:'TEST-'+task,supplierId:'QA-S'});
      const costing=calculatePlanCosting({schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:total,freeCtn:0,prices:{lpPc:cost,lpCtn:cost,disc1:0,disc2:0,disc3:0}},total,1);
      event({title:'PLAN-'+task,description:id,image:line,imageAltText:task,action:'PURCHASE_PLAN_SAVED',details:{beforeRevision:'',totalCtn:total,extraCtn:free,costing}});
      if(received)event({title:'RECEIPT-'+task,description:'PO-'+task,action:'WAREHOUSE_RECEIPT_SAVED',details:{beforeRevision:'',lines:[{taskId:task,orderId:id,sourceLineId:line,beforeAccepted:0,beforeRejected:0,accepted:received,rejected:0,issue:false}]}});
    }
    event({title:'INTAKE-'+id,description:id,action:'ORDER_RECEIVED',result:'ACCEPTED',details:{submissionId:id,taskIds:ids}});
  }
  return raw;
}
const read=raw=>financeInventoryOutlook(raw,'2026-11-30','2026-12');
if(require.main===module && process.argv.includes('--sample'))console.log(JSON.stringify(read(sample())));
else {
test('Finance November close reconciles both accepted orders, reserved, outstanding POs and available lots',()=>{
 const data=read(sample());
 const total=lines=>['qty','salesCents','reserved','costCents','incoming','toArrange'].map(k=>lines.reduce((s,r)=>s+r[k],0));
 assert.deepEqual(total(data.lines.filter(r=>r.customer==='AVATA')),[100,480000,75,250000,19,6]);
 assert.deepEqual(total(data.lines.filter(r=>r.customer==='ALAMAK')),[80,384000,30,100800,40,10]);
 assert.equal(data.lines.length,6); assert.equal(data.review.length,0);
 assert.equal(data.available.reduce((s,r)=>s+r.qty,0),13);assert.equal(data.available.reduce((s,r)=>s+r.cents,0),38300);
});
test('December midnight MYT receipt changes December position only',()=>{
 const raw=sample(),before=JSON.stringify(read(raw)),e=structuredClone(raw.activity.find(e=>e.title==='RECEIPT-QA-001-1'));
 Object.assign(e,{title:'DEC-RECEIPT',activityTime:dec,_createdDate:dec,_updatedDate:dec});e.details.beforeRevision='RECEIPT-QA-001-1';
 Object.assign(e.details.lines[0],{beforeAccepted:15,accepted:23});raw.activity.push(e);
 assert.equal(JSON.stringify(read(raw)),before);
 const line=financeInventoryOutlook(raw,'2026-12-01','2026-12').lines.find(r=>r.product==='Canned coffee');assert.deepEqual([line.reserved,line.incoming,line.toArrange],[23,0,2]);
});
test('no Sales acceptance, no purchase demand; unknown cost stays unknown',()=>{
 const raw=sample();raw.activity=raw.activity.filter(r=>r.title!=='INTAKE-QA-002');delete raw.activity.find(r=>r.title==='PLAN-QA-001-0').details.costing;
 const data=read(raw);assert.equal(data.lines.length,5);assert.equal(data.lines[0].costCents,null);
});
test('ambiguous historical version cannot become a current balance labelled November',()=>{
 const raw=sample();raw.tasks[0]._updatedDate=dec;assert.throws(()=>read(raw),/Historical revision/);
});
test('December loading reduces order demand and physical stock once; the November close stays intact',()=>{
 const raw=sample(),before=JSON.stringify(read(raw)),taskId='QA-001-0';
 raw.activity.push({_createdDate:dec,_updatedDate:dec,activityTime:dec,title:'DEC-LOAD',description:'LOADING-1',
   action:'WAREHOUSE_PREPARATION_SAVED',result:'SAVED',details:{beforeRevision:'',state:{id:'LOADING-1',taskId,
     company:'NCT',customerId:'AVATA',loaded:10,physicalSources:[{sourceTaskId:taskId,quantity:10}]}}});
 assert.equal(JSON.stringify(read(raw)),before);
 const line=financeInventoryOutlook(raw,'2026-12-01','2026-12').lines.find(r=>r.product==='Chocolate biscuits');
 assert.deepEqual([line.qty,line.reserved,line.costCents,line.salesCents],[20,20,70000,100000]);
});
}
