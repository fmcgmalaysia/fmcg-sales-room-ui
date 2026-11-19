const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
function loginFixture({loggedIn=true,authorized=true,query={},stored={}}={}){
  let ready,lookups=0,tokens=0;const opened=[],storage=new Map(Object.entries(stored));
  const nodes={button1:{style:{},onClick(){},enable(){},disable(){}},imageX36:{onClick(){}},text10:{style:{}}};
  const $w=id=>nodes[id.slice(1)];$w.onReady=handler=>ready=handler;
  const api=vm.runInNewContext(read('integration/wix/sales-room-login-page.js').replace(/^import .+;$/gm,'')+'\n({validStaffTarget,staffReturnTarget})',{
    $w,URL,crypto:require('node:crypto').webcrypto,wixLocationFrontend:{query,to:url=>opened.push(url)},
    authentication:{loggedIn:()=>loggedIn,applySessionToken:async()=>{tokens++;},logout:()=>assert.fail('existing staff session must not be logged out on page load')},
    getCurrentStaffContext:async()=>{lookups++;return {authorized};},session:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}
  });
  return {...api,ready,opened,nodes,storage,get lookups(){return lookups;},get tokens(){return tokens;}};
}
test('LTPOS staff entry resumes an existing authorized FMCG session without starting Google again',async()=>{
  const f=loginFixture();await f.ready();assert.deepEqual(f.opened,['/sales-room']);assert.equal(f.lookups,1);assert.equal(f.tokens,0);
  const denied=loginFixture({authorized:false});await denied.ready();assert.deepEqual(denied.opened,[]);assert.match(denied.nodes.button1.label,/NOT AUTHORIZED/);
});
test('staff sign-in only resumes a validated same-site customer route and expires pending return targets',async()=>{
  for(const target of ['https://evil.invalid/catalogue?assist=CUS-FAKE','//evil.invalid/sales-room','/account-department','/catalogue?assist=../../other','javascript:alert(1)'])
    assert.equal(loginFixture().validStaffTarget(target),'');
  for(const route of ['catalogue','buyer-room']){
    const f=loginFixture({query:{next:'/'+route+'?assist=CUS-FAKE-LIM'}});await f.ready();assert.deepEqual(f.opened,['/'+route+'?assist=CUS-FAKE-LIM']);
  }
  const expired=loginFixture({stored:{staffWorkspaceReturnTarget:JSON.stringify({target:'/buyer-room?assist=CUS-FAKE',expiresAt:1})}});
  await expired.ready();assert.deepEqual(expired.opened,['/sales-room']);
});
test('the existing OAuth state validation cannot be skipped by a return target or existing login',async()=>{
  const f=loginFixture({query:{oauth:'success',state:'wrong',token:'fake-token',next:'/sales-room'}});
  await f.ready();assert.equal(f.tokens,0);assert.equal(f.lookups,0);assert.deepEqual(f.opened,[]);assert.match(f.nodes.button1.label,/SECURITY CHECK FAILED/);
});
test('Sales Room Entry rereads current staff scope; Catalogue-only customer work opens Catalogue directly',async()=>{
  const source=read('sales-room/wix/sales-room-page.js'),begin=source.indexOf("    if (message.type === 'SALES_ROOM_OPEN_BUYER_ROOM')"),end=source.indexOf("    if (message.type === 'SALES_ROOM_FX_RATES_REQUEST')",begin),block=source.slice(begin,end);
  for(const [authorized,scope,customerId,expected] of [
    [true,{allCustomers:true},'CUS-FAKE','/buyer-room?assist=CUS-FAKE'],
    [true,{allCustomerActions:['CATALOGUE_VIEW']},'CUS-FAKE','/catalogue?assist=CUS-FAKE'],
    [true,{customerActions:{BUYER_ROOM_VIEW:['CUS-FAKE']}},'CUS-FAKE','/buyer-room?assist=CUS-FAKE'],
    [true,{customerActions:{BUYER_ROOM_VIEW:['CUS-OTHER']}},'CUS-FAKE',undefined],
    [false,{allCustomers:true},'CUS-FAKE',undefined],
    [true,{allCustomers:true},'https://evil.invalid',undefined]
  ]){
    let reads=0;const opened=[];
    await vm.runInNewContext('(async()=>{'+block+'})()',{
      message:{type:'SALES_ROOM_OPEN_BUYER_ROOM',customerId},loadCurrentStaff:async()=>{reads++;return {authorized,staffId:'fake',customerScope:scope};},
      showStaffAccessIssue(){},wixLocationFrontend:{to:url=>opened.push(url)},session:{setItem(){}}
    });
    assert.equal(reads,1);assert.deepEqual(opened,expected?[expected]:[]);
  }
});
test('all-customer browsing does not replace administrator-only lifecycle, FX or assignment checks',()=>{
  const source=read('sales-room/wix/onboarding.web.js');
  assert.equal((source.match(/if \(!staff\.canBrowseAllCustomers\)/g)||[]).length,2);
  assert.equal((source.match(/canViewAllCustomers/g)||[]).length,4);
  assert.match(read('sales-room/wix/sales-room-page.js'),/canViewAllCustomers: staff.canViewAllCustomers/);
  assert.match(read('integration/wix/ltpos-staff-portal-page.js'),/fmcgmalaysia\.com\/sales-room-login/);
});
