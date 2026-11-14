const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const repo=path.resolve(__dirname,'..');
const load=require(path.join(repo,'tests/load-master-module.cjs'));
function candidate(relative, extra={}){
 const source=fs.readFileSync(path.join(repo,relative),'utf8'), bindings={...extra};
 const clean=source.replace(/^import \{([^}]+)\} from '([^']+)';\r?$/gm,(_,names,target)=>{
  for(const name of names.split(',').map(n=>n.trim())) if(!(name in bindings)) bindings[name]=(target.startsWith('backend/')?load(target.slice(8)):require(target))[name];
  return '';
 });
 const names=[...clean.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(x=>x[1]);
 return vm.runInNewContext('(function(){'+clean.replace(/^export /gm,'')+'\nreturn {'+names.join(',')+'};})()',bindings);
}
const membershipModel=candidate('backend/shortloadResolutionModel.js');
const supportDesk=candidate('backend/supportDesk.js',membershipModel);
const {createSupportDeskOperations,supportDeskBatchId,readSupportDesks}=supportDesk;
const staff={staffId:'S',staffName:'Support Test',memberId:'M',packingDepartment:'SUPPORT'};
const same=(actual,expected)=>assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected);
async function setup(inc=100){
 const company='NCT', customerId='CUST';
 const rows=new Map();
 const tasks=['A','B','C'].map(id=>({id,customerId,company,ord:100,requested:100,inc,transactionCurrency:'USD'}));
 const context=()=>({company,tasks,activity:[...rows.values()]});
 const desk=()=>readSupportDesks(context().activity,company)[0];
 const save=createSupportDeskOperations({names:{NCT:{activity:'a'}},store:{read:async(c,id)=>rows.get(id),remove:async(c,id)=>rows.delete(id),insert:async(c,row)=>{if(rows.has(row._id))throw Error('duplicate');rows.set(row._id,row);return row;}},readContext:async()=>context()});
 const request=(action,fields,requestId=crypto.randomUUID())=>({company,staff,requestId,input:{action,customerId,desk:1,revision:desk()?.revision||'',...fields}});
 for(const task of tasks.slice(0,2))await save(request('DESK_ASSIGN',{taskId:task.id}));
 await save(request('DESK_ASSIGN',{taskId:'C',desk:2}));
 return {save,request,desk,rows,tasks,context,batch:()=>supportDeskBatchId(desk(),1)};
}
test('one saved batch order survives reread and repeated request; quantities are unchanged',async()=>{
 const f=await setup(), original=JSON.stringify(f.desk().assignments), op=f.request('DESK_ORDER',{taskIds:['B','A'],batchId:f.batch()});
 const first=await f.save(op), second=await f.save(op);
 assert.equal(first.deskState.revision,second.deskState.revision);
 same(f.desk().rowOrders,[{desk:1,batchId:f.batch(),taskIds:['B','A']}]);
 assert.equal(JSON.stringify(f.desk().assignments),original);
});
test('wrong batch and row from another Desk cannot save',async()=>{
 const f=await setup();
 await assert.rejects(f.save(f.request('DESK_ORDER',{taskIds:['B','A'],batchId:'old-batch'})),/Desk details changed/);
 await assert.rejects(f.save(f.request('DESK_ORDER',{taskIds:['B','C'],batchId:f.batch()})),/Desk details changed/);
 assert.equal(f.desk().rowOrders,undefined);
});
test('one unreceived row blocks changing Invoice No. without blocking ordinary shipment details',async()=>{
 const f=await setup();f.tasks[1].inc=99;
 const details={poNo:'',soNo:'',invoiceNoDraft:'NCT-INV-TEST',depositAmountCents:null,depositDate:'',depositCurrency:''};
 const input={transport:'',date:'',arrival:'',lastGateIn:'',departureDate:'',details};
 await assert.rejects(f.save(f.request('DESK_SHIPMENT',input)),/Complete receiving/);
 await f.save(f.request('DESK_SHIPMENT',{...input,details:{...details,invoiceNoDraft:''}}));
 f.tasks[1].inc=100;
 await f.save(f.request('DESK_SHIPMENT',input));
 assert.equal(f.desk().references[0].invoiceNoDraft,'NCT-INV-TEST');
});
test('warehouse polling and archive apply saved order without changing task identity',()=>{
 const source=fs.readFileSync(path.join(repo,'backend/packingListService.js'),'utf8');
 const sort=vm.runInNewContext(source.slice(source.indexOf('function orderDeliveryRows('),source.indexOf('export async function readPackingWorkroom'))+';orderDeliveryRows');
 const list={id:'LIST',lines:[{taskId:'A',loaded:3},{taskId:'B',loaded:0},{taskId:'C',loaded:0}]};
 same(sort(list,['B','A']).lines.map(row=>[row.taskId,row.loaded]),[['B',0],['A',3],['C',0]]);
 same(list.lines.map(row=>row.taskId),['A','B','C']);
});
test('Warehouse reads the matching batch order and historical snapshot separately',async()=>{
 const f=await setup(), batch=f.batch();
 const id={id:'LIST',company:'NCT',customerId:'CUST',status:'SENT',desk:{number:1,batchId:batch},
  lines:[{taskId:'A',quantity:100,loaded:0},{taskId:'B',quantity:100,loaded:0}]};
 const archived={...id,id:'OLD',status:'COMPLETED',desk:{...id.desk,batchId:'OLD-BATCH'}};
 const oldInvoice={customerId:'CUST',desk:1,status:'ISSUED',snapshot:{batchId:'OLD-BATCH',rowOrder:['A','B']}};
 await f.save(f.request('DESK_ORDER',{taskIds:['B','A'],batchId:batch}));
 const states=[{...f.desk(),deliveryHolds:[{desk:1,listId:id.id}]}];
 const {readPackingWorkroom}=candidate('backend/packingListService.js',{
  fulfilmentStore:{},readFulfilmentContext:async()=>f.context(),projectPackingContext:physicalContext=>({physicalContext}),
  projectPackingWorkroom:()=>({lists:[id,archived],version:'V',readAt:'T'}),
  readSupportDeskLocks:()=>[oldInvoice],readSupportDesks:()=>states,currentSupportDeskState:(_,state)=>state,
  PURCHASE_COLLECTIONS:{NCT:{activity:'a'}},requestPurchaseDocument:async()=>{},createPackingListOperations:()=>{},
  createShortloadResolutionOperations:()=>{},packingAvailability:()=>[],projectWarehouseDeliveryList:list=>list
 });
 const result=await readPackingWorkroom('NCT',{packingDepartment:'WAREHOUSE',staffName:'W'});
 same(result.lists[0].lines.map(row=>row.taskId),['B','A']);
 same(result.completedLists[0].lines.map(row=>row.taskId),['A','B']);
 assert.equal(result.lists[0].lines[0].quantity,100);
});
test('same Desk receipt gate does not borrow receipt quantity from a different Desk',async()=>{
 const f=await setup(100);
 await f.save(f.request('DESK_SPLIT',{taskId:'A',parts:[{desk:1,quantity:60},{desk:2,quantity:40}]}));
 f.tasks[0].inc=70;
 const {deskReceiptsComplete}=candidate('backend/supportDesk.js');
 assert.equal(deskReceiptsComplete(f.context(),f.desk(),'CUST',1),true);
 assert.equal(deskReceiptsComplete(f.context(),f.desk(),'CUST',2),false);
});
test('a stale sort cannot overwrite a newer Desk revision',async()=>{
 const f=await setup();
 const prior=f.request('DESK_ORDER',{taskIds:['A','B'],batchId:f.batch()});
 await f.save(f.request('DESK_ORDER',{taskIds:['B','A'],batchId:f.batch()}));
 await assert.rejects(f.save(prior),/Desk details changed/);
 same(f.desk().rowOrders[0].taskIds,['B','A']);
});
test('invoice confirmation cannot bypass incomplete receiving by calling the server directly',async()=>{
 const f=await setup();
 const {checkSupportDeskInvoice}=candidate('backend/supportDesk.js');
 f.tasks[1].inc=75;
 const input={customerId:'CUST',desk:{number:1,revision:f.desk().revision},lines:[{taskId:'A',quantity:100},{taskId:'B',quantity:100}]};
 const readiness={lines:[{taskId:'A',maxInvoiceQty:100},{taskId:'B',maxInvoiceQty:100}]};
 assert.throws(()=>checkSupportDeskInvoice(f.context(),readiness,input),/Complete receiving/);
 assert.equal(f.desk().locks?.length||0,0);
});

function openDeskFixture(){
 const {fixture}=require(path.join(repo,'prototypes/stock-loaded-contract-20261028/check-current.cjs'));
 const f=fixture(), names={NCT:{activity:'N'}};
 const delivery=candidate('backend/deskDelivery.js',{...membershipModel,...supportDesk});
 const {createPackingListOperations}=candidate('backend/packingListOperations.js',{...membershipModel,...supportDesk,...delivery});
 const {projectPackingContext}=candidate('backend/packingListContext.js',{...membershipModel,...supportDesk,...delivery});
 const readContext=async company=>projectPackingContext(await f.context(company));
 const assign=createSupportDeskOperations({store:f.store,names,readContext:f.context});
 const packing=createPackingListOperations({store:f.store,names,readContext});
 const state=async()=>readSupportDesks((await f.context()).activity,'NCT')[0];
 const send=(input,department='SUPPORT',requestId=f.nextId())=>packing({company:'NCT',staff:{...f.staff,packingDepartment:department},requestId,input});
 const move=async(fields,requestId=f.nextId())=>assign({company:'NCT',staff:{...f.staff,packingDepartment:'SUPPORT'},requestId,input:{
  action:'DESK_ASSIGN',customerId:'CUSTOMER-A',taskId:'A',desk:1,revision:(await state())?.revision||'',...fields}});
 const open=async(desk,lines)=>send({action:'DESK_SEND',customerId:'CUSTOMER-A',desk,deskRevision:(await state()).revision,lines});
 const read=async id=>(await readContext('NCT')).lists.find(row=>row.id===id);
 return {...f,state,send,move,open,read};
}
test('open Warehouse Desk removes a wholly moved row and rejects the stale load',async()=>{
 const f=openDeskFixture();
 await f.move({});
 const sent=await f.open(1,[{taskId:'A',quantity:100}]);
 assert.equal((await f.read(sent.id)).lines.length,1);
 await f.move({desk:2});
 assert.equal((await f.read(sent.id)).lines.length,0);
 await assert.rejects(f.send({action:'DESK_LOAD',id:sent.id,revision:sent.revision,taskId:'A',loaded:100},'WAREHOUSE'),/Authorized task changed/);
 assert.equal((await f.stock()).onHand,150);
});
test('open destination Desk picks up the moved row and loads with the new saved membership',async()=>{
 const f=openDeskFixture(), base=f.tasks[0];
 f.tasks.push({...base,id:'C',orderId:'ORDER-C',sourceLineId:'LINE-C',inc:0,warehouse:{hasPhysicalReceipt:false,accepted:0}});
 await f.move({});
 await f.move({desk:2,taskId:'C'});
 const origin=await f.open(1,[{taskId:'A',quantity:100}]);
 const target=await f.open(2,[{taskId:'C',quantity:100}]);
 await f.move({desk:2});
 const updated=await f.read(target.id),moved=updated.lines.find(line=>line.taskId==='A');
 assert.equal((await f.read(origin.id)).lines.length,0);
 assert.equal(moved.quantity,100);
 assert(moved.membershipVersion);
 const context=await f.context();
 const committed=membershipModel.readDeskCommitments(context.activity,'NCT','A',context.tasks.find(task=>task.id==='A'),await f.state());
 same(committed.batches.map(row=>[row.desk,row.quantity]),[[2,100]]);
 const input={action:'DESK_LOAD',id:target.id,revision:target.revision,taskId:'A',membershipVersion:moved.membershipVersion,loaded:100};
 const attempt=f.nextId();
 await f.send(input,'WAREHOUSE',attempt);
 await f.send(input,'WAREHOUSE',attempt);
 assert.equal((await f.stock()).onHand,50);
 await assert.rejects(f.move({desk:3}),/loaded|confirmed/i);
});
test('in-flight Warehouse save excludes Support move; confirmed physical quantity stays on its Desk',async()=>{
 const f=openDeskFixture();
 await f.move({});
 const sent=await f.open(1,[{taskId:'A',quantity:100}]);
 const persist=f.store.update;
 let reached,release;
 const writing=new Promise(resolve=>{reached=resolve;});
 const hold=new Promise(resolve=>{release=resolve;});
 f.store.update=async(collection,row)=>{
  if(row.action==='SUPPORT_PACKING_LIST_CURRENT'&&row.details.list.lines.some(line=>line.loaded)){reached();await hold;}
  return persist(collection,row);
 };
 const loaded=f.send({action:'DESK_LOAD',id:sent.id,revision:sent.revision,taskId:'A',loaded:100},'WAREHOUSE');
 await writing;
 try{await assert.rejects(f.move({desk:2}),/still processing/);}finally{release();}
 await loaded;
 await assert.rejects(f.move({desk:2}),/loaded|confirmed/i);
 assert.equal((await f.read(sent.id)).lines[0].loaded,100);
 assert.equal((await f.stock()).onHand,50);
});
test('split an opened line to Pending and keep only the retained quantity available on that Desk',async()=>{
 const f=openDeskFixture();
 await f.move({});
 const sent=await f.open(1,[{taskId:'A',quantity:100}]);
 const split={action:'DESK_SPLIT',parts:[{desk:1,quantity:60},{desk:0,quantity:40}],revision:(await f.state()).revision};
 const requestId=f.nextId();
 f.lose('SUPPORT_DESK_SAVED');
 const saved=await f.move(split,requestId);
 assert.equal((await f.move(split,requestId)).deskState.revision,saved.deskState.revision);
 const [line]=(await f.read(sent.id)).lines;
 assert.equal(line.requestedQuantity,60);
 assert.equal(line.quantity,60);
 await assert.rejects(f.send({action:'DESK_LOAD',id:sent.id,revision:sent.revision,taskId:'A',loaded:100},'WAREHOUSE'),/Authorized task changed/);
 assert.equal((await f.stock()).onHand,150);
});
test('already-open Desk picks up its legacy assigned rows without any new save',async()=>{
 const f=openDeskFixture(),base=f.tasks[0];
 await f.move({});
 const sent=await f.open(1,[{taskId:'A',quantity:100}]);
 f.tasks.push({...base,id:'C',orderId:'ORDER-C',sourceLineId:'LINE-C',inc:0,warehouse:{hasPhysicalReceipt:false,accepted:0}});
 const state=await f.state(), record=f.records.get('N/'+state.revision);
 record.details.state.assignments.push({taskId:'C',desk:1,parts:[{desk:1,quantity:70},{desk:0,quantity:30}]});
 const count=f.records.size, list=await f.read(sent.id);
 const line=list.lines.find(row=>row.taskId==='C');
 assert.equal(line.requestedQuantity,70);
 assert.equal(line.quantity,0);
 assert.equal(f.records.size,count);
});
