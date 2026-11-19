const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-master-module.cjs');
const p=load('staffManagementPolicy.js');
const {createMasterQuotationActions}=load('masterQuotationAccess.js');
const {projectLtposWorkspaces}=load('ltposWorkspacePolicy.js');
const closed={enabled:false,scope:'SELECTED',createCustomers:false,editProfiles:false,catalogue:'',buyerRoom:'',submitOrders:false};
const sales={...closed,enabled:true,createCustomers:true,editProfiles:true,catalogue:'SELECT',buyerRoom:'REQUEST',submitOrders:true};
const employee=(name,work,quotes='',customers={})=>({title:'STF-'+name,staffName:name,staffStatus:'ACTIVE',role:'STAFF',description:'member-'+name,
  staffAccess:p.normalizeStaffAccess({companyIds:['NCT','GHR'],departmentAccess:{},customerAccess:customers,customerWork:work,quotationAccess:quotes})});
const lim=employee('LIM01',sales,'EDIT',{'CUS-LIM':'EDIT','CUS-YEOYO':'EDIT'});
const yeoyo=employee('YEOYO',sales,'EDIT',{'CUS-YEOYO':'EDIT'});
const rinn=employee('RINN1',sales,'',{'CUS-LIM':'EDIT'});
const kavi=employee('KAVI1',{...closed,enabled:true,scope:'ALL',editProfiles:true,catalogue:'SELECT',buyerRoom:'VIEW'});
const warehouse=name=>({...employee(name,closed),staffAccess:p.normalizeStaffAccess({companyIds:['NCT','GHR'],departmentAccess:{WAREHOUSE:'EDIT'},customerWork:closed,quotationAccess:''})});
const admin={...employee('ADMIN',closed),role:'SUPER ADMIN'};
const customers=[{customerId:'CUS-LIM',name:'Fake customer L',assignedStaffId:lim.title},
  {customerId:'CUS-YEOYO',name:'Fake customer Y',assignedStaffId:yeoyo.title},
  {customerId:'CUS-OTHER',name:'Fake customer X',assignedStaffId:'STF-OTHER'}].map(c=>({...c,quotationMode:'WEB',webQuotationStatus:'READY',accessStatus:'ACTIVE'}));

test('customer work permission is independent of department, company and quotation entry',()=>{
  for(const staff of [lim,yeoyo,rinn]) {
    assert.equal(p.canCreateManagedCustomer(staff),true);
    assert(projectLtposWorkspaces(staff).workspaceIds.includes('sales-room'));
  }
  assert.equal(p.canUseSalesRoomCustomer(lim,'ASSIST_SELECTION','CUS-YEOYO'),true);
  assert.equal(p.canUseSalesRoomCustomer(yeoyo,'VIEW','CUS-LIM'),false);
  assert.equal(p.canEnterQuotations(rinn),false);
  const quoteOnly={...lim,staffAccess:p.normalizeStaffAccess({...lim.staffAccess,customerWork:closed})};
  assert.equal(p.projectFmcgStaffScope(quoteOnly),null);
  assert.equal(p.canQuoteManagedCustomer(quoteOnly,customers[0]),true);
  assert(projectLtposWorkspaces(quoteOnly).workspaceIds.includes('sales-management'));
});

test('performance includes quotations in one direction, with separate historical and current ownership',()=>{
  const performance={...lim,staffAccess:p.normalizeStaffAccess({...lim.staffAccess,quotationAccess:'',performanceAccess:'VIEW',customerWork:closed})};
  assert.equal(p.canEnterQuotations(performance),true);
  assert.equal(p.canQuoteManagedCustomer(performance,customers[0]),true);
  assert.equal(p.canQuoteManagedCustomer(performance,customers[1]),false);
  assert.equal(p.canUseSalesManagementReport(performance,lim.title,'NCT'),true);
  assert.equal(p.canUseSalesManagementReport(performance,yeoyo.title,'NCT'),false);
  assert.equal(p.canUseSalesManagementReport(performance,'','NCT'),false);
  assert.equal(p.canUseSalesManagementReport(lim,lim.title,'NCT'),false);
  const oldView={...rinn,staffAccess:p.normalizeStaffAccess({...rinn.staffAccess,departmentAccess:{'SALES MANAGEMENT':'VIEW'}})};
  assert.equal(p.canEnterQuotations(oldView),false);
  assert.equal(p.canUseSalesManagementReport(oldView,rinn.title,'NCT'),false);
});

test('KAVI all-customer service never becomes administrator or transaction permission',()=>{
  const scope=p.projectFmcgStaffScope(kavi);
  assert.equal(scope.allCustomers,false);
  assert.equal(scope.canCreateCustomers,false);
  for(const id of ['CUS-LIM','CUS-YEOYO','CUS-NEW']) {
    for(const action of ['VIEW','CATALOGUE_VIEW','ASSIST_SELECTION','MANAGE_CUSTOMER','BUYER_ROOM_VIEW'])
      assert.equal(p.canUseSalesRoomCustomer(kavi,action,id),true,action);
    for(const action of ['SEND_ORDER_REQUEST','EDIT_REVIEW_QTY','SUBMIT_ORDER','EDIT_QUOTATION','PUBLISH_QUOTATION'])
      assert.equal(p.canUseSalesRoomCustomer(kavi,action,id),false,action);
  }
  assert.equal(p.canEnterQuotations(kavi),false);
  assert(scope.allCustomerActions.includes('ASSIST_SELECTION'));
  assert(!scope.allCustomerActions.includes('SUBMIT_ORDER'));
});

test('SAM and HIA require no customer grants for warehouse tasks and cannot open customer pages',()=>{
  for(const staff of [warehouse('SAM01'),warehouse('HIA01')]) {
    for(const company of ['NCT','GHR'])assert.equal(p.canUseDepartment(staff,'WAREHOUSE','EDIT',undefined,company),true);
    assert.deepEqual(Array.from(projectLtposWorkspaces(staff).workspaceIds),['warehouse']);
    assert.equal(p.projectFmcgStaffScope(staff),null);
    assert.equal(p.canEnterQuotations(staff),false);
    for(const action of ['VIEW','CATALOGUE_VIEW','BUYER_ROOM_VIEW','ASSIST_SELECTION','MANAGE_CUSTOMER','SUBMIT_ORDER'])
      assert.equal(p.canUseSalesRoomCustomer(staff,action,'CUS-LIM'),false);
  }
});

function quoteFixture(initial){
  let current=initial;
  const calls=[];
  const operate=createMasterQuotationActions({readIdentity:async()=>({record:current}),readCustomers:async()=>customers,
    readCustomer:async id=>customers.find(c=>c.customerId===id),quotation:Object.fromEntries(
      ['list','catchCost','costResult','saveDraft','publish'].map(action=>[action,async scope=>{calls.push([action,scope.customer.customerId]);return [];}]))});
  return {operate,calls,setStaff:staff=>current=staff};
}

test('quote dropdown and every internal quotation action enforce current authoritative ownership',async()=>{
  for(const [staff,id]of [[lim,'CUS-LIM'],[yeoyo,'CUS-YEOYO']]) {
    const f=quoteFixture(staff),list=await f.operate('customers');
    assert.deepEqual(Array.from(list.customers,c=>c.customerId),[id]);
    assert.equal((await f.operate('quotes',id)).canEdit,true);
    for(const action of ['quotes','cost','cost-status','draft','publish'])
      assert.equal((await f.operate(action,id==='CUS-LIM'?'CUS-YEOYO':'CUS-LIM')).accessDenied,true);
    assert.equal(f.calls.length,1);
  }
  for(const staff of [rinn,kavi,warehouse('SAM01'),warehouse('HIA01')]) {
    const f=quoteFixture(staff);
    for(const action of ['customers','quotes','cost','cost-status','draft','publish'])
      assert.equal((await f.operate(action,'CUS-LIM')).accessDenied,true);
    assert.equal(f.calls.length,0);
  }
  assert.equal((await quoteFixture(admin).operate('customers')).customers.length,3);
});

test('an already-open quotation page loses publishing rights on its next request after revocation',async()=>{
  const f=quoteFixture(lim);
  assert.equal((await f.operate('quotes','CUS-LIM')).canPublish,true);
  f.setStaff({...lim,staffAccess:p.normalizeStaffAccess({...lim.staffAccess,quotationAccess:''})});
  assert.equal((await f.operate('publish','CUS-LIM',{price:99})).accessDenied,true);
  assert.deepEqual(f.calls,[['list','CUS-LIM']]);
});

test('revoking customer work closes old Sales Room, Catalogue and Buyer Room actions without disabling Warehouse',()=>{
  let current={...kavi,staffAccess:p.normalizeStaffAccess({...kavi.staffAccess,departmentAccess:{WAREHOUSE:'VIEW'}})};
  const openPageClick=action=>p.canUseSalesRoomCustomer(current,action,'CUS-LIM');
  assert.equal(openPageClick('ASSIST_SELECTION'),true);
  current={...current,staffAccess:p.normalizeStaffAccess({...current.staffAccess,customerWork:{...current.staffAccess.customerWork,enabled:false}})};
  for(const action of ['VIEW','CATALOGUE_VIEW','ASSIST_SELECTION','BUYER_ROOM_VIEW','MANAGE_CUSTOMER'])assert.equal(openPageClick(action),false);
  assert.equal(p.projectFmcgStaffScope(current),null);
  assert.equal(p.canUseDepartment(current,'WAREHOUSE','VIEW',undefined,'NCT'),true);
  assert.equal(projectLtposWorkspaces(current).workspaceIds.includes('sales-room'),false);
});

test('disabled staff and a removed individual customer grant cannot use earlier page state',()=>{
  for(const staffStatus of ['PENDING','DISABLED']) {
    const staff={...lim,staffStatus};
    assert.equal(p.canQuoteManagedCustomer(staff,customers[0]),false);
    assert.equal(p.canUseSalesRoomCustomer(staff,'ASSIST_SELECTION','CUS-LIM'),false);
  }
  const revoked={...lim,staffAccess:p.normalizeStaffAccess({...lim.staffAccess,customerAccess:{}})};
  assert.equal(p.canUseSalesRoomCustomer(revoked,'ASSIST_SELECTION','CUS-LIM'),false);
});

test('changing the current customer owner revokes old quotation access without transferring historical performance',()=>{
  const former={...lim,staffAccess:p.normalizeStaffAccess({...lim.staffAccess,performanceAccess:'VIEW'})};
  const reassigned={...customers[0],assignedStaffId:yeoyo.title};
  assert.equal(p.canQuoteManagedCustomer(former,reassigned),false);
  assert.equal(p.canQuoteManagedCustomer(yeoyo,reassigned),true);
  assert.equal(p.canUseSalesManagementReport(former,lim.title,'NCT'),true);
  const newOwner={...yeoyo,staffAccess:p.normalizeStaffAccess({...yeoyo.staffAccess,performanceAccess:'VIEW'})};
  assert.equal(p.canUseSalesManagementReport(newOwner,lim.title,'NCT'),false);
});

test('standalone Stock Control and embedded Warehouse stock have separate entry grants',()=>{
  const stock={...warehouse('STOCK'),staffAccess:p.normalizeStaffAccess({departmentAccess:{'STOCK CONTROL':'VIEW'},companyIds:['NCT'],customerWork:closed})};
  assert.deepEqual(Array.from(projectLtposWorkspaces(stock).workspaceIds),['stock-control']);
  assert.equal(p.canUseDepartment(stock,'STOCK CONTROL','VIEW',undefined,'NCT'),true);
  assert.equal(p.canUseDepartment(stock,'STOCK CONTROL','VIEW',undefined,'GHR'),false);
  assert.equal(p.canUseDepartment(stock,'STOCK CONTROL','EDIT',undefined,'NCT'),false);
  assert.equal(p.canUseDepartment(stock,'WAREHOUSE','VIEW',undefined,'NCT'),false);
  assert.equal(p.projectFmcgStaffScope(stock),null);
});

test('cached old staff forms cannot overwrite explicit new workspace permissions',()=>{
  const row={...kavi,_id:'fake-row',staffEmail:'fake@example.invalid'};
  const input={staffId:row.title,name:row.staffName,email:row.staffEmail,status:'ACTIVE',revision:p.staffManagementRevision(row),
    access:{salesRoom:'EDIT',salesFunction:'SALES'}};
  assert.throws(()=>p.prepareStaffUpdate(input,[row],'STF-ADMIN'),/Employee details changed/);
});
