const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('./load-master-module.cjs')('staffManagementPolicy.js');
const member = {_id:'member-a',loginEmail:'STAFF@example.com',status:'APPROVED'};
const employee = {title:'staff-a',description:'member-a',staffEmail:'staff@example.com',staffName:'Staff',staffStatus:'ACTIVE',role:'STAFF',staffAccess:{departmentAccess:{PURCHASE:'VIEW'},companyIds:['NCT']}};
function moduleApi(file, bindings, names) {
  const source = fs.readFileSync(path.join(__dirname,'../backend',file),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  return vm.runInNewContext('(function(){'+source+'\nreturn {'+names.join(',')+'};})()', {...bindings});
}
function fixture() {
  const state={member,rows:[structuredClone(employee)],reads:0,writes:0};
  const query = () => {
    const filters=[];
    const builder={
      filters,
      eq(field,value){filters.push(row=>row[field]===value);return builder;},
      or(other){filters.push(...other.filters);return builder;},
      limit(count){assert.equal(count,3);return builder;},
      async find(options){assert.equal(options.consistentRead,true);state.reads++;return {items:state.rows.filter(row=>filters.some(match=>match(row))).slice(0,3)};}
    };
    return builder;
  };
  const access=moduleApi('staffManagementAccess.js',{
    ...policy,currentMember:{getMember:async()=>state.member},wixData:{query(name){assert.equal(name,'StaffMasterAccess');return query();}}
  },['readManagedStaffIdentity','requireManagedDepartmentAccess','getManagedDepartmentContext','readManagedWorkroomAccess','readManagedCompanyAccess']);
  const purchase=moduleApi('purchaseAccess.js',access,['getPurchaseStaffContext']);
  return {state,...access,...purchase};
}

test('Support Desk reads and saved-target edits enforce the actual customer; Warehouse View cannot load',async()=>{
  const f=fixture();f.state.rows[0].staffAccess={departmentAccess:{SUPPORT:'EDIT',WAREHOUSE:'VIEW'},companyIds:['NCT'],customerAccess:{A:'EDIT'}};
  const rows=['A','B'].map(customerId=>({id:'desk-'+customerId,customerId,taskId:'task-'+customerId,input:{customerId}}));
  let writes=0;
  const api=moduleApi('packingLists.web.js',{
    ...f,Permissions:{SiteMember:1},webMethod:(_,fn)=>fn,PROCUREMENT_SAVE_PENDING:'pending',
    PURCHASE_COLLECTIONS:{NCT:{activity:'Activity'}},operationId:(company,id)=>id,
    fulfilmentStore:{read:async(_,id)=>rows.find(row=>row.id===id)},readPackingLists:rows=>rows,
    readPackingWorkroom:async()=>({tasks:rows,lists:rows,portions:rows,deskSummaries:rows,pendingResolutions:rows,pendingAuthorizations:rows,version:'original'}),
    savePackingOperation:async()=>{writes++;return {ok:true};}
  },['getPackingLists','savePackingList']);
  const view=await api.getPackingLists('NCT','SUPPORT');
  for(const key of ['tasks','lists','portions','deskSummaries','pendingResolutions','pendingAuthorizations'])assert.equal(view[key].length,1,key);
  assert.equal(view.version,'original');
  await assert.rejects(api.savePackingList('NCT','SUPPORT','r',{action:'DESK_RECALL',id:'desk-B',customerId:'A'}),/permission/);
  await assert.rejects(api.savePackingList('NCT','SUPPORT','r',{action:'DESK_SEND',customerId:'B'}),/permission/);
  await assert.rejects(api.savePackingList('NCT','WAREHOUSE','r',{action:'DESK_LOAD',id:'desk-A'}),/permission/);
  assert.equal(writes,0);
  await api.savePackingList('NCT','SUPPORT','r',{action:'DESK_RECALL',id:'desk-A'});
  assert.equal(writes,1);
  await assert.rejects(api.getPackingLists('GHR','SUPPORT'),/permission/);
});

test('Finance View preserves financial viewing but cannot post; mixed Warehouse/Support scope cannot reveal other customer prices',async()=>{
  const f=fixture();f.state.rows[0].staffAccess={departmentAccess:{SUPPORT:'EDIT',WAREHOUSE:'VIEW'},companyIds:['NCT'],customerAccess:{A:'EDIT'}};
  const rows=['A','B'].map(customerId=>({id:customerId,customerId,taskId:'task-'+customerId,sellingPriceCtn:50,sellingPricePc:5}));
  let writes=0;
  const result=()=>({customers:rows,lines:rows,shipments:rows.map(row=>({...row,invoice:{number:'INV-'+row.id,date:'2026-11-13',amount:500},lines:[row]})),plans:rows,debtorInvoices:rows,deskRemainders:rows,customerAccount:{entries:rows,balances:rows,pendingDocuments:rows,invoicePayments:{invoices:rows,unapplied:rows}},accountVersion:'original',version:'original'});
  const api=moduleApi('customerFulfilment.web.js',{
    ...f,Permissions:{SiteMember:1},webMethod:(_,fn)=>fn,PURCHASE_COLLECTIONS:{NCT:{activity:'Activity'}},
    fulfilmentStore:{all:async()=>rows},readCustomerShipments:()=>rows.map(row=>({...row,company:'NCT'})),
    readCustomerFulfilment:async()=>result(),saveCustomerFulfilment:async()=>{writes++;return {ok:true};},confirmCustomerAccountDocument:async()=>{writes++;return {ok:true};}
  },['getCustomerFulfilment','saveCustomerShipment','confirmCustomerAccount']);
  const mixed=await api.getCustomerFulfilment('NCT');
  assert.equal(mixed.customers.length,2);assert.equal(mixed.lines[0].sellingPriceCtn,50);
  assert.equal(mixed.lines[1].sellingPriceCtn,undefined);assert.equal(mixed.lines[1].sellingPricePc,undefined);
  assert.equal(mixed.shipments[1].invoice.amount,undefined);assert.equal(mixed.shipments[1].lines[0].sellingPriceCtn,undefined);
  for(const key of ['plans','debtorInvoices'])assert.equal(mixed[key].length,1);
  assert.equal(mixed.customerAccount.entries.length,1);
  await assert.rejects(api.saveCustomerShipment('NCT','r',{action:'INVOICE',id:'B',customerId:'A'}),/permission/);
  await assert.rejects(api.saveCustomerShipment('NCT','r',{action:'DISPATCH',id:'A'}),/permission/);
  await assert.rejects(api.confirmCustomerAccount('NCT','r',{}),/permission/);
  f.state.rows[0].staffAccess.departmentAccess={ACCOUNT:'VIEW'};
  const finance=await api.getCustomerFulfilment('NCT');assert.equal(finance.customerAccount.entries.length,2);assert.equal(finance.permissions.customerAccountConfirm,false);
  await assert.rejects(api.confirmCustomerAccount('NCT','r',{}),/permission/);assert.equal(writes,0);
  f.state.rows[0].staffAccess.departmentAccess.ACCOUNT='EDIT';await api.confirmCustomerAccount('NCT','r',{});assert.equal(writes,1);
});

test('Stock action flags distinguish Finance viewing, Purchase decisions and Warehouse reports without promoting approvers',async()=>{
  const f=fixture();f.state.rows[0].staffAccess={departmentAccess:{ACCOUNT:'VIEW',WAREHOUSE:'VIEW',PURCHASE:'VIEW'},companyIds:['NCT']};
  const api=moduleApi('stockExceptions.web.js',{
    ...f,Permissions:{SiteMember:1},webMethod:(_,fn)=>fn,fulfilmentStore:{all:async()=>[]},PURCHASE_COLLECTIONS:{NCT:{}},
    readFulfilmentContext:async()=>({activity:[]}),projectPurchaseOrders:()=>[],projectStockWorkspace:(_,__,staff)=>staff,
    createStockExceptionOperations:()=>async({staff})=>{assert.equal(staff.canReportStockException,true);return {ok:true};},
    createStockResolutionOperations:()=>async({staff})=>staff,projectDepartmentMessages:()=>({})
  },['getStockExceptions','saveStockException']);
  const view=await api.getStockExceptions('NCT');assert.equal(view.readStockFinancial,true);
  for(const key of ['canReportStockException','canPlanStockResolution','canApproveStockLoss','canCloseStockException'])assert.equal(view[key],false);
  f.state.rows[0].staffAccess.departmentAccess={WAREHOUSE:'EDIT',PURCHASE:'EDIT'};
  const edit=await api.getStockExceptions('NCT');assert.equal(edit.canReportStockException,true);assert.equal(edit.canPlanStockResolution,true);assert.equal(edit.canCloseStockException,false);assert.equal(edit.canApproveStockLoss,false);assert.equal(edit.readStockFinancial,false);
  f.state.rows[0].staffAccess.departmentAccess={ACCOUNT:'EDIT'};assert.equal((await api.getStockExceptions('NCT')).canCloseStockException,true);
  await assert.rejects(api.getStockExceptions('GHR'),/authorized/);
});
test('Purchase View is read-only and company scope is enforced before returning an actor',async()=>{
  const f=fixture();
  assert.equal((await f.getPurchaseStaffContext('NCT')).staffId,'staff-a');
  for(const [company,action] of [['NCT','EDIT'],['GHR','VIEW'],['','VIEW'],[null,'VIEW'],['NCT','UNKNOWN']]) {
    await assert.rejects(f.getPurchaseStaffContext(company,action),/permission/);
  }
  assert.equal((await f.getPurchaseStaffContext()).staffId,'staff-a');
});

test('Support scopes every directory, document and invoice read to authorized customers',async()=>{
  const f=fixture();
  f.state.rows[0].staffAccess={departmentAccess:{SUPPORT:'EDIT'},companyIds:['NCT'],customerAccess:{A:'VIEW'}};
  const rows=[{id:'A',customerId:'A',taskId:'task-a'},{id:'B',customerId:'B',taskId:'task-b'}];
  const activities=[];let writes=0;
  const save=async()=>{writes++;return {ok:true};};
  const api=moduleApi('supportWorkroom.web.js',{
    ...f,Permissions:{SiteMember:'member'},webMethod:(_,handler)=>handler,
    fulfilmentStore:{all:async()=>activities,read:async()=>({image:'B',details:{memberId:'member-a'}})},
    PURCHASE_COLLECTIONS:{NCT:{activity:'Activity'}},PROCUREMENT_SAVE_PENDING:'pending',operationId:(...parts)=>parts.join('/'),
    readSupportBookings:()=>rows,readSupportDesks:()=>rows,readSupportDeskLocks:()=>[],currentSupportDeskState:(_,state)=>state,supportDeskBatchId:()=>'',
    createSupportDeskOperations:()=>save,createSupportBookingOperations:()=>save,
    readFulfilmentContext:async()=>({tasks:rows.map(row=>({...row,id:row.taskId}))}),
    readSupportInvoiceState:async()=>({lines:rows,deskLines:rows,version:'original-version'}),
    createSupportInvoiceOperations:()=>save,createSupportInvoiceCancellation:()=>save,
    saveCustomerFulfilment:save,readCurrentAdminFx:async()=>[],
    readSupportDocuments:()=>rows,supportCustomerFiles:()=>rows,supportDocumentVersion:()=> 'original-version',
    pendingSupportDocumentUploads:()=>rows.map(row=>({context:{customerId:row.customerId}})),
    createSupportDocumentOperations:()=>save,createSupportCustomerDeliveryOperations:()=>save,
    requestPurchaseDocument(){},requestSupportCustomers:async request=>request.input?save():({company:'NCT',customers:rows})
  },['getSupportBookings','getSupportInvoiceState','getSupportDocuments','getSupportCustomers',
    'saveSupportBooking','issueSupportInvoice','withdrawSupportInvoice','uploadSupportDocument','saveSupportCustomer']);
  assert.equal((await api.getSupportCustomers('NCT')).customers.length,1);
  assert.equal((await api.getSupportBookings('NCT')).desks[0].customerId,'A');
  const invoice=await api.getSupportInvoiceState('NCT');assert.equal(invoice.lines.length,1);assert.equal(invoice.deskLines.length,1);assert.equal(invoice.version,'original-version');
  const docs=await api.getSupportDocuments('NCT');for(const key of ['documents','customerFiles','pendingUploads'])assert.equal(docs[key].length,1);
  for(const name of ['saveSupportBooking','issueSupportInvoice','uploadSupportDocument','saveSupportCustomer']){
    await assert.rejects(api[name]('NCT','request',{customerId:'A'}),/permission/);
    await assert.rejects(api[name]('NCT','request',{customerId:'B'}),/permission/);
  }
  f.state.rows[0].staffAccess.customerAccess.A='EDIT';
  assert.equal((await api.saveSupportBooking('NCT','request',{customerId:'A'})).ok,true);
  await assert.rejects(api.withdrawSupportInvoice('NCT','request',{customerId:'A',invoiceRequestId:'11111111-1111-4111-8111-111111111111'}),/permission/);
  assert.equal(writes,1,'withdraw checks the original invoice customer, not the supplied customer');
  f.state.rows[0].staffAccess.customerAccess={};
  assert.equal((await api.getSupportCustomers('NCT')).customers.length,0);
  await assert.rejects(api.getSupportCustomers('GHR'),/permission/);
});

test('Warehouse View cannot receive, correct preparation or capture CBM; Edit still uses the original operations',async()=>{
  const f=fixture();f.state.rows[0].staffAccess.departmentAccess={WAREHOUSE:'VIEW'};
  let saves=0;
  const save=async()=>{saves++;return {ok:true};};
  const api=moduleApi('warehouseReceiving.web.js',{
    ...f,Permissions:{SiteMember:'member'},webMethod:(_,handler)=>handler,wixData:{},
    PURCHASE_COLLECTIONS:{NCT:{}},PROCUREMENT_SAVE_PENDING:'pending',
    createWarehouseOperations:()=>({save}),createPreparationOperations:()=>save,
    createWarehouseCbmCapture:()=>save,requestPurchaseDocument(){},capturePointbaseCosts(){}
  },['saveWarehouseReceipt','saveWarehousePreparation','captureWarehouseCbm']);
  for(const action of Object.values(api))await assert.rejects(action('NCT','request',{}),/permission/);
  assert.equal(saves,0);
  f.state.rows[0].staffAccess.departmentAccess.WAREHOUSE='EDIT';
  assert.equal((await api.saveWarehouseReceipt('NCT','request',{})).ok,true);
  await assert.rejects(api.saveWarehouseReceipt('GHR','request',{}),/permission/);
  assert.equal((await api.saveWarehousePreparation('NCT','request',{action:'LOAD'})).ok,false);
  assert.equal(saves,1,'the retired preparation LOAD entry stays retired');
});

test('Finance View cannot settle, check invoices or maintain the read index',async()=>{
  const f=fixture();f.state.rows[0].staffAccess.departmentAccess={ACCOUNT:'VIEW'};
  let saves=0;
  const save=async()=>{saves++;return {ok:true};};
  const api=moduleApi('accountPurchase.web.js',{
    ...f,Permissions:{SiteMember:'member'},webMethod:(_,handler)=>handler,wixData:{},
    PURCHASE_COLLECTIONS:{NCT:{}},PROCUREMENT_SAVE_PENDING:'pending',
    createPurchaseOrderOperations:()=>({list:async()=>[]}),
    createAccountReviewOperations:()=>({save}),createAccountSettlementOperations:()=>({save}),
    createSupplierCreditOperations:()=>save,requestPurchaseDocument(){},
    createAccountReadIndexOperations:()=>({stage:save,activate:save})
  },['saveAccountSettlement','saveAccountInvoiceCheck','maintainAccountReadIndex']);
  for(const action of Object.values(api))await assert.rejects(action('NCT','request',{}),/permission/);
  assert.equal(saves,0);
  f.state.rows[0].staffAccess.departmentAccess.ACCOUNT='EDIT';
  assert.equal((await api.saveAccountSettlement('NCT','request',{})).ok,true);
  assert.equal((await api.saveAccountInvoiceCheck('NCT','request',{})).ok,true);
  await assert.rejects(api.maintainAccountReadIndex('NCT','STAGE'),/Only SUPER ADMIN/);
  await assert.rejects(api.saveAccountSettlement('GHR','request',{}),/permission/);
  assert.equal(saves,2);
});
test('Purchase role and stale legacy departments do not override managed permissions',async()=>{
  const f=fixture(); f.state.rows[0].role='TOP MANAGEMENT';f.state.rows[0].departments=['PURCHASE','ACCOUNT'];
  await assert.rejects(f.getPurchaseStaffContext('NCT','EDIT'),/permission/);
  f.state.rows[0].staffAccess.departmentAccess={};
  await assert.rejects(f.getPurchaseStaffContext('NCT'),/permission/);
});
test('already open tabs lose edit access on the next request after revocation',async()=>{
  const f=fixture();f.state.rows[0].staffAccess.departmentAccess.PURCHASE='EDIT';
  await f.getPurchaseStaffContext('NCT','EDIT');
  f.state.rows[0].staffAccess.departmentAccess.PURCHASE='VIEW';
  await assert.rejects(f.getPurchaseStaffContext('NCT','EDIT'),/permission/);
  f.state.rows[0].staffStatus='DISABLED';
  await assert.rejects(f.getPurchaseStaffContext('NCT'),/not authorized/);
  assert.equal(f.state.reads,3);
});
test('duplicate member bindings and duplicate emails are rejected, without listing all staff',async()=>{
  for(const change of [{staffEmail:'another@example.com'},{description:'member-b'}]){
    const f=fixture();f.state.rows.push({...employee,title:'staff-b',...change});
    await assert.rejects(f.getPurchaseStaffContext('NCT'),/not authorized/);
    assert.equal(f.state.reads,1);
  }
  const f=fixture();f.state.member={...member,status:'PENDING'};
  await assert.rejects(f.getPurchaseStaffContext('NCT'));
  assert.equal(f.state.reads,0);
});
test('Purchase saving and cost recovery require EDIT, and never enter the business saver on denial',async()=>{
  const f=fixture();let saves=0;
  const common={...f,Permissions:{SiteMember:'member'},webMethod:(_,handler)=>handler,
    wixData:{},PURCHASE_COLLECTIONS:{NCT:{}},PROCUREMENT_SAVE_PENDING:'pending',
    createPurchaseOrderOperations:()=>({save:async()=>{saves++;return {ok:true};},list:async()=>[]}),
    createPurchaseCostRetry:()=>async()=>{saves++;return {ok:true};},
    requestPurchaseDocument(){},capturePointbaseCosts(){},readCustomerShortNames:async()=>[],
    purchaseOrderReadResult:value=>value
  };
  const orders=moduleApi('purchaseOrders.web.js',common,['savePurchaseOrder']);
  const costs=moduleApi('purchaseCostRetry.web.js',common,['retryPurchaseTaskCost']);
  await assert.rejects(orders.savePurchaseOrder('NCT','request',{}),/permission/);
  await assert.rejects(costs.retryPurchaseTaskCost('NCT','task','request'),/permission/);
  assert.equal(saves,0);
  f.state.rows[0].staffAccess.departmentAccess.PURCHASE='EDIT';
  assert.equal((await orders.savePurchaseOrder('NCT','request',{})).ok,true);
  assert.equal((await costs.retryPurchaseTaskCost('NCT','task','request')).ok,true);
  assert.equal(saves,2);
});
