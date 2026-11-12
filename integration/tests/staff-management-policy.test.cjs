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
    supportViewAll: true,
    supportEditCustomerIds: ['customer-a']
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
  assert.equal(policy.canUseDepartment(active,'PURCHASE','EDIT'),true);
  assert.equal(policy.canUseDepartment(active,'ACCOUNT','VIEW'),false);
  assert.equal(policy.canUseDepartment(active,'SUPPORT','VIEW','customer-b'),true);
  assert.equal(policy.canUseDepartment(active,'SUPPORT','EDIT','customer-a'),true);
  assert.equal(policy.canUseDepartment(active,'SUPPORT','EDIT','customer-b'),false);
  assert.equal(policy.canUseDepartment(active,'SUPPORT','EDIT'),false);
});

test('sales reports require the transaction owner, with missing ownership denied', () => {
  assert.equal(policy.canUseSalesManagementReport(active,active.title),true);
  assert.equal(policy.canUseSalesManagementReport(active,'different-staff'),false);
  assert.equal(policy.canUseSalesManagementReport(active,''),false);
});

test('Support view-only without all-customer scope sees only expressly assigned customers', () => {
  const viewer = {...active, staffAccess:policy.normalizeStaffAccess({
    departmentAccess:{SUPPORT:'VIEW'}, supportViewCustomerIds:['customer-a']
  })};
  assert.equal(policy.canUseDepartment(viewer,'SUPPORT','VIEW','customer-a'),true);
  assert.equal(policy.canUseDepartment(viewer,'SUPPORT','VIEW','customer-b'),false);
  assert.equal(policy.canUseDepartment(viewer,'SUPPORT','EDIT','customer-a'),false);
  assert.equal(policy.canUseDepartment(viewer,'SUPPORT','VIEW'),false);
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
  assert.equal(policy.canUseDepartment(row,'WAREHOUSE','EDIT'),false);
  assert.throws(()=>policy.prepareStaffRegistration({name:'Duplicate',email:member.loginEmail},[active],'staff-2'));
  assert.throws(()=>policy.normalizeStaffAccess({departmentAccess:{SUPPORT:'VIEW'},supportEditCustomerIds:['customer-a']}));
});

test('the registration endpoint never discloses staff data or writes for an ordinary member', async () => {
  const { getManagedStaffDirectory, registerPendingStaff, records, inserts } = testStaffWeb(active);
  await assert.rejects(getManagedStaffDirectory(), /Super Admin/);
  await assert.rejects(registerPendingStaff({name:'Test',email:'new@example.com'}), /Super Admin/);
  assert.equal(records.length,1);
  assert.equal(inserts.length,0);
});

test('simultaneous registrations of the same email cannot both insert', async () => {
  const { getManagedStaffDirectory, registerPendingStaff, records } = testStaffWeb({...active,role:'SUPER ADMIN'});
  const results = await Promise.allSettled([
    registerPendingStaff({name:'First',email:'NEW@example.com'}),
    registerPendingStaff({name:'Second',email:'new@example.com'})
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(records.length,2);
  const directory = await getManagedStaffDirectory();
  const registered = directory.find(row=>row.email==='new@example.com');
  assert.equal(registered.status,'PENDING');
  assert.equal(registered.linked,false);
  assert.equal(registered.staffId,records[1].title);
});

function testStaffWeb(actor) {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { createHash, randomUUID } = require('node:crypto');
  const records = [actor];
  const inserts = [];
  const wixData = {
    query: () => ({limit:()=>({find:async()=>({items:[...records],hasNext:()=>false})})}),
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
  const api = vm.runInNewContext(script+'\n({getManagedStaffDirectory,registerPendingStaff})',{
    createHash,randomUUID,wixData,...policy,
    currentMember:{getMember:async()=>member},
    Permissions:{SiteMember:'SiteMember'},
    webMethod:(permission,handler)=>{
      assert.equal(permission,'SiteMember');
      return handler;
    }
  });
  return {...api,records,inserts};
}
