const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
function loginFixture({loggedIn=true,authorized=true,query={},stored={}}={}){
  let ready,lookups=0,tokens=0;const opened=[],storage=new Map(Object.entries(stored));
  const nodes={button1:{style:{},onClick(){},enable(){},disable(){}},imageX36:{onClick(){},show(){},hide(){}},text10:{style:{}}};
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
test('Sales Room Entry navigates with its loaded scope and performs no new access request on click',async()=>{
  const source=read('sales-room/wix/sales-room-page.js'),begin=source.indexOf("    if (message.type === 'SALES_ROOM_OPEN_BUYER_ROOM')"),end=source.indexOf("    if (message.type === 'SALES_ROOM_FX_RATES_REQUEST')",begin),block=source.slice(begin,end);
  for(const [authorized,signedIn,scope,customerId,expected] of [
    [true,true,{allCustomers:true},'CUS-FAKE','/buyer-room?assist=CUS-FAKE'],
    [true,true,{allCustomerActions:['CATALOGUE_VIEW']},'CUS-FAKE','/catalogue?assist=CUS-FAKE'],
    [true,true,{customerActions:{BUYER_ROOM_VIEW:['CUS-FAKE']}},'CUS-FAKE','/buyer-room?assist=CUS-FAKE'],
    [true,false,{allCustomers:true},'CUS-FAKE','/sales-room-login?next=%2Fbuyer-room%3Fassist%3DCUS-FAKE'],
    [true,false,{allCustomerActions:['CATALOGUE_VIEW']},'CUS-FAKE','/sales-room-login?next=%2Fcatalogue%3Fassist%3DCUS-FAKE'],
    [true,true,{customerActions:{BUYER_ROOM_VIEW:['CUS-OTHER']}},'CUS-FAKE',undefined],
    [false,true,{allCustomers:true},'CUS-FAKE',undefined],
    [true,true,{allCustomers:true},'https://evil.invalid',undefined]
  ]){
    const opened=[],handoffs=[];
    await vm.runInNewContext('(async()=>{'+block+'})()',{
      message:{type:'SALES_ROOM_OPEN_BUYER_ROOM',customerId},
      staffPromise:Promise.resolve({authorized,staffId:'fake',customerScope:scope}),
      loadCurrentStaff:()=>assert.fail('The click should not start a new access request.'),
      authentication:{loggedIn:()=>signedIn}, STAFF_LOGIN_URL:'/sales-room-login',
      showStaffAccessIssue(){},wixLocationFrontend:{to:url=>opened.push(url)},session:{setItem:(name,value)=>handoffs.push([name,JSON.parse(value)])}
    });
    assert.deepEqual(opened,expected?[expected]:[]);
    assert.equal(handoffs.length,expected?.startsWith('/buyer-room?')?1:0);
    if(handoffs.length)assert.equal(handoffs[0][1].customerId,customerId);
  }
});
test('Buyer Room checks the current customer grant before loading selections, even after Sales Room chose the route',async()=>{
  const source = read('backend/catalogueAuth.web.js');
  const resolve = source.slice(source.indexOf('async function resolveBuyerContext('), source.indexOf('async function workspaceItems('));
  const start = source.indexOf('export const getBuyerWorkspace =');
  const end = source.indexOf('\nexport const ', start + 1);
  const workspace = source.slice(start, end).replace(/^export /, '');
  let selectionReads = 0;
  const getBuyerWorkspace = vm.runInNewContext(`${resolve}\n${workspace}\ngetBuyerWorkspace`, {
    webMethod: (_permission, handler) => handler,
    Permissions: { SiteMember: 'SiteMember' },
    signedInMember: async () => ({ _id: 'qa-staff-member' }),
    normalize: value => String(value || '').trim(),
    requireStaff: async () => ({ staffId: 'qa-staff' }),
    customerById: async id => ({ customerId: id }),
    requireStaffCustomerAccess: (staff, action, customerId) => {
      assert.equal(staff.staffId, 'qa-staff');
      assert.equal(action, 'BUYER_ROOM_VIEW');
      assert.equal(customerId, 'CUS-FAKE');
      throw new Error('Customer access was revoked');
    },
    workspaceItems: async () => { selectionReads++; }
  });
  await assert.rejects(getBuyerWorkspace('CUS-FAKE'), /Customer access was revoked/);
  assert.equal(selectionReads, 0);
});
test('all-customer browsing does not replace administrator-only lifecycle, FX or assignment checks',()=>{
  const source=read('sales-room/wix/onboarding.web.js');
  assert.equal((source.match(/if \(!staff\.canBrowseAllCustomers\)/g)||[]).length,2);
  assert.equal((source.match(/canViewAllCustomers/g)||[]).length,4);
  assert.match(read('sales-room/wix/sales-room-page.js'),/canViewAllCustomers: staff.canViewAllCustomers/);
  assert.match(read('integration/wix/ltpos-staff-portal-page.js'),/fmcgmalaysia\.com\/sales-room-login/);
});
