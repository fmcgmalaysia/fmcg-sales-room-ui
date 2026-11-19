const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash, timingSafeEqual} = require('node:crypto');
const policy = require('./load-master-module.cjs')('staffManagementPolicy.js');
const staff = {
  title:'staff-a', description:'master-member-a', staffEmail:'staff@example.com',
  staffStatus:'ACTIVE', role:'STAFF',
  staffAccess:{salesRoom:'EDIT',salesFunction:'SUPPORT',customerAccess:{'customer-a':'EDIT'}}
};
function fixture(options = {}) {
  let reads = 0;
  let writes = 0;
  let ownerRows = options.assignmentRows ?? [];
  let actorRows = options.rows ?? [staff];
  const source = fs.readFileSync(path.join(__dirname,'../backend/staffAccessGateway.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const check = vm.runInNewContext(source+'\ncheckFmcgStaffAccess', {
    ...policy, Buffer, createHash, timingSafeEqual,
    writeStaffManagement: async ({prepare, project}) => {
      const {row} = await prepare();
      writes++;
      ownerRows = ownerRows.map(owner=>owner.title===row.title?row:owner);
      actorRows = actorRows.map(actor=>actor.title===row.title?row:actor);
      if(options.lostGrantResponse) throw Error('Response lost after grant write');
      return project(row);
    },
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
            return {items: ownerRows.filter(row=>row.staffStatus==='ACTIVE'), hasNext:()=>Boolean(options.more)};
          }};
        }};
      }
      if (field === 'title') return {limit: limit => {
        assert.equal(limit,2);
        return {find:async readOptions=>{
          assert.equal(readOptions.consistentRead,true);
          reads++;
          return {items: ownerRows.filter(row=>row.title===email)};
        }};
      }};
      assert.equal(field,'staffEmail');
      assert.equal(email,'staff@example.com');
      return {limit:limit=>{
        assert.equal(limit,2);
        return {find:async readOptions=>{
          assert.equal(readOptions.consistentRead,true);
          reads++;
          if(options.queryFailure) throw Error('Database unavailable');
          return {items:actorRows};
        }};
      }};
    }})}
  });
  return {check,get reads(){return reads;},get writes(){return writes;},get ownerRows(){return ownerRows;}};
}
const request = (input = {}, headers = {Authorization:'Bearer test-secret'}) => ({
  headers,body:{text:async()=>typeof input === 'string' ? input : JSON.stringify({
    loginEmail:'STAFF@example.com',action:'VIEW',customerId:'customer-a',...input
  })}
});

const forNewCustomer = () => request({action:'SALES_CREATION_ASSIGNEES',customerId:undefined});
const salesperson = {...staff,title:'STF-SALES1',staffName:'Sales One',staffAccess:{salesFunction:'SALES',salesRoom:'EDIT'}};

test('a manager can assign an explicitly active salesperson before their first MASTER sign-in',async()=>{
  const pendingLogin={...salesperson,title:'cac0e9d5-055c-46df-a67a-ba5b6ec7b54e',description:'',staffName:'Unlinked sales fixture'};
  const f=fixture({rows:[{...staff,role:'SUPER ADMIN'}],assignmentRows:[pendingLogin,salesperson,
    {...pendingLogin,title:'STF-PENDING',staffStatus:'PENDING'},
    {...pendingLogin,title:'STF-VIEW01',staffAccess:{salesFunction:'SALES',salesRoom:'VIEW'}},
    {...pendingLogin,title:'STF-SUPP01',staffAccess:{salesFunction:'SUPPORT',salesRoom:'EDIT'}}]});
  const listed=await f.check(forNewCustomer());
  assert.equal(listed.body.allowed,true);
  assert.deepEqual(Array.from(listed.body.assignees,row=>row.staffId).sort(),[salesperson.title,pendingLogin.title].sort());
  const resolved=await f.check(resolveOwner(pendingLogin.title));
  assert.equal(resolved.body.owner.staffId,pendingLogin.title);
  assert.equal(f.writes,0);
  const unverified=fixture({rows:[pendingLogin],assignmentRows:[pendingLogin]});
  assert.equal((await unverified.check(forNewCustomer())).body.allowed,false);
  assert.equal((await unverified.check(request({action:'ENTER'}))).body.allowed,false);
});

test('Support selection-only authorization is customer-specific and never enables trading actions',async()=>{
  const selectionStaff={...staff,staffAccess:{salesRoom:'VIEW',salesFunction:'SUPPORT',
    customerAccess:{'customer-a':'EDIT','customer-view':'VIEW'},companyIds:['NCT','GHR'],
    departmentAccess:{'SALES MANAGEMENT':'EDIT',SUPPORT:'VIEW'},supportViewAll:true}};
  const f=fixture({rows:[selectionStaff]});
  assert.equal((await f.check(request({action:'ENTER'}))).body.allowed,true);
  assert.equal((await f.check(request({action:'ASSIST_SELECTION'}))).body.allowed,true);
  for(const customerId of ['customer-view','customer-b'])
    assert.equal((await f.check(request({action:'ASSIST_SELECTION',customerId}))).body.allowed,false);
  for(const action of ['SEND_ORDER_REQUEST','EDIT_REVIEW_QTY','SUBMIT_ORDER','MANAGE_CUSTOMER','EDIT_QUOTATION','PUBLISH_QUOTATION'])
    assert.equal((await f.check(request({action}))).body.allowed,false,action);
  assert.equal((await f.check(forNewCustomer())).body.allowed,false);
  assert.equal(f.writes,0);
  for(const scope of [{...selectionStaff.staffAccess,salesRoom:''},
    {...selectionStaff.staffAccess,salesRoom:'VIEW',salesFunction:'SALES'}]) {
    // Malformed empty room is rejected; a Sales viewer still has no write permission.
    const result=await fixture({rows:[{...selectionStaff,staffAccess:scope}]}).check(request({action:'ASSIST_SELECTION'}));
    assert.notEqual(result.body.allowed,true);
  }
});

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

const newCustomerId = 'CUS-261116-TEST01';
const resolveOwner = targetStaffId => request({action:'SALES_CREATION_ASSIGNEE',customerId:undefined,targetStaffId});
const grantOwner = grantRevision => request({action:'SALES_GRANT_INITIAL_ACCESS',customerId:newCustomerId,targetStaffId:salesperson.title,grantRevision});

test('a failed acknowledgement confirms the existing initial grant without writing twice', async()=>{
  const f=fixture({rows:[salesperson],assignmentRows:[salesperson],lostGrantResponse:true});
  const resolved=await f.check(resolveOwner(undefined));
  assert.equal(resolved.body.owner.staffId,salesperson.title);
  assert.equal((await f.check(grantOwner(resolved.body.grantRevision))).status,503);
  assert.equal((await f.check(grantOwner(resolved.body.grantRevision))).body.allowed,true);
  assert.equal(f.writes,1);
  assert.equal(f.ownerRows[0].staffAccess.customerAccess[newCustomerId],'EDIT');
});

test('a changed grant cannot be silently restored by an old create retry', async()=>{
  const initial=fixture({rows:[salesperson],assignmentRows:[salesperson]});
  const {grantRevision}=(await initial.check(resolveOwner(undefined))).body;
  for(const customerAccess of [{},{[newCustomerId]:'VIEW'}]) {
    const changed={...salesperson,_updatedDate:'2026-11-16T04:15:00.000Z',staffAccess:{...salesperson.staffAccess,customerAccess}};
    const f=fixture({rows:[changed],assignmentRows:[changed]});
    assert.equal((await f.check(grantOwner(grantRevision))).status,409);
    assert.equal(f.writes,0);
  }
});

test('staff cannot resolve another assignee or grant initial access from Support', async()=>{
  const own=fixture({rows:[salesperson],assignmentRows:[salesperson]});
  assert.equal((await own.check(resolveOwner('STF-SALES2'))).body.allowed,false);
  assert.equal(own.reads,1);
  const support=fixture({rows:[staff],assignmentRows:[salesperson]});
  assert.equal((await support.check(grantOwner('a'.repeat(64)))).body.allowed,false);
  assert.equal(support.writes,0);
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
test('Support View with a customer Edit grant allows selection but denies other mutations',async()=>{
  const f=fixture({rows:[{...staff,staffAccess:{...staff.staffAccess,salesRoom:'VIEW'}}]});
  assert.equal((await f.check(request())).body.allowed,true);
  assert.equal((await f.check(request({action:'ASSIST_SELECTION'}))).body.allowed,true);
  for(const action of ['SEND_ORDER_REQUEST','EDIT_REVIEW_QTY','SUBMIT_ORDER','EDIT_QUOTATION','PUBLISH_QUOTATION']) {
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
