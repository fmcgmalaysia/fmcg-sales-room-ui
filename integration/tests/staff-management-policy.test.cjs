const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const policy = load('staffManagementPolicy.js');

const member = { _id: 'member-1', loginEmail: 'SUPPORT@example.com', status: 'APPROVED' };
const active = {
  title: 'staff-1',
  description: 'member-1',
  staffName: 'Example employee',
  staffEmail: 'support@example.com',
  staffStatus: 'ACTIVE',
  role: 'STAFF',
  staffAccess: policy.normalizeStaffAccess({
    departmentAccess: { PURCHASE: 'EDIT', SUPPORT: 'EDIT', 'SALES MANAGEMENT': 'VIEW' },
    companyIds: ['NCT'],
    supportViewAll: true,
    customerAccess: {'customer-a':'EDIT'},
    salesRoom: 'EDIT',
    salesFunction: 'SUPPORT'
  })
};

test('staff identity requires both the verified email and member binding', () => {
  assert.equal(policy.resolveManagedStaff(member, [active]), active);
  for (const change of [{_id:'other'}, {loginEmail:'old@example.com'}, {status:'PENDING'}]) {
    assert.throws(() => policy.resolveManagedStaff({...member,...change}, [active]));
  }
  assert.throws(() => policy.resolveManagedStaff(member, [active, {...active}]));
  assert.throws(() => policy.resolveManagedStaff(member, [{...active, staffStatus:'DISABLED'}]));
});

test('only an active bound Super Admin can manage employee records', () => {
  for (const role of ['STAFF','TOP MANAGEMENT','ADMIN']) {
    assert.throws(() => policy.requireStaffManager(member, [{...active,role}]));
  }
  assert.equal(policy.requireStaffManager(member,[{...active,role:'SUPER ADMIN'}]).title,active.title);
});

test('purchase editing and Support all-customer viewing can coexist with narrow Support edits', () => {
  assert.equal(policy.canUseDepartment(active,'PURCHASE','EDIT',undefined,'NCT'),true);
  assert.equal(policy.canUseDepartment(active,'ACCOUNT','VIEW',undefined,'NCT'),false);
  assert.equal(policy.canUseDepartment(active,'SUPPORT','VIEW','customer-b','NCT'),true);
  assert.equal(policy.canUseDepartment(active,'SUPPORT','EDIT','customer-a','NCT'),true);
  assert.equal(policy.canUseDepartment(active,'SUPPORT','EDIT','customer-b','NCT'),false);
  assert.equal(policy.canUseDepartment(active,'SUPPORT','EDIT',undefined,'NCT'),false);
});

test('sales reports require the transaction owner, with missing ownership denied', () => {
  assert.equal(policy.canUseSalesManagementReport(active,active.title,'NCT'),true);
  assert.equal(policy.canUseSalesManagementReport(active,'different-staff','NCT'),false);
  assert.equal(policy.canUseSalesManagementReport(active,'','NCT'),false);
});

test('Support view-only without all-customer scope sees only expressly assigned customers', () => {
  const viewer = {...active, staffAccess:policy.normalizeStaffAccess({
    departmentAccess:{SUPPORT:'VIEW'}, companyIds:['NCT'], customerAccess:{'customer-a':'VIEW'}
  })};
  assert.equal(policy.canUseDepartment(viewer,'SUPPORT','VIEW','customer-a','NCT'),true);
  assert.equal(policy.canUseDepartment(viewer,'SUPPORT','VIEW','customer-b','NCT'),false);
  assert.equal(policy.canUseDepartment(viewer,'SUPPORT','EDIT','customer-a','NCT'),false);
  assert.equal(policy.canUseDepartment(viewer,'SUPPORT','VIEW',undefined,'NCT'),false);
});

test('prepared imports remain pending and preserve legacy access checks', () => {
  const row=policy.prepareStaffRegistration({
    name:'Another employee',email:'NEW@example.com',role:'SUPER ADMIN',staffStatus:'ACTIVE',
    access:{departmentAccess:{WAREHOUSE:'EDIT'}}
  },[active],'staff-2');
  assert.equal(row.staffEmail,'new@example.com');
  assert.equal(row.staffStatus,'PENDING');
  assert.equal(row.description,'');
  assert.equal(row.role,'STAFF');
  assert.equal(row.departments.length,0);
  assert.equal(policy.canUseDepartment(row,'WAREHOUSE','EDIT',undefined,'NCT'),false);
  assert.throws(()=>policy.prepareStaffRegistration({name:'Duplicate',email:member.loginEmail},[active],'staff-2'));
  assert.throws(()=>policy.normalizeStaffAccess({departmentAccess:{SUPPORT:'VIEW'},supportEditCustomerIds:['customer-a']}));
});

test('unassigned customers remain closed in both sites without removing explicit Support view-all', () => {
  const staff={...active,staffAccess:policy.normalizeStaffAccess({
    departmentAccess:{SUPPORT:'EDIT'},companyIds:['NCT'],supportViewAll:true,
    salesRoom:'EDIT',salesFunction:'SUPPORT'
  })};
  assert.equal(policy.canUseDepartment(staff,'SUPPORT','VIEW','customer-a','NCT'),true);
  assert.equal(policy.canUseDepartment(staff,'SUPPORT','EDIT','customer-a','NCT'),false);
  for (const action of ['VIEW','ASSIST_SELECTION','EDIT_REVIEW_QTY','SUBMIT_ORDER']) {
    assert.equal(policy.canUseSalesRoomCustomer(staff,action,'customer-a'),false);
  }
});

test('Support can assist an authorized customer but cannot edit or publish quotations', () => {
  for (const action of ['VIEW','ASSIST_SELECTION','SEND_ORDER_REQUEST','EDIT_REVIEW_QTY','SUBMIT_ORDER']) {
    assert.equal(policy.canUseSalesRoomCustomer(active,action,'customer-a'),true,action);
    assert.equal(policy.canUseSalesRoomCustomer(active,action,'customer-b'),false,action);
  }
  for (const action of ['EDIT_QUOTATION','PUBLISH_QUOTATION','POST_PAYMENT','UNKNOWN']) {
    assert.equal(policy.canUseSalesRoomCustomer(active,action,'customer-a'),false,action);
  }
});

test('View access at either layer prevents all customer writes', () => {
  for (const scope of [
    {...active.staffAccess,salesRoom:'VIEW'},
    {...active.staffAccess,customerAccess:{'customer-a':'VIEW'}}
  ]) {
    const staff={...active,staffAccess:scope};
    assert.equal(policy.canUseSalesRoomCustomer(staff,'VIEW','customer-a'),true);
    for (const action of ['ASSIST_SELECTION','SEND_ORDER_REQUEST','EDIT_REVIEW_QTY','SUBMIT_ORDER']) {
      assert.equal(policy.canUseSalesRoomCustomer(staff,action,'customer-a'),false);
    }
  }
  const staff={...active,staffAccess:{...active.staffAccess,departmentAccess:{SUPPORT:'VIEW'}}};
  assert.equal(policy.canUseDepartment(staff,'SUPPORT','EDIT','customer-a','NCT'),false);
});

test('sales quote permissions and historical report ownership remain separate', () => {
  const sales={...active,staffAccess:{...active.staffAccess,salesFunction:'SALES'}};
  assert.equal(policy.canUseSalesRoomCustomer(sales,'PUBLISH_QUOTATION','customer-a'),true);
  assert.equal(policy.canUseSalesRoomCustomer(sales,'PUBLISH_QUOTATION','customer-b'),false);
  assert.equal(policy.canUseSalesManagementReport(sales,'previous-employee','NCT'),false);
});

test('company permission is explicit and does not default to both companies', () => {
  for (const company of ['GHR','',undefined,'other']) {
    assert.equal(policy.canUseDepartment(active,'PURCHASE','EDIT',undefined,company),false);
  }
  const noCompany={...active,staffAccess:{...active.staffAccess,companyIds:[]}};
  assert.equal(policy.canUseDepartment(noCompany,'PURCHASE','VIEW',undefined,'NCT'),false);
  assert.equal(policy.canUseSalesManagementReport(active,active.title,'GHR'),false);
});

test('disabled and pending staff cannot use previously granted access', () => {
  for (const staffStatus of ['DISABLED','PENDING','']) {
    for (const role of ['STAFF','SUPER ADMIN']) {
      const staff={...active,staffStatus,role};
      assert.equal(policy.canUseDepartment(staff,'SUPPORT','EDIT','customer-a','NCT'),false);
      assert.equal(policy.canUseSalesRoomCustomer(staff,'SUBMIT_ORDER','customer-a'),false);
    }
  }
});

test('malformed grants and unknown actions fail closed', () => {
  for (const input of [null,[],{companyIds:['ALL']},{salesRoom:true},
    {salesRoom:'EDIT'},{salesFunction:'SALES'}, {customerAccess:{' x ':'EDIT'}},
    {customerAccess:{x:'ADMIN'}},JSON.parse('{"customerAccess":{"__proto__":"EDIT"}}'),
    {supportViewAll:true}, {departmentAccess:[]}]) {
    assert.throws(()=>policy.normalizeStaffAccess(input));
  }
  const forged={...active,staffAccess:{...active.staffAccess,customerAccess:Object.create({'customer-b':'EDIT'})}};
  assert.equal(policy.canUseSalesRoomCustomer(forged,'SUBMIT_ORDER','customer-b'),false);
  assert.equal(policy.canUseSalesRoomCustomer({...active,role:'SUPER ADMIN'},'POST_PAYMENT','customer-a'),false);
});

test('the registration endpoint never discloses staff data or writes for an ordinary member', async () => {
  const { getManagedStaffDirectory, registerPendingStaff, records, inserts, queries } = testStaffWeb(active);
  await assert.rejects(getManagedStaffDirectory(), /Super Admin/);
  await assert.rejects(registerPendingStaff({name:'Test',email:'new@example.com'}), /Super Admin/);
  assert.equal(records.length,1);
  assert.equal(inserts.length,0);
  assert.equal(queries.length,2);
  assert.ok(queries.every(query=>query.field==='description' && query.limit===2));
});

test('simultaneous registrations of the same email cannot both insert', async () => {
  const { getManagedStaffDirectory, registerPendingStaff, records } = testStaffWeb({...active,role:'SUPER ADMIN'});
  const results = await Promise.allSettled([
    registerPendingStaff({name:'First',email:'NEW@example.com',requestId:require('node:crypto').randomUUID()}),
    registerPendingStaff({name:'Second',email:'new@example.com',requestId:require('node:crypto').randomUUID()})
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(records.length,2);
  const directory = await getManagedStaffDirectory();
  const registered = directory.find(row=>row.email==='new@example.com');
  assert.equal(registered.status,'PENDING');
  assert.equal(registered.linked,false);
  assert.equal(registered.staffId,records[1].title);
});

test('pending registrations store the planned company access without enabling workroom access', async () => {
  const { registerPendingStaff, records } = testStaffWeb({...active,role:'SUPER ADMIN'});
  const registered = await registerPendingStaff({
    name:'New employee',
    email:'new@example.com',
    requestId:require('node:crypto').randomUUID(),
    access:{departmentAccess:{PURCHASE:'EDIT'},companyIds:['NCT','GHR']}
  });
  assert.deepEqual([...registered.access.companyIds],['NCT','GHR']);
  const row = records.find(item => item.title === registered.staffId);
  assert.equal(row.departments.length,0);
  for (const company of ['NCT','GHR']) {
    assert.equal(policy.canUseDepartment(row,'PURCHASE','EDIT',undefined,company),false);
  }
});

test('staff browsing and repeated permission changes create no Activity or growing save history', async () => {
  const f = testStaffWeb({...active,role:'SUPER ADMIN'});
  let employee = await f.registerPendingStaff({name:'New employee',email:'new@example.com',
    requestId:require('node:crypto').randomUUID(),access:{}});
  const inserted = f.inserts.length;
  for (let n=0;n<10;n++) await f.getManagedStaffDirectory();
  assert.equal(f.inserts.length,inserted,'directory reads must not insert records');
  for (let n=0;n<10;n++) {
    employee=await f.updateManagedStaff({staffId:employee.staffId,revision:employee.revision,
      name:'New employee',email:employee.email,status:n%2?'ACTIVE':'DISABLED',
      requestId:require('node:crypto').randomUUID(),
      access:{departmentAccess:{PURCHASE:n%2?'VIEW':'EDIT'},companyIds:['NCT','GHR']}});
    assert.equal(f.records.length,2,'one admin and one employee; no accumulated history');
  }
  assert.equal(f.updates.length,10);
  assert.ok(f.inserts.every(row=>row.staffStatus==='CONTROL'||row.title===employee.staffId));
  // The fixture rejects every collection other than StaffMasterAccess,
  // including any future Activity/audit insertion added to this path.
});

test('the Wix page reuses the existing login and only reads the directory after sign-in', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  let receive;
  let loggedIn = false;
  let reads = 0;
  const replies = [];
  const frame = {onMessage(handler){receive=handler;},postMessage(reply){replies.push(reply);}};
  const $w = () => frame;
  $w.onReady = handler => handler();
  const code = fs.readFileSync(require('node:path').join(__dirname,'../wix/master-staff-management-page.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'');
  vm.runInNewContext(code,{
    $w,
    authentication:{
      loggedIn:() => loggedIn,
      promptLogin:async options => {
        assert.equal(options.mode,'login');
        assert.equal(options.modal,true);
        loggedIn=true;
      }
    },
    getManagedStaffDirectory:async () => {reads++;throw Error('Super Admin access is required.');}
  });
  const call = action => receive({data:{action,requestId:action}});
  await call('LIST_STAFF');
  assert.equal(replies.at(-1).signInRequired,true);
  assert.equal(reads,0);
  await call('SIGN_IN');
  assert.equal(replies.at(-1).ok,true);
  assert.equal(reads,0);
  await call('LIST_STAFF');
  assert.equal(reads,1);
  assert.equal(replies.at(-1).ok,false);
  assert.match(replies.at(-1).error,/Super Admin/);
});

function testStaffWeb(actor) {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createHash, randomUUID } = require('node:crypto');
  const records = [{_id:'actor-record',...actor}];
  const inserts = [];
  const updates = [];
  const queries = [];
  const wixData = {
    async get(collection,id){assert.equal(collection,'StaffMasterAccess');return records.find(row=>row._id===id);},
    async remove(collection,id){assert.equal(collection,'StaffMasterAccess');const index=records.findIndex(row=>row._id===id);if(index>=0)records.splice(index,1);},
    async update(collection,row){
      assert.equal(collection,'StaffMasterAccess');
      const index=records.findIndex(record=>record._id===row._id);
      assert.notEqual(index,-1);records[index]={...row};updates.push({...row});return row;
    },
    query: collection => {
      assert.equal(collection,'StaffMasterAccess');
      const query={};
      const builder={
        eq(field,value){query.field=field;query.value=value;return builder;},
        limit(value){query.limit=value;return builder;},
        async find(options){
          assert.equal(options.consistentRead,true);
          queries.push({...query});
          const matching=records.filter(row=>!query.field || row[query.field]===query.value);
          return {items:matching.slice(0,query.limit),hasNext:()=>false};
        }
      };
      return builder;
    },
    async insert(collection, row) {
      assert.equal(collection,'StaffMasterAccess');
      if (records.some(record=>record._id===row._id)) throw Error('Duplicate row ID.');
      records.push(row);
      inserts.push(row);
      return row;
    }
  };
  const script = fs.readFileSync(require('node:path').join(__dirname,'../backend/staffManagement.web.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const writeSource=fs.readFileSync(require('node:path').join(__dirname,'../backend/staffManagementWrite.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const writeStaffManagement=vm.runInNewContext(writeSource+'\nwriteStaffManagement',{wixData});
  const api = vm.runInNewContext(script+'\n({getManagedStaffDirectory,registerPendingStaff,updateManagedStaff})',{
    writeStaffManagement,
    createHash,randomUUID,wixData,...policy,
    currentMember:{getMember:async()=>member},
    Permissions:{SiteMember:'SiteMember'},
    webMethod:(permission,handler)=>{
      assert.equal(permission,'SiteMember');
      return handler;
    }
  });
  return {...api,records,inserts,updates,queries};
}

test('the staff authorization bridge answers only an authenticated server and returns a decision without staff data', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { timingSafeEqual } = require('node:crypto');
  let records = [active];
  let reads = 0;
  const code = fs.readFileSync(require('node:path').join(__dirname,'../backend/staffAccessGateway.js'),'utf8')
    .replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
  const check = vm.runInNewContext(code+'\ncheckFmcgStaffAccess',{
    Buffer, timingSafeEqual, ...policy, getSecret:async ()=>'test-only',
    wixData:{query: collection => {
      assert.equal(collection,'StaffMasterAccess');
      return {eq(field,value){
        assert.equal(field,'staffEmail');
        return {limit(limit){
          assert.equal(limit,2);
          return {async find(options){
            assert.equal(options.consistentRead,true);
            reads++;
            return {items:records.filter(record=>record.staffEmail===value)};
          }};
        }};
      }};
    }}
  });
  const request = (action, customerId, token = 'test-only') => ({
    headers:{Authorization:'Bearer '+token},
    body:{text:async()=>JSON.stringify({loginEmail:member.loginEmail,action,customerId,role:'SUPER ADMIN'})}
  });
  assert.equal((await check(request('ENTER',undefined,'wrong'))).status,401);
  assert.equal(reads,0);
  assert.equal(JSON.stringify((await check(request('ENTER'))).body),'{"allowed":true}');
  assert.equal((await check(request('SUBMIT_ORDER','customer-a'))).body.allowed,true);
  assert.equal((await check(request('PUBLISH_QUOTATION','customer-a'))).body.allowed,false);
  assert.equal((await check(request('VIEW','customer-b'))).body.allowed,false);

  const path = require('node:path');
  const loadCandidate = (file, bindings, name) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
      .replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '');
    return vm.runInNewContext(source + '\n' + name, bindings);
  };
  const postStaffAccess = loadCandidate('../backend/http-functions.js', {
    response: result => result, checkFmcgStaffAccess: check, createNctReceiver: () => null
  }, 'post_staffAccess');
  const denied = await postStaffAccess(request('ENTER', undefined, 'wrong'));
  assert.equal(denied.status, 401);
  assert.equal(denied.headers['Cache-Control'], 'no-store');
  assert.equal(denied.body, '{"allowed":false}');

  const masterAllowsStaffAction = loadCandidate('../../backend/masterStaffAccessClient.js', {
    getSecret: async () => 'test-only',
    fetch: async (url, options) => {
      assert.equal(new URL(url).pathname, '/master/_functions/staffAccess');
      assert.equal(options.method.toUpperCase(), 'POST');
      const result = await postStaffAccess({ headers: options.headers, body: { text: async () => options.body } });
      return { ok: result.status === 200, json: async () => JSON.parse(result.body) };
    }
  }, 'masterAllowsStaffAction');
  assert.equal(await masterAllowsStaffAction(member.loginEmail, 'SUBMIT_ORDER', 'customer-a'), true);
  assert.equal(await masterAllowsStaffAction(member.loginEmail, 'VIEW', 'customer-b'), false);
  assert.equal(await masterAllowsStaffAction(member.loginEmail, 'PUBLISH_QUOTATION', 'customer-a'), false);

  records = [{...active,staffStatus:'DISABLED'}];
  assert.equal(await masterAllowsStaffAction(member.loginEmail, 'ENTER'), false);
  records = [active,active];
  assert.equal((await check(request('ENTER'))).body.allowed,false);
});
