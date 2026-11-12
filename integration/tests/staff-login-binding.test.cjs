const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const employee = {
  _id: 'employee-record', staffId: 'staff-test', title: 'Test Employee',
  staffEmail: 'employee@example.com', role: 'SALES', status: 'ACTIVE',
  wixMemberId: '', quotationDeskFileId: 'original-qd'
};

function fixture(options = {}) {
  const writes = [], calls = [];
  const rows = options.rows ?? [{...employee}];
  const source = fs.readFileSync(path.join(__dirname, '../../backend/staffAuth.web.js'), 'utf8')
    .replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '');
  const api = vm.runInNewContext(source + '\n({getCurrentStaffContext})', {
    Permissions: {SiteMember: 'SiteMember'},
    webMethod(permission, handler) { assert.equal(permission, 'SiteMember'); return handler; },
    members: {getCurrentMember: async () => options.loggedIn === false ? null : ({member:{_id:'member-test',status:'APPROVED',
      loginEmail:options.email ?? 'EMPLOYEE@example.com',loginEmailVerified:true,...options.verifiedMember}})},
    wixData: {
      query(collection) {
        assert.equal(collection, 'StaffMaster');
        return {limit: () => ({find: async () => ({items: rows})})};
      },
      async update(collection, row) {
        calls.push('bind');
        if (options.writeFailure) throw Error('Write unavailable');
        writes.push({...row});
        return row;
      }
    },
    async getMasterStaffScope(email, verified) {
      calls.push('authorize');
      assert.equal(email, 'employee@example.com');
      if (options.centralFailure) throw Error('Central unavailable');
      if (options.allowed === false) return null;
      const customerScope = {allCustomers:options.centralAdmin === true,customerActions:{VIEW:['customer-a']}};
      assert.equal(verified,true);
      return {staffId:'master-employee',staffName:'New Employee',customerScope};
    }
  });
  return {...api, writes, calls};
}

for (const [label, options, reason] of [
  ['incomplete', {rows:[{...employee,staffId:''}]}, 'STAFF_RECORD_INCOMPLETE'],
  ['central denial', {allowed:false}, 'MASTER_STAFF_ACCESS_DENIED'],
  ['central unavailable', {centralFailure:true}, 'MASTER_STAFF_ACCESS_UNAVAILABLE'],
  ['different existing member', {rows:[{...employee,wixMemberId:'other-member'}]}, 'STAFF_MEMBER_MISMATCH'],
  ['changed email', {rows:[{...employee,wixMemberId:'member-test'}],email:'other@example.com'}, 'STAFF_EMAIL_MISMATCH'],
  ['duplicate email', {rows:[{...employee},{...employee,_id:'duplicate'}]}, 'DUPLICATE_STAFF_EMAIL'],
  ['duplicate member', {rows:[{...employee,wixMemberId:'member-test'},{...employee,_id:'duplicate',wixMemberId:'member-test'}]}, 'DUPLICATE_WIX_MEMBER_ID'],
  ['signed out', {loggedIn:false}, 'NOT_LOGGED_IN']
]) {
  test(`${label}: denial must not bind a member or update the staff record`, async () => {
    const f = fixture(options);
    const result = await f.getCurrentStaffContext();
    assert.equal(result.authorized, false);
    assert.equal(result.reason, reason);
    assert.equal(f.writes.length, 0);
    assert.equal(f.calls.includes('bind'), false);
  });
}

test('eligible first login reads legacy references and does not create a new binding', async () => {
  const f = fixture();
  const result = await f.getCurrentStaffContext();
  assert.equal(result.authorized, true);
  assert.equal(result.identitySource, 'MASTER_WITH_LEGACY_REFERENCES');
  assert.deepEqual(f.calls, ['authorize']);
  assert.deepEqual(f.writes, []);
  assert.equal(result.staffId, employee.staffId);
  assert.equal(result.quotationDeskFileId, employee.quotationDeskFileId);
});

test('existing binding is checked centrally without rebinding', async () => {
  const f = fixture({rows:[{...employee,wixMemberId:'member-test'}]});
  const result = await f.getCurrentStaffContext();
  assert.equal(result.authorized, true);
  assert.equal(result.identitySource, 'MASTER_WITH_LEGACY_REFERENCES');
  assert.deepEqual(f.calls, ['authorize']);
  assert.equal(f.writes.length, 0);
});

test('the old active employee row cannot grant access independently of MASTER', async () => {
  const f = fixture({allowed:false,rows:[{...employee,wixMemberId:'member-test'}]});
  const result = await f.getCurrentStaffContext();
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'MASTER_STAFF_ACCESS_DENIED');
  assert.deepEqual(f.calls, ['authorize']);
});

test('a legacy local administrator cannot expand the MASTER customer scope', async () => {
  const f = fixture({rows:[{...employee,role:'SUPER ADMIN',wixMemberId:'member-test'}]});
  const result = await f.getCurrentStaffContext();
  assert.equal(result.authorized,true);
  assert.equal(result.canViewAllCustomers,false);
  assert.equal(result.role,'STAFF');
  assert.deepEqual([...result.customerScope.customerActions.VIEW],['customer-a']);
});

test('a verified new employee uses the MASTER identity without creating an FMCG row', async () => {
  const f = fixture({rows:[]});
  const result = await f.getCurrentStaffContext();
  assert.equal(result.authorized,true);
  assert.equal(result.staffId,'master-employee');
  assert.deepEqual(f.calls,['authorize']);
  assert.equal(f.writes.length,0);
});

test('a new employee with an unverified or unapproved Wix identity is denied before the cross-site lookup', async () => {
  for (const verifiedMember of [{loginEmailVerified:false},{loginEmail:''},{status:'PENDING'}]) {
    const f=fixture({rows:[],verifiedMember});
    assert.equal((await f.getCurrentStaffContext()).reason,'VERIFIED_STAFF_EMAIL_REQUIRED');
    assert.equal(f.calls.length,0);
  }
});
