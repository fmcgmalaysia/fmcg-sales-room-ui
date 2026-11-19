'use strict';
// Offline counterexamples and dependency proof, NOT a production query or migration.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {setup,request}=require('./read-growth-contract.cjs');
const load=require('../../tests/load-master-module.cjs');
const {projectPurchaseWorkspace}=load('purchaseProjection.js');
const {confirmedPurchaseState,readPurchasePlan,requireConfirmedProcurement}=load('purchasePlan.js');
const {projectPurchaseOrders}=load('purchaseOrderWorkflow.js');
const {projectWarehouseOrders,createWarehouseOperations,readWarehouseReceipts}=load('warehouseReceiving.js');
const {readAllocationLoans}=load('customerAllocationContext.js');
const {readAllocations,allocatedTo}=load('plannerAllocation.js');
const {projectStockCard}=load('stockCardProjection.js');
const {procurementContentLock}=load('paymentHandoff.js');
const {operationId}=load('purchaseOperationJournal.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const rid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const report={schema:1,baseline:'7ad78a2 / bf2815c',productionWrites:0,checks:[],growth:[],
 limitations:['Synthetic in-memory data passed to current production functions; no live business transaction.',
 'Known dependency rows are selected by an offline oracle; discovery still reads the complete fixture. This is NOT a bounded Wix query.',
 'No Wix index plan, server latency, million-row capacity or complete replacement-reader acceptance is claimed.',
 'Loan and archived-stock cases test actual component readers with explicit valid event fixtures, not the entire UI workflow.']};
const check=(id,result)=>report.checks.push({id,...result});
function context(f){const rows=collection=>[...f.rows].filter(([key])=>key.startsWith(collection+'/')).map(([,row])=>copy(row));return {company:'NCT',staff:f.base.staff,orders:rows('NCTOrders'),tasks:rows('NCTTasks'),activity:rows('NCTActivity'),suppliers:rows('SharedSuppliers')};}
const project=raw=>projectPurchaseWorkspace(raw);
// Wall-clock response metadata is not a business result; preserve every other field.
const stableProject=raw=>{const result=copy(project(raw));delete result.fetchedAt;return result;};
const target=(raw,id)=>project(raw).tasks.find(row=>row.id===id);
const topLevel=(row,ids)=>['title','description','image','imageAltText'].some(key=>ids.has(row[key]));
async function seed(){const f=setup();await f.operate(request(f,1));await f.operate({...f.base,requestId:rid(2),operation:'PO',input:{taskIds:[f.id],versions:f.versions(),poNumber:'OFFLINE-SCOPE'}});return f;}
async function warehouse(f){const raw=context(f),workspace=project(raw);return projectWarehouseOrders({company:'NCT',purchaseOrders:projectPurchaseOrders({company:'NCT',workspace,records:[]}),tasks:workspace.tasks,activity:raw.activity});}
async function run(){
 // The order-intake receipt protects all sibling identities, not just the selected task.
 const f=await seed(),raw=context(f),single={...copy(raw),tasks:raw.tasks.filter(row=>row.title===f.id),orders:raw.orders.filter(row=>row.sourceLineId==='L0')};
 let siblingError;try{project(single);}catch(e){siblingError=e.message;}
 assert.ok(siblingError);check('S01',{observation:'Selecting one task without accepted-order siblings fails the existing intake integrity check.',error:siblingError});

 // A real interrupted PLAN: prepared request identity is not stored in top-level task/order fields.
 const pending=await seed(),r=request(pending,3,32,200),insert=pending.store.insert;
 pending.store.insert=async(c,row)=>{if(row.action==='PURCHASE_PRICE_SAVED')throw Error('OFFLINE_INTERRUPTION');return insert(c,row);};
 await assert.rejects(pending.operate(r),/OFFLINE_INTERRUPTION/);pending.store.insert=insert;
 const interrupted=context(pending),ids=new Set([pending.id,pending.second,'ORDER','L0','L1']);
 const naive={...copy(interrupted),activity:interrupted.activity.filter(row=>topLevel(row,ids))};
 const fullPending=confirmedPurchaseState(interrupted),naivePending=confirmedPurchaseState(naive);
 assert.equal(fullPending.pending.length,1);assert.equal(naivePending.pending.length,0);
 assert.throws(()=>requireConfirmedProcurement(fullPending,[pending.id]),/save pending/i);
 assert.doesNotThrow(()=>requireConfirmedProcurement(naivePending,[pending.id]));
 const beforePrice=target(interrupted,pending.id).lpCtn,wrongPrice=target(naive,pending.id).lpCtn;
 assert.equal(beforePrice,16);assert.equal(wrongPrice,32);
 check('S02',{observation:'Naive task/order filtering omits PREPARED, exposes an unconfirmed price and removes its save guard.',confirmedPrice:beforePrice,incorrectPrice:wrongPrice,fullPending:1,filteredPending:0});
 await pending.operate(r);const size=pending.rows.size;await pending.operate(r);assert.equal(pending.rows.size,size);
 check('S03',{observation:'Complete evidence permits original-request recovery and replay adds no rows.',additionalRowsOnReplay:0});

 // Generate actual receipt events through the existing writer, in two different months.
 let receiptDate='2026-10-31T04:00:00Z';
 const receive=createWarehouseOperations({store:f.store,names:{NCT:{activity:'NCTActivity'}},readOrders:()=>warehouse(f),now:()=>new Date(receiptDate)});
 async function delivery(n,qty,kind,reason){const po=(await warehouse(f))[0];return receive.save({...f.base,requestId:rid(n),input:{id:po.id,version:po.version,action:'RECEIVE',lines:[{taskId:f.id,accepted:qty,rejected:0,kind,reason}]}});}
 await delivery(10,170,'PARTIAL','Remaining 30 later');receiptDate='2026-11-01T04:00:00Z';await delivery(11,30,'DELIVERY','Completed');
 const received=context(f),poId=(await warehouse(f))[0].id,receipts=readWarehouseReceipts(poId,received.activity);
 assert.equal(receipts.lines[0].accepted,200);
 const taskOnlyActivity=received.activity.filter(row=>topLevel(row,new Set([f.id,f.second,'ORDER','L0','L1'])));
 assert.equal(readWarehouseReceipts(poId,taskOnlyActivity).lines.length,0);
 check('S04',{observation:'Task/order identifiers alone omit PO-keyed receipt batches.',fullAccepted:200,filteredReceiptLines:0,receiptBatches:receipts.history.length});
 assert.throws(()=>readWarehouseReceipts(poId,receipts.history.slice(-1)),/history requires review/);
 check('S05',{observation:'November receipt alone cannot replace the October170 + November30 receipt chain.',accepted:200,lastBatchDelta:30});

 // Compare the entire projection with unrelated history, including the confirmed-state view.
 const known=copy(received),knownIds=new Set(known.activity.map(row=>row.title));
 for(const n of [0,1000,100000]){
  const expanded={...copy(known),activity:known.activity.concat(Array.from({length:n},(_,i)=>({title:'UNRELATED-'+i,description:'OTHER-ORDER',action:'DIAGNOSTIC_UNRELATED_HISTORY',result:'SAVED',details:{},activityTime:'2020-01-01T00:00:00Z'})))};
  const scoped={...expanded,activity:expanded.activity.filter(row=>knownIds.has(row.title))};
  const full=stableProject(expanded),selected=stableProject(scoped);assert.equal(hash(full),hash(selected));
  assert.equal(target(expanded,f.id).warehouse.accepted,200);
  report.growth.push({unrelatedRows:n,fullActivityRows:expanded.activity.length,knownDependencyRows:scoped.activity.length,resultHash:hash(full)});
 }
 assert.equal(new Set(report.growth.map(row=>row.resultHash)).size,1);
 check('S06',{observation:'Full and known-dependency projections match with 100000 unrelated records. Efficient dependency discovery is not proven.'});

 // Related history still grows even after all unrelated records have been excluded.
 const task={title:'TASK',description:'ORDER',imageAltText:'LINE'};
 for(const count of [1,10,100,1000]){
  const events=Array.from({length:count},(_,i)=>({title:'PLAN-'+i,action:'PURCHASE_PLAN_SAVED',result:'SAVED',description:'ORDER',image:'LINE',imageAltText:'TASK',activityTime:'2026-11-01T00:00:00Z',details:{beforeRevision:i?'PLAN-'+(i-1):'',totalCtn:200+i%2}}));
  assert.equal(readPurchasePlan(task,events).totalCtn,200+(count-1)%2);
  if(count>1)assert.throws(()=>readPurchasePlan(task,events.slice(-1)),/history requires review/);
 }
 check('S07',{observation:'A single task with1000 revisions still requires its full version chain; latest-only is rejected.',relatedRevisions:[1,10,100,1000]});

 // Valid grouped allocation fixture: event is attached to borrower A, while lender B is nested.
 const loan={id:'LOAN',borrowerTaskId:'A',lenderTaskId:'B',borrowerBatchId:'A1',quantity:30,outstanding:30,sources:[{sourceTaskId:'SB',lenderBatchId:'B1',quantity:30}]};
 const borrowed={title:'BORROW',description:'A',image:'CA',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:'2026-10-31T04:00:00Z',details:{company:'NCT',allocations:[{sourceTaskId:'SB',beforeRevision:'',targets:[{taskId:'A',quantity:30},{taskId:'B',quantity:250}]}],loanChanges:[{id:'LOAN',beforeRevision:'',state:loan}]}};
 const repaid={title:'REPAY',description:'A',image:'CA',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',activityTime:'2026-11-01T04:00:00Z',details:{company:'NCT',allocations:[{sourceTaskId:'NEW',beforeRevision:'',targets:[{taskId:'B',quantity:10}]}],loanChanges:[{id:'LOAN',beforeRevision:'BORROW',state:{...copy(loan),outstanding:20}}]}};
 const borrowing=[borrowed,repaid];assert.equal(readAllocationLoans(borrowing)[0].outstanding,20);assert.equal(allocatedTo('B',borrowing).quantity,260);
 const lenderFilter=borrowing.filter(row=>topLevel(row,new Set(['B','CB','SB'])));
 assert.equal(readAllocationLoans(lenderFilter).length,0);assert.equal(allocatedTo('B',lenderFilter).quantity,0);
 assert.throws(()=>readAllocationLoans([repaid]),/history requires review/);
 check('S08',{observation:'Lender-only top-level filtering loses cross-customer ownership and the remaining cross-month debt.',fullLenderAllocation:260,loanOutstanding:20,filteredLenderAllocation:0,filteredLoanCount:0});

 const product={customerId:'C',barcode:'SKU',name:'TEST',packing:'12x1',ea:12,po:'PO-1'};
 const old={...product,id:'OLD-FOC',specialPurchase:true,ord:0,requested:0,procurement:{totalCtn:20,customerCtn:0},warehouse:{hasPhysicalReceipt:true,accepted:20},archived:true};
 const active={...product,id:'ACTIVE',ord:200,requested:200,procurement:{totalCtn:200,customerCtn:200},warehouse:{hasPhysicalReceipt:true,accepted:200}};
 const stock=tasks=>projectStockCard({company:'NCT',tasks,activity:[]}).items[0];
 assert.equal(stock([old,active]).onHand,220);assert.equal(stock([old,active]).available,20);assert.equal(stock([active]).onHand,200);assert.equal(stock([active]).available,0);
 check('S09',{observation:'Closed-task filtering discards still-usable stock from an old FOC source.',fullOnHand:220,fullFree:20,activeOnlyOnHand:200,activeOnlyFree:0});

 // Finance's authoritative PO record is necessary even when no new-month payment exists.
 const finance={finance:{payments:[{confirmed:true,direction:'PAYMENT',cents:160000,at:'2026-10-31T04:00:00Z'}]}};
 assert.match(procurementContentLock(finance),/permanently locked/);assert.equal(procurementContentLock({}),'');
 const paidWorkspace=project(known),record={_id:poId,company:'NCT',details:{taskIds:[f.id],...finance}};
 const paid=projectPurchaseOrders({company:'NCT',workspace:paidWorkspace,records:[record]})[0];
 const omitted=projectPurchaseOrders({company:'NCT',workspace:paidWorkspace,records:[]})[0];
 assert.equal(paid.procurementContentLocked,true);assert.equal(omitted.procurementContentLocked,false);
 check('S10',{observation:'Omitting the authoritative PO finance record incorrectly removes an existing paid lock.',fullLocked:true,omittedLocked:false});

 // Current Desk loading is the consumption authority, including completed old-month lists.
 const list={id:'LIST',company:'NCT',customerId:'C',status:'COMPLETED',desk:{number:1},lines:[{taskId:'ACTIVE',loaded:150,physicalSources:[{sourceTaskId:'ACTIVE',quantity:150}]}]};
 const loaded={_id:operationId('NCT','LIST','PACKING_CURRENT'),title:'CURRENT',action:'SUPPORT_PACKING_LIST_CURRENT',activityTime:'2026-10-31T04:00:00Z',details:{list}};
 const isolated={title:'ISOLATE',imageAltText:'ACTIVE',action:'STOCK_EXCEPTION_REPORTED',result:'SAVED',initiatedByStaffId:'W',activityTime:'2026-10-31T05:00:00Z',details:{company:'NCT',quantity:10,kind:'INTERNAL_DAMAGE',reason:'Damaged cartons'}};
 const stockAfter=projectStockCard({company:'NCT',tasks:[active],activity:[loaded,isolated]}).items[0];
 assert.equal(stockAfter.onHand,50);assert.equal(stockAfter.isolated,10);assert.equal(stockAfter.usableOnHand,40);
 const cut=projectStockCard({company:'NCT',tasks:[active],activity:[]}).items[0];assert.equal(cut.onHand,200);assert.equal(cut.isolated,0);
 check('S11',{observation:'Dropping old-month completed Desk and unresolved isolation overstates current stock; these are still live dependencies.',fullOnHand:50,fullIsolated:10,fullUsable:40,cutOnHand:200,cutIsolated:0});

 // Two customers can share one supplier PO; customer-only reads cannot split that identity.
 const merged=setup();merged.task(merged.second).description='ORDER2';
 Object.assign(merged.rows.get('NCTOrders/O1'),{title:'ORDER2',submissionId:'SUB2',customerId:'CB',customerCompanyName:'CUSTOMER B'});
 merged.rows.get('NCTActivity/R').details.taskIds=[merged.id];
 merged.rows.set('NCTActivity/R2',{_id:'R2',title:'R2',description:'ORDER2',action:'ORDER_RECEIVED',result:'ACCEPTED',details:{submissionId:'SUB2',taskIds:[merged.second]}});
 await merged.operate(request(merged,1));
 const secondRequest=request(merged,2,16,150);Object.assign(secondRequest.input,{taskId:merged.second,version:merged.versions()[merged.second],planRevision:''});await merged.operate(secondRequest);
 await merged.operate({...merged.base,requestId:rid(3),operation:'PO',input:{taskIds:[merged.id,merged.second],versions:merged.versions(),poNumber:'OFFLINE-MERGED'}});
 const mergedWorkspace=merged.workspace(),mergedRecord={_id:'MERGED',company:'NCT',details:{taskIds:[merged.id,merged.second]}};
 const completePo=projectPurchaseOrders({company:'NCT',workspace:mergedWorkspace,records:[mergedRecord]})[0];assert.equal(completePo.taskIds.length,2);assert.equal(completePo.amount,5600);
 assert.throws(()=>projectPurchaseOrders({company:'NCT',workspace:{...mergedWorkspace,tasks:mergedWorkspace.tasks.filter(row=>row.customerId==='C')},records:[mergedRecord]}),/split/);
 check('S12',{observation:'One supplier PO shared by two customers needs its full task membership; customer-only scope is rejected.',mergedAmount:5600,taskCount:2});

 const names=['purchaseProjection.js','purchasePlan.js','purchaseWorkspace.web.js','warehouseReceiving.js','customerAllocationContext.js','plannerAllocation.js','stockCardProjection.js','purchaseOrderWorkflow.js','paymentHandoff.js','physicalOutflow.js'];
 report.sourceHashes=Object.fromEntries(names.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../../backend',name))).digest('hex')]));
 report.verdict='NO_PRODUCTION_SCOPED_READER_APPROVED: current relations and revision chains require a defined current-state checkpoint before bounded everyday reads can replace full history.';
 return report;
}
if(require.main===module)run().then(result=>{if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
