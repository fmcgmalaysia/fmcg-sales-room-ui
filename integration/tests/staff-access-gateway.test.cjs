const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {timingSafeEqual} = require('node:crypto');
const policy = require('./load-master-module.cjs')('staffManagementPolicy.js');
const staff = {
  title:'staff-a', description:'master-member-a', staffEmail:'staff@example.com',
  staffStatus:'ACTIVE', role:'STAFF',
  staffAccess:{salesRoom:'EDIT',salesFunction:'SUPPORT',customerAccess:{'customer-a':'EDIT'}}
};
function fixture(options = {}) {
  let reads = 0;
  const source = fs.readFileSync(path.join(__dirname,'../backend/staffAccessGateway.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const check = vm.runInNewContext(source+'\ncheckFmcgStaffAccess', {
    ...policy, Buffer, timingSafeEqual,
    getSecret:async()=>options.secret ?? 'test-secret',
    wixData:{query:()=>({eq:(field,email)=>{
      if (field === 'staffStatus') {
        assert.equal(email,'ACTIVE');
        assert.ok(options.assignmentRows);
        return {limit: limit => {
          assert.equal(limit,1000);
          return {find:async readOptions=>{
            assert.equal(readOptions.consistentRead,true);
            reads++;
            return {items: options.assignmentRows.filter(row=>row.staffStatus==='ACTIVE'), hasNext:()=>Boolean(options.more)};
          }};
        }};
      }
      assert.equal(field,'staffEmail');
      assert.equal(email,'staff@example.com');
      return {limit:limit=>{
        assert.equal(limit,2);
        return {find:async readOptions=>{
          assert.equal(readOptions.consistentRead,true);
          reads++;
          if(options.queryFailure) throw Error('Database unavailable');
          return {items:options.rows ?? [staff]};
        }};
      }};
    }})}
  });
  return {check,get reads(){return reads;}};
}
const request = (input = {}, headers = {Authorization:'Bearer test-secret'}) => ({
  headers,body:{text:async()=>typeof input === 'string' ? input : JSON.stringify({
    loginEmail:'STAFF@example.com',action:'VIEW',customerId:'customer-a',...input
  })}
});

const forNewCustomer = () => request({action:'SALES_CREATION_ASSIGNEES',customerId:undefined});
const salesperson = {...staff,title:'STF-SALES1',staffName:'Sales One',staffAccess:{salesFunction:'SALES',salesRoom:'EDIT'}};

test('only an active bound Sales Edit employee can obtain their own creation assignment', async()=>{
  const self = fixture({rows:[salesperson]});
  const result = await self.check(forNewCustomer());
  assert.equal(JSON.stringify(result.body),JSON.stringify({allowed:true,mayAssignOthers:false,assignees:[{staffId:'STF-SALES1',staffName:'Sales One'}]}));
  assert.equal(self.reads,1);
  for(const row of [staff,{...salesperson,description:''},{...salesperson,staffStatus:'PENDING'},
    {...salesperson,staffStatus:'DISABLED'},{...salesperson,staffAccess:{salesFunction:'SALES',salesRoom:'VIEW'}}]) {
    const f=fixture({rows:[row]});
    assert.equal((await f.check(forNewCustomer())).body.allowed,false);
    assert.equal(f.reads,1);
  }
});

test('Super Admin may list eligible Sales Edit owners without contact details', async()=>{
  const options={rows:[{...staff,role:'SUPER ADMIN'}],assignmentRows:[staff,salesperson,{...salesperson,title:'STF-SALES2',staffStatus:'PENDING'}]};
  const result=await fixture(options).check(forNewCustomer());
  assert.equal(JSON.stringify(result.body),JSON.stringify({allowed:true,mayAssignOthers:true,assignees:[{staffId:'STF-SALES1',staffName:'Sales One'}]}));
  assert.equal((await fixture({...options,more:true}).check(forNewCustomer())).status,503);
  assert.equal((await fixture({...options,assignmentRows:[salesperson,salesperson]}).check(forNewCustomer())).status,503);
});

test('missing, duplicate and invalid credentials reject before any employee lookup', async()=>{
  for(const headers of [{},{Authorization:'wrong'},
    {Authorization:'Bearer test-secret',authorization:'Bearer test-secret'},
    {Authorization:['Bearer test-secret']}]) {
    const f=fixture();
    assert.equal((await f.check(request({},headers))).status,401);
    assert.equal(f.reads,0);
  }
});
test('malformed or oversized requests do not read the directory',async()=>{
  for(const input of ['not json','x'.repeat(1025),{loginEmail:'invalid'},
    {action:null},{action:'x'.repeat(31)},{customerId:''},{customerId:['customer-a']},
    {customerId:'a'.repeat(161)}]) {
    const f=fixture();
    assert.equal((await f.check(request(input))).status,400);
    assert.equal(f.reads,0);
  }
});
test('a browser-supplied administrator role cannot override Support quote restrictions',async()=>{
  const f=fixture();
  const result=await f.check(request({action:'PUBLISH_QUOTATION',role:'SUPER ADMIN'}));
  assert.equal(result.body.allowed,false);
  assert.equal(Object.keys(result.body).join(','),'allowed');
});
test('central role and exact customer scope determine authorization without local role escalation',async()=>{
  for(const action of ['VIEW','ASSIST_SELECTION','SEND_ORDER_REQUEST','EDIT_REVIEW_QTY','SUBMIT_ORDER']) {
    const f=fixture();
    assert.equal((await f.check(request({action}))).body.allowed,true);
    assert.equal((await f.check(request({action,customerId:'customer-b',role:'ADMIN'}))).body.allowed,false);
  }
});
test('View staff are denied every customer mutation even with editable customer scope',async()=>{
  const f=fixture({rows:[{...staff,staffAccess:{...staff.staffAccess,salesRoom:'VIEW'}}]});
  assert.equal((await f.check(request())).body.allowed,true);
  for(const action of ['ASSIST_SELECTION','SEND_ORDER_REQUEST','EDIT_REVIEW_QTY','SUBMIT_ORDER','EDIT_QUOTATION','PUBLISH_QUOTATION']) {
    assert.equal((await f.check(request({action}))).body.allowed,false);
  }
});
test('entering the workroom does not authorize any unassigned customer',async()=>{
  const f=fixture({rows:[{...staff,staffAccess:{salesRoom:'EDIT',salesFunction:'SALES'}}]});
  assert.equal((await f.check(request({action:'ENTER',customerId:undefined}))).body.allowed,true);
  assert.equal((await f.check(request())).body.allowed,false);
  assert.equal((await f.check(request({action:'SUBMIT_ORDER'}))).body.allowed,false);
});
test('missing, duplicate, unbound, pending and disabled identities fail closed',async()=>{
  for(const rows of [[],[staff,staff],[{...staff,description:''}],
    [{...staff,staffStatus:'PENDING'}],[{...staff,staffStatus:'DISABLED',role:'SUPER ADMIN'}]]) {
    const f=fixture({rows});
    assert.equal((await f.check(request({action:'ENTER'}))).body.allowed,false);
  }
});
test('unknown actions are denied even to a Super Admin',async()=>{
  const f=fixture({rows:[{...staff,role:'SUPER ADMIN'}]});
  assert.equal((await f.check(request({action:'POST_PAYMENT'}))).body.allowed,false);
});
test('storage errors return unavailable, never an allowed decision',async()=>{
  const f=fixture({queryFailure:true});
  const result=await f.check(request());
  assert.equal(result.status,503);
  assert.equal(result.body.allowed,false);
});

test('trusted verified FMCG identity can enter without an earlier MASTER login, using the MASTER grants',async()=>{
  const f=fixture({rows:[{...staff,description:'',staffName:'Employee'}]});
  const payload={action:'DIRECTORY_SCOPE',verifiedFmcgEmail:true};
  const result=await f.check(request(payload));
  assert.equal(result.body.allowed,true);
  assert.equal(result.body.identity.staffId,staff.title);
  assert.deepEqual(result.body.scope.customerActions.PUBLISH_QUOTATION,[]);
  assert.equal((await f.check(request({...payload,verifiedFmcgEmail:false}))).body.allowed,false);
  assert.equal((await f.check(request(payload,{Authorization:'Bearer untrusted'}))).status,401);
});

test('FMCG client never accepts truthy strings or objects as authorization',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../../backend/masterStaffAccessClient.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  for(const allowed of ['true',1,{},false,undefined]) {
    const check=vm.runInNewContext(source+'\nmasterAllowsStaffAction',{
      getSecret:async()=>'test-secret',fetch:async()=>({ok:true,json:async()=>({allowed})})
    });
    assert.equal(await check('staff@example.com','VIEW','customer-a'),false);
  }
});
