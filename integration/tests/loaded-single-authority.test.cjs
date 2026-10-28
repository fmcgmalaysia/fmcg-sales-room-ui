const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./load-master-module.cjs');
const {fixture}=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs');
const {readPhysicalOutflows,physicalOutflowQuantity,assertLoadedOutflows}=load('physicalOutflow.js');
const {projectPreparation}=load('warehousePreparation.js');
const {shipmentVersion}=load('customerFulfilment.js');
const {createSupportInvoiceOperations,supportInvoiceState}=load('supportInvoice.js');
async function legacy(f,loaded=80){await f.prepSave(await f.prepRequest({action:'PACK'}));await f.prepSave(await f.prepRequest({action:'LOAD',loaded,note:'Container capacity'}));}
async function packing(f,loaded=80){const created=await f.packing({action:'CREATE',customerId:'CUSTOMER-A',currency:'USD',lines:[{taskId:'A',quantity:100}]});for(const action of ['SEND','START','PROGRESS','COMPLETE']){const list=(await f.packingContext('NCT')).lists.find(row=>row.id===created.id);await f.packing({action,id:list.id,revision:list.revision,...(action==='PROGRESS'?{lines:[{taskId:'A',packed:100,loaded,reason:'Capacity'}]}:{})},action==='SEND'?'SUPPORT':'WAREHOUSE');}return created.id;}
test('cumulative 80 then 100 consumes only 20 more; identical new save does not consume twice',async()=>{
 const f=fixture();await legacy(f);assert.equal((await f.stock()).onHand,70);
 await f.prepSave(await f.prepRequest({action:'LOAD',loaded:100}));assert.equal((await f.stock()).onHand,50);
 await f.prepSave(await f.prepRequest({action:'LOAD',loaded:100}));assert.equal((await f.stock()).onHand,50);
 const flows=readPhysicalOutflows((await f.context()).activity);assert.equal(flows.length,1);assert.equal(flows[0].sources.find(s=>s.sourceTaskId==='A').quantity,50);assert.equal(flows[0].sources.find(s=>s.sourceTaskId==='B').quantity,50);
});
test('successful Loaded cannot be lowered by an ordinary Warehouse correction or discarded by photos',async()=>{
 const f=fixture();await legacy(f);await assert.rejects(f.prepSave(await f.prepRequest({action:'LOAD',loaded:60,note:'Count correction'})),/supervised correction/);
 await f.prepSave(await f.prepRequest({action:'EXPIRY',expiryDate:'2027-05-01'}));assert.equal((await f.stock()).onHand,70);assert.equal(physicalOutflowQuantity((await f.context()).activity,{taskId:'A'}),80);
});
test('invoice and repeated Dispatch receipts reference Loaded without a second physical movement',async()=>{
 const f=fixture();await legacy(f,100);const selected=await f.fulfil({action:'SELECT',customerId:'CUSTOMER-A',lines:[{taskId:'A',quantity:100}]});await f.fulfil({action:'INVOICE',id:selected.shipmentId,number:'SI-ONLY',date:'2026-10-28',amountCents:240000});
 const request={company:'NCT',staff:f.staff,requestId:f.nextId(),input:{action:'DISPATCH',id:selected.shipmentId,reference:'DO-ONLY',reason:'Confirmed',version:shipmentVersion(await f.context())}};
 for(let i=0;i<3;i++)await f.fulfilSave(request);
 assert.equal((await f.stock()).onHand,50);assert.equal(readPhysicalOutflows((await f.context()).activity).length,1);
});
test('completed Packing Loaded can be invoiced through the actual Support factory, retrying the same receipt',async()=>{
 const f=fixture();await packing(f,80);const context=await f.context(),state=supportInvoiceState(context);
 const save=createSupportInvoiceOperations({store:f.store,names:{NCT:{activity:'N'}},readContext:f.context,saveFulfilment:f.fulfilSave,readRates:async()=>[{currency:'USD',rateToMyr:4}],now:()=>new Date('2026-10-28T08:00:00Z')});
 const request={company:'NCT',staff:{...f.staff,packingDepartment:'SUPPORT'},requestId:f.nextId(),input:{customerId:'CUSTOMER-A',orderId:'ORDER-A',version:state.version,number:'SUPPORT-PACKING-SI',lines:[{taskId:'A',quantity:80}]}};
 const first=await save(request),again=await save(request);assert.equal(first.shipmentId,again.shipmentId);assert.equal((await f.stock()).onHand,70);
 assert.equal(supportInvoiceState(await f.context()).lines.find(row=>row.taskId==='A').maxInvoiceQty,0);
 assert.equal((await f.context()).activity.filter(row=>row.action==='CUSTOMER_SHIPMENT_CHANGED'&&row.details.shipment.status==='INVOICED').length,1);
});
test('two loading entry points cannot record the same customer stock twice',async()=>{
 const f=fixture();await packing(f,80);const row=projectPreparation(await f.context()).find(row=>row.taskId==='A');await assert.rejects(f.prepSave({company:'NCT',staff:f.staff,requestId:f.nextId(),input:{action:'PACK',id:row.id,version:row.version}}),/packing list holds/);assert.equal((await f.stock()).onHand,70);
 const g=fixture();await legacy(g,80);await assert.rejects(g.packing({action:'CREATE',customerId:'CUSTOMER-A',currency:'USD',lines:[{taskId:'A',quantity:21}]}),/unarranged/);assert.equal((await g.stock()).onHand,70);
});
test('Loaded attribution cannot shift sources after later allocation changes',async()=>{
 const f=fixture();await legacy(f,80);const before=JSON.stringify(readPhysicalOutflows((await f.context()).activity)[0].sources);
 const row=f.records.get('N/ALLOCATION-B');row.details.targets=[{taskId:'A',quantity:40},{taskId:'B',quantity:60}];
 assert.equal(JSON.stringify(readPhysicalOutflows((await f.context()).activity)[0].sources),before);
});
test('a multi-line commit is rejected before any source is over-consumed',()=>{
 const context={activity:[],tasks:[{id:'SOURCE',warehouse:{hasPhysicalReceipt:true,stock:{usableReceived:50}}}]};
 assert.throws(()=>assertLoadedOutflows(context,[{id:'ONE',quantity:30,sources:[{sourceTaskId:'SOURCE',quantity:30}]},{id:'TWO',quantity:30,sources:[{sourceTaskId:'SOURCE',quantity:30}]}]),/exceeds usable physical/);
});
test('unknown old Loaded never silently uses the old Dispatch formula or guessed sources',async()=>{
 const f=fixture();await legacy(f);const activity=(await f.context()).activity;for(const row of activity.filter(row=>row.action==='WAREHOUSE_PREPARATION_SAVED'))delete row.details.state.physicalSources;
 assert.throws(()=>readPhysicalOutflows(activity),/source reconciliation/);
});
test('a caller cannot rewrite frozen Loaded references during invoice transition',async()=>{
 const f=fixture();await legacy(f,100);const selected=await f.fulfil({action:'SELECT',customerId:'CUSTOMER-A',lines:[{taskId:'A',quantity:80}]});await f.fulfil({action:'INVOICE',id:selected.shipmentId,number:'SI-TAMPER',date:'2026-10-28',amountCents:192000});
 const context=await f.context(),invoice=context.activity.find(row=>row.action==='CUSTOMER_SHIPMENT_CHANGED'&&row.details.shipment.status==='INVOICED');invoice.details.shipment.lines[0].physicalOutflowRefs[0].id='OTHER';
 assert.throws(()=>readPhysicalOutflows(context.activity),/snapshot cannot change/);
});

test('loading an anchored second batch first preserves the first batch stock and its source entitlement',async()=>{
 const f=fixture(),plan={id:'P',company:'NCT',customerId:'CUSTOMER-A',orderId:'ORDER-A',batches:[{sequence:1,label:'First',lines:[{taskId:'A',quantity:40,coverage:{committed:40,received:40},sourceCoverage:[{id:'A',quantity:40}]}]},{sequence:2,label:'Second',lines:[{taskId:'A',quantity:60,coverage:{committed:60,received:60},sourceCoverage:[{id:'A',quantity:10},{id:'B',quantity:50}]}]}]};
 f.records.set('N/PLAN',{_id:'PLAN',title:'PLAN',description:'P',action:'CUSTOMER_SHIPMENT_PLAN_SAVED',result:'SAVED',activityTime:'2026-10-28T00:00:00Z',initiatedByStaffId:'S',details:{beforeRevision:'',plan}});
 const act=async(index,input)=>{const row=projectPreparation(await f.context()).filter(row=>row.taskId==='A')[index];await f.prepSave(await f.prepRequest({...input,id:row.id,version:row.version}));};
 await act(1,{action:'PACK'});await act(1,{action:'LOAD',loaded:60});
 let rows=projectPreparation(await f.context()).filter(row=>row.taskId==='A');assert.deepEqual(Array.from(rows,row=>row.readyStock),[40,0]);
 assert.deepEqual(JSON.parse(JSON.stringify(readPhysicalOutflows((await f.context()).activity)[0].sources)),[{sourceTaskId:'A',quantity:10},{sourceTaskId:'B',quantity:50}]);
 await act(0,{action:'PACK'});await act(0,{action:'LOAD',loaded:40});assert.equal((await f.stock()).onHand,50);
 rows=projectPreparation(await f.context()).filter(row=>row.taskId==='A');assert.deepEqual(Array.from(rows,row=>row.readyStock),[0,0]);
});

test('concurrent Warehouse saves keep one company writer and the original failed request resumes without a duplicate outflow',async()=>{
 const f=fixture();f.tasks[1].ord=50;f.tasks[1].requested=50;
 const pack=async taskId=>{const row=projectPreparation(await f.context()).find(row=>row.taskId===taskId);await f.prepSave({company:'NCT',staff:f.staff,requestId:f.nextId(),input:{action:'PACK',id:row.id,version:row.version}});};
 await pack('A');await pack('B');const rows=projectPreparation(await f.context()),requests=rows.map(row=>({company:'NCT',staff:f.staff,requestId:f.nextId(),input:{action:'LOAD',id:row.id,version:row.version,loaded:row.quantity}}));
 const results=await Promise.allSettled(requests.map(request=>f.prepSave(request)));assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.match(results.find(row=>row.status==='rejected').reason.message,/duplicate|processing|changed/);
 const retry=requests[results.findIndex(row=>row.status==='rejected')];await f.prepSave(retry);await f.prepSave(retry);assert.equal((await f.stock()).onHand,0);assert.equal(readPhysicalOutflows((await f.context()).activity).length,2);
});

test('a reconciled immutable historical Dispatch is one historical physical fact, not a second Loaded deduction',async()=>{
 const f=fixture();await legacy(f,100);const selected=await f.fulfil({action:'SELECT',customerId:'CUSTOMER-A',lines:[{taskId:'A',quantity:100}]});await f.fulfil({action:'INVOICE',id:selected.shipmentId,number:'SYNTHETIC-OLD',date:'2026-10-28',amountCents:240000});await f.fulfil({action:'DISPATCH',id:selected.shipmentId,reference:'SYNTHETIC-OLD'});
 for(const row of f.records.values()){if(row.action==='CUSTOMER_SHIPMENT_CHANGED')for(const line of row.details.shipment.lines)delete line.physicalOutflowRefs;if(row.action==='WAREHOUSE_PREPARATION_SAVED')delete row.details.state.physicalSources;}
 const flows=readPhysicalOutflows((await f.context()).activity);assert.equal(flows.length,1);assert.equal(flows[0].kind,'HISTORICAL');assert.equal((await f.stock()).onHand,50);
});
