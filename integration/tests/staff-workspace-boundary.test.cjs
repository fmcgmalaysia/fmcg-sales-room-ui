const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const policy=require('./load-master-module.cjs')('staffManagementPolicy.js');
const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
const work={enabled:true,scope:'ALL',createCustomers:false,editProfiles:true,catalogue:'SELECT',buyerRoom:'VIEW',submitOrders:false};
function fixture(){
  let staff={title:'STF-KAVI01',description:'master-kavi',staffName:'Kavi Fake',staffEmail:'kavi@example.invalid',staffStatus:'ACTIVE',role:'STAFF',
    staffAccess:policy.normalizeStaffAccess({customerWork:work})};
  let centralReads=0,writes=0;
  const gateway=vm.runInNewContext(read('integration/backend/staffAccessGateway.js')+'\ncheckFmcgStaffAccess',{
    ...policy,...crypto,Buffer,getSecret:async()=> 'isolated-secret',writeStaffManagement:()=>assert.fail('authorization must not write'),
    wixData:{query:collection=>{assert.equal(collection,'StaffMasterAccess');return {eq:()=>({limit:()=>({find:async()=>{centralReads++;return {items:[staff]};}})})};}}
  });
  const client=vm.runInNewContext(read('backend/masterStaffAccessClient.js')+'\n({getMasterStaffScope,requireStaffCustomerAccess})',{
    getSecret:async()=> 'isolated-secret',fetch:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer isolated-secret');
      const response=await gateway({headers:options.headers,body:{text:async()=>options.body}});
      return {ok:response.status===200,status:response.status,json:async()=>response.body};}
  });
  const member={_id:'fmcg-kavi',loginEmail:'kavi@example.invalid',status:'APPROVED',loginEmailVerified:true};
  const staffApi=vm.runInNewContext(read('backend/staffAuth.web.js')+'\n({getCurrentStaffContext})',{
    webMethod:(_,handler)=>handler,Permissions:{SiteMember:'member'},members:{getCurrentMember:async()=>({member})},...client,
    wixData:{query:()=>({limit:()=>({find:async()=>({items:[]})})}),update:()=>{writes++;assert.fail('reads must not bind or write');}}
  });
  const customers=new Map(['CUS-FAKE-LIM','CUS-FAKE-YEOYO'].map(customerId=>[customerId,{customerId,title:'Fake '+customerId,preferredCurrency:'USD'}]));
  const bindings={...client,...staffApi,currentMember:{getMember:async()=>member},webMethod:(_,handler)=>handler,Permissions:{SiteMember:'member',Anyone:'any'},
    isWebQuotationReady:()=>true,wixData:{query:collection=>{
      assert.equal(collection,'WixCustomers');return {eq:(_,id)=>({limit:()=>({find:async()=>({items:customers.has(id)?[customers.get(id)]:[]})})})};
    },update:()=>{writes++;assert.fail('permission checks must not write');}}};
  const selection=vm.runInNewContext(read('backend/catalogueSelection.web.js')+'\n({resolve:resolveSelectionContext_})',{...bindings});
  const buyer=vm.runInNewContext(read('backend/catalogueAuth.web.js')+'\n({resolve:resolveBuyerContext})',{...bindings});
  return {selection,buyer,staffApi,setStaff:next=>{staff=next;},get staff(){return staff;},get reads(){return centralReads;},get writes(){return writes;}};
}
test('FMCG staff context consumes current MASTER all-customer actions without administrator escalation',async()=>{
  const f=fixture(),context=await f.staffApi.getCurrentStaffContext();
  assert.equal(context.authorized,true);assert.equal(context.canBrowseAllCustomers,true);assert.equal(context.canViewAllCustomers,false);
  assert.equal(context.role,'STAFF');assert.equal(context.customerScope.canCreateCustomers,false);
  for(const id of ['CUS-FAKE-LIM','CUS-FAKE-YEOYO']){
    assert.equal((await f.selection.resolve(id,'ASSIST_SELECTION')).customerId,id);
    assert.equal((await f.buyer.resolve(id)).customerId,id);
    await assert.rejects(f.buyer.resolve(id,'SEND_ORDER_REQUEST'),/permission/);
    await assert.rejects(f.buyer.resolve(id,'EDIT_REVIEW_QTY'),/permission/);
    await assert.rejects(f.buyer.resolve(id,'SUBMIT_ORDER'),/permission/);
  }
  assert.equal(f.writes,0);
});
test('old Catalogue and Buyer pages recheck central grants on every action and fail after revocation',async()=>{
  const f=fixture();
  await f.selection.resolve('CUS-FAKE-LIM','ASSIST_SELECTION');
  await f.buyer.resolve('CUS-FAKE-LIM');
  const before=f.reads;
  f.setStaff({...f.staff,staffAccess:policy.normalizeStaffAccess({...f.staff.staffAccess,customerWork:{...work,enabled:false}})});
  await assert.rejects(f.selection.resolve('CUS-FAKE-LIM','ASSIST_SELECTION'),/sign-in/);
  await assert.rejects(f.buyer.resolve('CUS-FAKE-LIM'),/authorization/);
  assert.equal(f.reads,before+2);assert.equal(f.writes,0);
});
test('Catalogue-only staff cannot open Buyer Room; per-customer removal and disabled status revoke old actions',async()=>{
  const f=fixture();
  f.setStaff({...f.staff,staffAccess:policy.normalizeStaffAccess({...f.staff.staffAccess,customerWork:{...work,scope:'SELECTED',buyerRoom:''},customerAccess:{'CUS-FAKE-LIM':'EDIT'}})});
  await f.selection.resolve('CUS-FAKE-LIM','ASSIST_SELECTION');
  await assert.rejects(f.buyer.resolve('CUS-FAKE-LIM'),/permission/);
  await assert.rejects(f.selection.resolve('CUS-FAKE-YEOYO','ASSIST_SELECTION'),/permission/);
  f.setStaff({...f.staff,staffAccess:policy.normalizeStaffAccess({...f.staff.staffAccess,customerAccess:{}})});
  await assert.rejects(f.selection.resolve('CUS-FAKE-LIM','ASSIST_SELECTION'),/permission/);
  f.setStaff({...f.staff,staffStatus:'DISABLED'});
  await assert.rejects(f.selection.resolve('CUS-FAKE-LIM','ASSIST_SELECTION'),/sign-in/);
  assert.equal(f.writes,0);
});
