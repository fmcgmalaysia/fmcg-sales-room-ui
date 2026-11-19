const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const prototype=path.join(__dirname,'../prototypes/staff-workspace-permissions-20261119');
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').trim();
const source=name=>read(path.join(__dirname,'../backend',name)),formal=name=>read(path.join(prototype,'formal',name));
const section=(s,start,end='')=>{const a=s.indexOf(start),b=end?s.indexOf(end,a):s.length;assert(a>=0&&b>a,start);return s.slice(a,b);};
const receipts=[
 ['supportWorkroom.web.js','getSupportDeskStatus'," const staff=await supportStaff();"," const access=await supportAccess(company),staff=access.staff;access.require('VIEW',customerId);"],
 ['warehouseReceiving.web.js','getWarehouseReceiptStatus','await staffContext()','await staffContext(company)'],
 ['packingLists.web.js','getWarehouseDeliveryStatus'," const staff=await staffContext('WAREHOUSE');"," const {staff}=await workroom(company,'WAREHOUSE');"],
 ['accountPurchase.web.js','getAccountSettlementStatus','await accountStaff()','await accountStaff(company)'],
 ['stockExceptions.web.js','getStockSaveStatus','await staffContext()','await staffContext(company)'],
 ['warehouseStockIssues.web.js','getWarehouseStockSaveStatus','await staffContext()','await staffContext(company)']
];
for(const[name,method,before,after]of receipts)test(name+': exact formal save-receipt correlation is preserved',()=>{
 const original=section(formal(name),'export const '+method),candidate=section(source(name),'export const '+method);
 assert.equal(candidate.replace(after,before),original,'only request-local staff authorization may differ');
});
test('formal payment terms, shared Activity read, Desk actions and receiving safeguards remain connected',()=>{
 const support=source('supportWorkroom.web.js'),oldSupport=formal('supportWorkroom.web.js');
 assert.equal(section(support,'const invoiceDependencies=','\nexport const getSupportInvoiceState'),section(oldSupport,'const invoiceDependencies=','\nexport const getSupportInvoiceState'));
 for(const fragment of ["readPaymentTerm:readSupportCustomerPaymentTerm","'DESK_ARCHIVE','DESK_ORDER'",'const activityRead=fulfilmentStore.all(PURCHASE_COLLECTIONS[company].activity);'])assert(support.includes(fragment),fragment);
 for(const name of ['warehouseReceiving.web.js','accountPurchase.web.js','warehouseStockIssues.web.js','stockExceptions.web.js']){
  const tail=section(formal(name),'catch(');let end=tail.indexOf('{'),depth=1;
  while(depth&&++end<tail.length){if(tail[end]==='{')depth++;else if(tail[end]==='}')depth--;}
  const old=tail.slice(0,end+1);
  if(old)assert(source(name).includes(old),name+': existing financial/inventory error and receipt guidance');
 }
 const receiving=source('warehouseReceiving.web.js');
 assert(receiving.includes('const cbmEvidence=includePreparation?indexWarehouseCbm(activity):null;'));
 assert(receiving.includes("if(['PACK','LOAD'].includes(input?.action))return {ok:false,requestId,retryable:false,error:'Warehouse use Delivery Task authorized by Support Desk. The old preparation entry is retired.'};"));
 const stockPage=read(path.join(__dirname,'../wix/stock-control-page.js'));
 assert.equal(stockPage.replaceAll('getStockControlWorkspace','getWarehouseStockControl'),formal('stock-control-page.js'),'the existing Stock Control resource version and retry behavior must stay unchanged');
});

function supportApi(original){
 const staff={memberId:'fake-admin-member',staffId:'fake-admin',staffName:'Fake admin',packingDepartment:'SUPPORT'};
 const rows=['A','B'].map(customerId=>({customerId,id:customerId,taskId:'task-'+customerId}));
 const packing={tasks:rows,lists:rows,portions:rows,deskSummaries:rows,pendingResolutions:rows,pendingAuthorizations:rows.map(row=>({input:row}))};
 const invoices={lines:rows,deskLines:rows,version:'fixed-version',paymentTerm:{days:45},metadata:'preserved'};
 const constructors=[],calls=[];
 const save=async input=>{calls.push(input);return {ok:true,requestId:input.requestId};};
 const readPaymentTerm=async()=>({days:45});
 const bindings={Permissions:{SiteMember:'member'},webMethod:(_,fn)=>fn,PROCUREMENT_SAVE_PENDING:'pending',
  currentMember:{getMember:async()=>({_id:staff.memberId})},requirePackingStaff:()=>staff,
  readManagedWorkroomAccess:async()=>({staff,can:()=>true,require(){}}),
  fulfilmentStore:{all:async()=>[],read:async()=>null},PURCHASE_COLLECTIONS:{NCT:{activity:'NCTActivity'}},operationId:(...parts)=>JSON.stringify(parts),
  readSupportBookings:()=>rows,readSupportDesks:()=>rows,readSupportDeskLocks:()=>[],currentSupportDeskState:(_,state)=>state,supportDeskBatchId:()=> 'fixed-batch',
  createSupportDeskOperations:()=>save,createSupportBookingOperations:()=>save,readPackingWorkroom:async()=>packing,
  readFulfilmentContext:async()=>({tasks:rows.map(row=>({...row,id:row.taskId}))}),readSupportInvoiceState:async()=>invoices,
  createSupportInvoiceOperations:deps=>{constructors.push(deps.readPaymentTerm);return save;},createSupportInvoiceCancellation:()=>save,
  readSupportCustomerPaymentTerm:readPaymentTerm,saveCustomerFulfilment:save,readCurrentAdminFx:async()=>[],
  readSupportDocuments:()=>rows,supportCustomerFiles:()=>rows,supportDocumentVersion:()=> 'fixed-doc-version',pendingSupportDocumentUploads:()=>rows.map(row=>({context:row})),
  createSupportDocumentOperations:()=>save,createSupportCustomerDeliveryOperations:()=>save,requestPurchaseDocument(){},
  requestSupportCustomers:async input=>input.input?save(input):({company:'NCT',customers:rows,metadata:'preserved'})};
 const code=(original?formal:source)('supportWorkroom.web.js').replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
 const names=['getSupportBookings','getSupportDeskRefresh','getSupportInvoiceState','getSupportDocuments','getSupportCustomers','saveSupportBooking','issueSupportInvoice','uploadSupportDocument','saveSupportCustomer'];
 const api=vm.runInNewContext('(function(){'+code+'\nreturn {'+names.join(',')+'};})()',bindings);
 assert.equal(constructors.length,1);assert.equal(constructors[0],readPaymentTerm);
 return {api,calls};
}
test('Super Admin retains exact formal Support reads, payment-term callback and original save delivery',async()=>{
 const old=supportApi(true),next=supportApi(false),plain=value=>JSON.parse(JSON.stringify(value));
 for(const name of ['getSupportBookings','getSupportDeskRefresh','getSupportInvoiceState','getSupportDocuments','getSupportCustomers'])assert.deepEqual(plain(await next.api[name]('NCT')),plain(await old.api[name]('NCT')),name);
 for(const name of ['saveSupportBooking','issueSupportInvoice','uploadSupportDocument','saveSupportCustomer']){
  const input={customerId:'A',action:name==='saveSupportBooking'?'DESK_ORDER':name==='uploadSupportDocument'?'DELIVER':'ORIGINAL',revision:'same',data:'original-data'};
  assert.deepEqual(plain(await next.api[name]('NCT','original-request',input)),plain(await old.api[name]('NCT','original-request',input)),name);
 }
 assert.deepEqual(plain(next.calls),plain(old.calls));
});
