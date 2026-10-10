const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createPurchaseOperations}=load('purchaseOperations.js'),{taskEditVersion}=load('purchaseTaskIdentity.js'),{projectPurchaseWorkspace}=load('purchaseProjection.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){const rows=new Map(),id='a'.repeat(32),second='b'.repeat(32);let failAfter=0,writes=0;
 for(const [i,key] of [id,second].entries()) {
  rows.set('NCTTasks/'+key,{_id:key,title:key,description:'ORDER',imageAltText:'L'+i,purchaseQtyInCtn:250,rowPosition:i+1,supplierId:'S',purchaseStage:'NEW_INCOMING',lpPc:1,lpCtn:16,disc1:.1,disc2:.05,disc3:2,originalCostSnapshot:{lpCtn:16},latestCostReference:{netCostCtn:11.68},manualCostField:[]});
  rows.set('NCTOrders/O'+i,{_id:'O'+i,title:'ORDER',sourceLineId:'L'+i,submissionId:'SUB',customerId:'C',customerCompanyName:'CUSTOMER',description:'B'+i,image:'PRODUCT',imageAltText:'16EA',orderId:16,sellingPricePc:14.66,orderQtyInCtn:250});
 }
 rows.set('NCTActivity/R',{_id:'R',title:'R',description:'ORDER',action:'ORDER_RECEIVED',result:'ACCEPTED',details:{submissionId:'SUB',taskIds:[id,second]}});
 rows.set('SharedSuppliers/S',{_id:'S',title:'S',companyName:'SUPPLIER',shortName:'SUP',supplierStatus:'ACTIVE'});
 const all=c=>[...rows].filter(([key])=>key.startsWith(c+'/')).map(([,row])=>copy(row));
 const store={all:async c=>all(c),read:async(c,k)=>copy(rows.get(c+'/'+k)||null),one:async(c,criteria)=>all(c).find(row=>Object.entries(criteria).every(([key,value])=>row[key]===value))||null,
 insert:async(c,row)=>{if(rows.has(c+'/'+row._id))throw Error('duplicate');rows.set(c+'/'+row._id,copy(row));return copy(row);},update:async(c,row)=>{rows.set(c+'/'+row._id,copy(row));if(++writes===failAfter)throw Error('response lost');return copy(row);},remove:async(c,k)=>rows.delete(c+'/'+k)};
 const staff={staffId:'STF',staffName:'LAW',memberId:'MEMBER'},base={company:'NCT',requestId:'11111111-1111-4111-8111-111111111111',staff},operate=createPurchaseOperations({store});
 return {store,rows,id,second,base,operate,task:key=>rows.get('NCTTasks/'+(key||id)),versions:()=>Object.fromEntries([id,second].map(key=>[key,taskEditVersion(rows.get('NCTTasks/'+key))])),fail:n=>failAfter=n,
 workspace:()=>projectPurchaseWorkspace({company:'NCT',staff,orders:all('NCTOrders'),tasks:all('NCTTasks'),activity:all('NCTActivity'),suppliers:all('SharedSuppliers')})};}
test('manual prices derive cartons, preserve original/source quote, audit once and replay saved result',async()=>{const f=fixture(),before=copy(f.task()),input={edits:[{taskId:f.id,version:taskEditVersion(f.task()),changes:{lpPc:2,disc3:3}}]};const result=await f.operate({...f.base,operation:'EDIT',input});assert.equal(result.ok,true);assert.equal(f.task().lpCtn,32);assert.deepEqual(f.task().originalCostSnapshot,before.originalCostSnapshot);assert.equal(f.rows.get('NCTOrders/O0').sellingPricePc,14.66);assert(f.task().manualCostField.includes('lpCtn'));await f.operate({...f.base,operation:'EDIT',input});assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PRICE_SAVED').length,1);});
test('partial multirow save resumes exact prepared changes without losing later edits',async()=>{const f=fixture(),input={edits:[f.id,f.second].map(taskId=>({taskId,version:taskEditVersion(f.task(taskId)),changes:{disc3:1}}))};f.fail(1);await assert.rejects(f.operate({...f.base,operation:'EDIT',input}),/response lost/);await f.operate({...f.base,operation:'EDIT',input});assert.equal(f.task().disc3,1);assert.equal(f.task(f.second).disc3,1);});
test('P.O. validates one supplier/customer and records stage and identities without changing quantities',async()=>{const f=fixture(),input={taskIds:[f.id,f.second],versions:f.versions(),poNumber:'po-001'};await f.operate({...f.base,operation:'PO',input});assert.equal(f.task().ourPoNumber,'PO-001');assert.equal(f.task().purchaseStage,'WAITING_FOR_SUPPLIER_INV');assert.equal(f.task().purchaseQtyInCtn,250);assert.equal(f.workspace().tasks.length,2);});
test('special quantity writes remain disabled until allocation rules are confirmed',async()=>{const f=fixture();await assert.rejects(f.operate({...f.base,operation:'SPECIAL',input:{parentTaskId:f.id,version:taskEditVersion(f.task()),extraQty:20,reason:'Offer'}}),/awaiting confirmation/);assert.equal(f.workspace().tasks.length,2);});
test('reorder accepts only complete current customer set and cannot modify Sales ordering',async()=>{const f=fixture();await f.operate({...f.base,operation:'REORDER',input:{customerId:'C',taskIds:[f.second,f.id],versions:f.versions()}});assert.equal(f.workspace().tasks[0].id,f.second);assert.equal(f.rows.get('NCTOrders/O0').sourceLineId,'L0');});
test('invoice lock, stale edit, unaccepted task and foreign company reject before task writes',async()=>{const f=fixture(),input={edits:[{taskId:f.id,version:taskEditVersion(f.task()),changes:{lpCtn:20}}]};f.rows.get('NCTOrders/O0').salesInvoiceNumber='INV';await assert.rejects(f.operate({...f.base,operation:'EDIT',input}),/locked/);f.rows.get('NCTOrders/O0').salesInvoiceNumber='';f.task().disc3=4;await assert.rejects(f.operate({...f.base,requestId:'22222222-2222-4222-8222-222222222222',operation:'EDIT',input}),/changed/);await assert.rejects(f.operate({...f.base,company:'GHR',operation:'EDIT',input}),/accepted/);assert.equal(f.task().lpCtn,16);});

test('quantity requires supplier and reason, only reduces, preserves received/source/quote and replays once',async()=>{const f=fixture();f.task().receivedQtyInCtn=80;const run=(quantity,reason='Supplier stock shortage',requestId=f.base.requestId)=>f.operate({...f.base,requestId,operation:'QTY',input:{taskId:f.id,version:taskEditVersion(f.task()),quantity,reason}});f.task().supplierId='';await assert.rejects(run(90),/supplier/);f.task().supplierId='S';await assert.rejects(run(90,''),/reason/);await assert.rejects(run(251),/reduced/);const input={taskId:f.id,version:taskEditVersion(f.task()),quantity:90,reason:'Supplier stock shortage'};await f.operate({...f.base,operation:'QTY',input});await f.operate({...f.base,operation:'QTY',input});assert.equal(f.task().purchaseQtyInCtn,90);assert.equal(f.task().receivedQtyInCtn,80);assert.equal(f.rows.get('NCTOrders/O0').orderQtyInCtn,250);assert.equal(f.rows.get('NCTOrders/O0').sellingPricePc,14.66);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_QTY_REDUCED').length,1);assert.equal(f.workspace().tasks.find(row=>row.id===f.id).qtyEdited,true);await assert.rejects(run(95,'More stock','22222222-2222-4222-8222-222222222222'),/reduced/);await run(80,'Further shortage','33333333-3333-4333-8333-333333333333');assert.equal(f.task().purchaseQtyInCtn,80);});
test('quantity retry finishes missing history after a lost write response',async()=>{const f=fixture(),input={taskId:f.id,version:taskEditVersion(f.task()),quantity:90,reason:'Stock shortage'};f.fail(1);await assert.rejects(f.operate({...f.base,operation:'QTY',input}),/response lost/);await f.operate({...f.base,operation:'QTY',input});assert.equal(f.task().purchaseQtyInCtn,90);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_QTY_REDUCED').length,1);});

test('another decrease cannot pass an unfinished prior quantity save',async()=>{const f=fixture(),input={taskId:f.id,version:taskEditVersion(f.task()),quantity:90,reason:'Stock shortage'};f.fail(1);await assert.rejects(f.operate({...f.base,operation:'QTY',input}));await assert.rejects(f.operate({...f.base,requestId:'22222222-2222-4222-8222-222222222222',operation:'QTY',input:{...input,version:taskEditVersion(f.task()),quantity:80}}),/Previous quantity/);await f.operate({...f.base,operation:'QTY',input});assert.equal(f.task().purchaseQtyInCtn,90);});

test('average cost applies unrounded amount once, zeros discounts and audits employee/time without quantity changes',async()=>{
 const f=fixture(),before=copy(f.task()),input={taskId:f.id,version:taskEditVersion(f.task()),lineCost:921.50,cartons:11,note:'100 less 5% less 3%; buy ten get one'};
 await f.operate({...f.base,operation:'AVERAGE_COST',input});await f.operate({...f.base,operation:'AVERAGE_COST',input});
 assert.equal(f.task().lpCtn,921.5/11);assert.equal(f.task().lpPc,921.5/11/16);for(const key of ['disc1','disc2','disc3'])assert.equal(f.task()[key],0);
 assert.equal(f.task().purchaseQtyInCtn,before.purchaseQtyInCtn);assert.deepEqual(f.task().originalCostSnapshot,before.originalCostSnapshot);assert.equal(f.rows.get('NCTOrders/O0').sellingPricePc,14.66);
 const events=[...f.rows.values()].filter(row=>row.action==='PURCHASE_AVERAGE_COST_APPLIED');assert.equal(events.length,1);assert.equal(events[0].initiatedByStaffName,'LAW');assert.equal(events[0].initiatedByStaffId,'STF');assert(!isNaN(Date.parse(events[0].activityTime)));assert.equal(events[0].details.calculation.totalCtn,11);assert.equal(events[0].details.calculation.note,input.note);assert.equal(events[0].details.before.disc1,.1);
 assert.equal(f.workspace().tasks.find(row=>row.id===f.id).history.find(event=>event.action==='PURCHASE_AVERAGE_COST_APPLIED').changes.calculation.lineCost,921.5);
});
test('average cost refuses missing supplier, invalid amount/cartons and missing EA before business writes',async()=>{
 for(const patch of [{lineCost:-1},{lineCost:NaN},{lineCost:1.234},{cartons:0},{cartons:1.5},{cartons:10000}]){const f=fixture(),before=copy(f.task());await assert.rejects(f.operate({...f.base,operation:'AVERAGE_COST',input:{taskId:f.id,version:taskEditVersion(f.task()),lineCost:100,cartons:10,...patch}}));assert.deepEqual(f.task(),before);}
 for(const kind of ['supplier','EA']){const f=fixture();if(kind==='supplier')f.task().supplierId='';else f.rows.get('NCTOrders/O0').orderId=null;await assert.rejects(f.operate({...f.base,operation:'AVERAGE_COST',input:{taskId:f.id,version:taskEditVersion(f.task()),lineCost:100,cartons:10}}),kind==='supplier'?/supplier/:/EA/);}
});
test('average cost lost response retries exact calculation and invoice blocks cost changes',async()=>{
 const f=fixture(),input={taskId:f.id,version:taskEditVersion(f.task()),lineCost:100,cartons:11,note:'Offer'};f.fail(1);await assert.rejects(f.operate({...f.base,operation:'AVERAGE_COST',input}),/response lost/);await f.operate({...f.base,operation:'AVERAGE_COST',input});assert.equal(f.task().lpCtn,100/11);assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_AVERAGE_COST_APPLIED').length,1);
 f.rows.get('NCTOrders/O0').salesInvoiceNumber='INV';await assert.rejects(f.operate({...f.base,requestId:'22222222-2222-4222-8222-222222222222',operation:'AVERAGE_COST',input:{...input,version:taskEditVersion(f.task())}}),/locked/);
});

test('supplier extras do not increase customer commitment or create available stock; plan is audited once',async()=>{
 const f=fixture(),input={taskId:f.id,version:taskEditVersion(f.task()),planRevision:'',totalCtn:275,extraKind:'FREE_GOODS',confirmExtra:true,reason:'Buy ten get one'};
 await f.operate({...f.base,operation:'PLAN',input});await f.operate({...f.base,operation:'PLAN',input});
 assert.equal(f.task().purchaseQtyInCtn,250);assert.equal(f.rows.get('NCTOrders/O0').orderQtyInCtn,250);assert.equal(f.task().receivedQtyInCtn,undefined);
 const row=f.workspace().tasks.find(row=>row.id===f.id);assert.equal(row.procurement.totalCtn,275);assert.equal(row.procurement.expectedExtra,25);assert.equal(row.procurement.availableCtn,null);assert.equal(row.procurement.allocationEnabled,false);
 const events=[...f.rows.values()].filter(row=>row.action==='PURCHASE_PLAN_SAVED');assert.equal(events.length,1);assert.equal(events[0].initiatedByStaffName,'LAW');assert(!isNaN(Date.parse(events[0].activityTime)));assert(row.history.some(event=>event.action==='PURCHASE_PLAN_SAVED'));
 await assert.rejects(f.operate({...f.base,requestId:'22222222-2222-4222-8222-222222222222',operation:'PLAN',input:{...input,totalCtn:280}}),/changed/);
});

test('customer reduction after P.O. retains supplier total and increases expected surplus only',async()=>{
 const f=fixture();await f.operate({...f.base,operation:'PO',input:{taskIds:[f.id],versions:f.versions(),poNumber:'PO-1'}});
 await f.operate({...f.base,requestId:'22222222-2222-4222-8222-222222222222',operation:'QTY',input:{taskId:f.id,version:taskEditVersion(f.task()),quantity:240,reason:'Customer commitment reduced'}});
 const row=f.workspace().tasks.find(row=>row.id===f.id);assert.equal(row.ord,240);assert.equal(row.procurement.totalCtn,250);assert.equal(row.procurement.expectedExtra,10);
 const input={taskId:f.id,version:taskEditVersion(f.task()),planRevision:row.procurement.revision,totalCtn:240,reason:'Supplier accepted reduction'};
 await assert.rejects(f.operate({...f.base,requestId:'33333333-3333-4333-8333-333333333333',operation:'PLAN',input}),/supplier has agreed/);
 await f.operate({...f.base,requestId:'44444444-4444-4444-8444-444444444444',operation:'PLAN',input:{...input,supplierConfirmed:true}});
 assert.equal(f.workspace().tasks.find(row=>row.id===f.id).procurement.expectedExtra,0);
});

test('procurement safeguards require supplier, explicit extra type/confirmation and current company identities',async()=>{
 for(const patch of [{confirmExtra:false},{extraKind:''},{totalCtn:249},{totalCtn:10000},{totalCtn:250.5},{reason:''}]){const f=fixture();await assert.rejects(f.operate({...f.base,operation:'PLAN',input:{taskId:f.id,version:taskEditVersion(f.task()),planRevision:'',totalCtn:275,extraKind:'FREE_GOODS',confirmExtra:true,reason:'Offer',...patch}}));assert.equal(f.workspace().tasks[0].procurement.totalCtn,null);}
 const f=fixture();f.task().supplierId='';await assert.rejects(f.operate({...f.base,operation:'PLAN',input:{taskId:f.id,version:taskEditVersion(f.task()),planRevision:'',totalCtn:250,reason:'Plan'}}),/supplier/);
 await assert.rejects(f.operate({...f.base,company:'GHR',operation:'PLAN',input:{taskId:f.id}}),/accepted/);
});

test('zero quantity and reduction below received cartons cannot masquerade as ordinary reduction',async()=>{
 for(const quantity of [0,79]){const f=fixture();f.task().receivedQtyInCtn=80;await assert.rejects(f.operate({...f.base,operation:'QTY',input:{taskId:f.id,version:taskEditVersion(f.task()),quantity,reason:'Shortage'}}));assert.equal(f.task().purchaseQtyInCtn,250);}
});

test('lost plan-audit write blocks competing saves and resumes the exact original operation',async()=>{
 const f=fixture(),insert=f.store.insert;let lose=true;
 f.store.insert=async(c,row)=>{if(row.action==='PURCHASE_PLAN_SAVED'&&lose){lose=false;throw Error('response lost');}return insert(c,row);};
 const input={taskId:f.id,version:taskEditVersion(f.task()),planRevision:'',totalCtn:275,extraKind:'FREE_GOODS',confirmExtra:true,reason:'Offer'};
 await assert.rejects(f.operate({...f.base,operation:'PLAN',input}),/response lost/);
 await assert.rejects(f.operate({...f.base,requestId:'22222222-2222-4222-8222-222222222222',operation:'PLAN',input:{...input,totalCtn:280}}),/pending/);
 await f.operate({...f.base,operation:'PLAN',input});assert.equal(f.workspace().tasks.find(row=>row.id===f.id).procurement.totalCtn,275);
 assert.equal([...f.rows.values()].filter(row=>row.action==='PURCHASE_PLAN_SAVED').length,1);
});

test('plan revisions reject branched history instead of displaying invented available inventory',async()=>{
 const f=fixture(),input={taskId:f.id,version:taskEditVersion(f.task()),planRevision:'',totalCtn:275,extraKind:'FREE_GOODS',confirmExtra:true,reason:'Offer'};
 await f.operate({...f.base,operation:'PLAN',input});const event=[...f.rows.values()].find(row=>row.action==='PURCHASE_PLAN_SAVED');f.rows.set('NCTActivity/FORK',{...copy(event),_id:'FORK',title:'FORK'});
 assert.throws(()=>f.workspace(),/history requires review/);
});
