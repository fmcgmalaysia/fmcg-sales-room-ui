const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, name, globals) {
  const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8')
    .replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(source + '\n' + name, {
    Permissions: { SiteMember: 'SiteMember' },
    webMethod(permission, handler) { assert.equal(permission, 'SiteMember'); return handler; },
    ...globals
  });
}

function fixture(options = {}) {
  const calls = [];
  const getCurrentStaffContext = load('backend/staffAuth.web.js', 'getCurrentStaffContext', {
    members: { async getCurrentMember() {
      if (options.memberError) throw Error('Wix temporarily unavailable');
      if (options.loggedIn === false) return null;
      return { member: { _id: 'member-test', status: 'APPROVED', loginEmail: 'EMPLOYEE@example.invalid',
        loginEmailVerified: true, ...options.member } };
    } },
    async getMasterStaffScope(email, verified) {
      calls.push({ email, verified });
      if (options.centralError) throw Error('LTPOS unavailable');
      if (options.allowed === false) return null;
      return { staffId: 'master-employee', staffName: 'Test Employee',
        customerScope: { allCustomers: options.admin === true, customerActions: { VIEW: ['customer-a'] } } };
    }
    // Deliberately omit wixData. No FMCG collection is needed to authenticate.
  });
  return { getCurrentStaffContext, calls };
}

for (const [options, reason, reads] of [
  [{ memberError: true }, 'MEMBER_LOOKUP_ERROR', 0],
  [{ loggedIn: false }, 'NOT_LOGGED_IN', 0],
  [{ member: { loginEmailVerified: false } }, 'VERIFIED_STAFF_EMAIL_REQUIRED', 0],
  [{ member: { status: 'PENDING' } }, 'VERIFIED_STAFF_EMAIL_REQUIRED', 0],
  [{ member: { loginEmail: '' } }, 'VERIFIED_STAFF_EMAIL_REQUIRED', 0],
  [{ allowed: false }, 'MASTER_STAFF_ACCESS_DENIED', 1],
  [{ centralError: true }, 'MASTER_STAFF_ACCESS_UNAVAILABLE', 1]
]) {
  test(`FMCG staff context fails closed on ${reason}`, async () => {
    const f = fixture(options);
    const result = await f.getCurrentStaffContext();
    assert.equal(result.authorized, false);
    assert.equal(result.reason, reason);
    assert.equal(f.calls.length, reads);
  });
}

test('a verified employee works with no FMCG staff collection and only LTPOS customer scope', async () => {
  const f = fixture();
  const result = await f.getCurrentStaffContext();
  assert.equal(result.authorized, true);
  assert.equal(result.staffId, 'master-employee');
  assert.equal(result.role, 'STAFF');
  assert.equal(result.canViewAllCustomers, false);
  assert.deepEqual([...result.customerScope.customerActions.VIEW], ['customer-a']);
  assert.deepEqual(f.calls, [{ email: 'employee@example.invalid', verified: true }]);
});

test('the activity report keeps the recorded staff identity and never queries the retired directory', async () => {
  const query = { ge: () => query, lt: () => query, descending: () => query, limit: () => query,
    async find() { return { items: [
      { action: 'QD_OPENED', auditId: 'evt-2', changedByStaffId: 'historical-id', changedByStaffName: 'Recorded Name', changedAt: '2026-11-17T06:20:00Z' },
      { action: 'SALES_ROOM_ENTER', auditId: 'evt-1', changedByStaffId: 'historical-id', changedByStaffName: 'Earlier Name', changedAt: '2026-11-17T06:00:00Z' },
      { action: 'UNRELATED_PROFILE_CHANGE', auditId: 'evt-0', changedByStaffId: 'other-id' }
    ] }; } };
  const reads = [];
  let admin = false;
  const getActivity = load('sales-room/wix/onboarding.web.js', 'getSalesRoomActivityForAdmin', {
    getCurrentStaffContext: () => ({ authorized: true, staffId: 'current-master-id', canViewAllCustomers: admin }),
    wixData: { query(name) { reads.push(name); assert.equal(name, 'CustomerProfileAudit'); return query; } }
  });
  await assert.rejects(getActivity(), /Admin access is required/);
  assert.equal(reads.length, 0);
  admin = true;
  const result = await getActivity();
  assert.deepEqual(reads, ['CustomerProfileAudit']);
  assert.equal(result.events.length, 2);
  assert.equal(result.summaries.length, 1);
  assert.equal(result.summaries[0].staffId, 'HISTORICAL-ID');
  assert.equal(result.summaries[0].staffName, 'Recorded Name');
  assert.equal(result.summaries[0].activityCount, 2);
  assert.equal(result.summaries[0].lastActivityAt, '2026-11-17T06:20:00Z');
});
