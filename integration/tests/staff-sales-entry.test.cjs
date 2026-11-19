const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const load=require('./load-master-module.cjs');
const policy=load('staffManagementPolicy.js');
const prototype=path.resolve(__dirname,'../prototypes/staff-sales-entry-20261119');
test('captured old policy reproduces the denied selection; the patch keeps request and quote actions denied',()=>{
  const baseline=fs.readFileSync(path.join(prototype,'staffManagementPolicy.baseline.js'),'utf8').replace(/^export /gm,'');
  const old=vm.runInNewContext(baseline+'\n({canUseSalesRoomCustomer,projectFmcgStaffScope})');
  const support={title:'fixture-support',staffStatus:'ACTIVE',role:'STAFF',staffAccess:{
    salesRoom:'VIEW',salesFunction:'SUPPORT',customerAccess:{'fixture-grace':'EDIT'}}};
  assert.equal(old.canUseSalesRoomCustomer(support,'ASSIST_SELECTION','fixture-grace'),false);
  const result=policy.projectFmcgStaffScope(support);
  assert.equal(result.canCreateCustomers,false);
  assert.deepEqual(Array.from(result.customerActions.ASSIST_SELECTION),['fixture-grace']);
  for(const action of ['SEND_ORDER_REQUEST','EDIT_REVIEW_QTY','SUBMIT_ORDER','MANAGE_CUSTOMER','EDIT_QUOTATION','PUBLISH_QUOTATION'])
    assert.equal(result.customerActions[action].length,0,action);
});
async function portalFixture(ids){
  const code=fs.readFileSync(path.resolve(__dirname,'../wix/ltpos-staff-portal-page.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'');
  let ready,handler;
  const frame={onMessage:f=>handler=f,postMessage:()=>{},src:''};
  const section={expand:async()=>{},collapse:async()=>{}};
  const links={html:'',customClassList:{add:()=>{}}};
  const $w=id=>({'#html1':frame,'#section5':section,'#text5':links}[id]);
  $w.onReady=f=>ready=f;
  vm.runInNewContext(code,{$w,authentication:{loggedIn:()=>true},getLtposWorkspaces:async()=>({name:'Fixture',workspaceIds:ids})});
  ready();await handler({data:{type:'LTPOS_READY'}});
  return links.html;
}
test('the existing homepage employee link reaches the staff-specific login and remains permission-filtered',async()=>{
  const html=await portalFixture(['sales-room','purchase','sales-management']);
  assert.match(html,/https:\/\/www\.fmcgmalaysia\.com\/sales-room-login/);
  assert.doesNotMatch(html,/href="https:\/\/www\.fmcgmalaysia\.com\/sales-room"/);
  assert.match(html,/https:\/\/www\.ltpos\.ai\/purchase/);
  assert.match(html,/https:\/\/www\.ltpos\.ai\/quotations/);
  assert.doesNotMatch(await portalFixture(['purchase']),/fmcgmalaysia\.com/);
});

test('the existing staff Google route checks MASTER; the buyer route cannot be used as employee login',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../backend/http-functions.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const calls=[];
  const api=vm.runInNewContext(source+'\n({get_googleStaffAuth,get_googleStaffAuthStart})',{
    URLSearchParams,response:r=>r,createNctReceiver:()=>()=>{},
    getSecret:async()=> 'fixture',
    getMasterStaffScope:async(email,verified)=>{calls.push(['MASTER',email,verified]);return {staffId:'fixture-staff'};},
    authentication:{generateSessionToken:async()=>{calls.push(['SESSION']);return 'fixture-token';}},
    fetch:async url=>({ok:true,json:async()=>url.includes('/token')?{access_token:'fixture-access'}:{email:'fixture@example.com',email_verified:true}}),
    wixData:{query:()=>({eq:()=>({limit:()=>({find:async()=>({items:[]})})})})},
    console:{warn:()=>{},error:()=>{}}
  });
  const state='S_12345678901234567890123456789012';
  const start=await api.get_googleStaffAuthStart({query:{state}});
  assert.equal(new URL(start.headers.Location).searchParams.get('state'),state);
  const staff=await api.get_googleStaffAuth({query:{state,code:'fixture-code'}});
  assert.equal(new URL(staff.headers.Location).pathname,'/sales-room-login');
  assert.equal(new URL(staff.headers.Location).searchParams.get('oauth'),'success');
  assert.deepEqual(calls,[['MASTER','fixture@example.com',true],['SESSION']]);
  calls.length=0;
  const buyer=await api.get_googleStaffAuth({query:{state:'B_'+state,code:'fixture-code'}});
  assert.equal(new URL(buyer.headers.Location).pathname,'/');
  assert.equal(new URL(buyer.headers.Location).searchParams.get('oauth'),'not_authorized');
  assert.equal(calls.length,0);
});
