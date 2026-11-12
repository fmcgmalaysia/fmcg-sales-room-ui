const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({scope = null, buyerRows = {}, verified = true} = {}) {
  const calls = [];
  const source = fs.readFileSync(path.join(__dirname,'../../backend/http-functions.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const api = vm.runInNewContext(source+'\n({get_googleStaffAuth,authorizeQuotationSync})',{
    URLSearchParams,
    response: result => result,
    createNctReceiver: () => () => {},
    getSecret: async () => 'fixture-value',
    getMasterStaffScope: async (email, verifiedIdentity) => {
      assert.equal(email,'employee@example.com');
      assert.equal(verifiedIdentity,true);
      calls.push('MASTER');
      return scope;
    },
    staffMayAccessCustomer: (staff, action, id) => staff.authorized && staff.customerScope.customerActions[action]?.includes(id),
    fetch: async url => ({ok:true,json:async () => url.includes('/userinfo')
      ? {email:'employee@example.com',email_verified:verified} : {access_token:'fixture-token'}}),
    authentication: {generateSessionToken:async () => {calls.push('session');return 'fixture-session';}},
    wixData: {query(name) {
      assert.ok(name in buyerRows,'staff login must not read a local employee authority');
      return {eq:()=>({limit:()=>({find:async()=>({items:buyerRows[name]})})})};
    }},
    console: {warn(){},error(){}}
  });
  return {api,calls};
}

const request = state => ({query:{state,code:'fixture-code'}});
const staffState = 'a'.repeat(48);
const employee = {staffId:'staff-a',customerScope:{customerActions:{VIEW:['customer-a'],PUBLISH_QUOTATION:[]}}};

test('Google staff callback issues a session only after MASTER confirms access',async()=>{
  for (const [scope, expected] of [[employee,'success'],[null,'not_authorized']]) {
    const f=fixture({scope});
    const result=await f.api.get_googleStaffAuth(request(staffState));
    assert.match(result.headers.Location,new RegExp('/sales-room-login\\?oauth='+expected));
    assert.deepEqual(f.calls,scope?['MASTER','session']:['MASTER']);
  }
});

test('unverified Google email cannot reach MASTER or start a staff session',async()=>{
  const f=fixture({verified:false,scope:employee});
  const result=await f.api.get_googleStaffAuth(request(staffState));
  assert.match(result.headers.Location,/oauth=unverified_email/);
  assert.deepEqual(f.calls,[]);
});

test('Buyer Google callback still uses the customer directory',async()=>{
  const f=fixture({buyerRows:{WixCustomerUsers:[{customerId:'customer-a',status:'ACTIVE'}],WixCustomers:[{customerId:'customer-a'}]}});
  const result=await f.api.get_googleStaffAuth(request('B_'+staffState));
  assert.match(result.headers.Location,/buyer-room-login\?oauth=success/);
  assert.deepEqual(f.calls,['session']);
});

test('Google quotation sync requires MASTER publishing permission for that customer',async()=>{
  const request={headers:{authorization:'Bearer test-google-token'}};
  const f=fixture({scope:employee});
  assert.equal(await f.api.authorizeQuotationSync(request,{customerId:'customer-a'}),null);
  const editor=fixture({scope:{...employee,customerScope:{customerActions:{PUBLISH_QUOTATION:['customer-a']}}}});
  assert.equal(await editor.api.authorizeQuotationSync(request,{customerId:'customer-b'}),null);
  assert.equal((await editor.api.authorizeQuotationSync(request,{customerId:'customer-a'})).actorEmail,'employee@example.com');
});
