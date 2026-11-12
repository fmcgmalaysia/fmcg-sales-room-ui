const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');

const { projectLtposWorkspaces } = load('ltposWorkspacePolicy.js');
const member = { _id: 'test-member', status: 'APPROVED', loginEmail: 'employee@example.com' };
const staff = {
  description: member._id, staffEmail: member.loginEmail,
  title: 'test-staff', staffName: 'Employee', staffStatus: 'ACTIVE',
  role: 'STAFF', departments: ['PURCHASE', 'SUPPORT']
};

test('an employee sees only the workrooms granted by existing department authorization', () => {
  const result = projectLtposWorkspaces(member, [staff]);
  assert.deepEqual([...result.workspaceIds], ['purchase', 'support']);
  assert.equal(result.name, staff.staffName);
  assert.deepEqual(Object.keys(result).sort(), ['name', 'workspaceIds']);
});

test('pending, disabled, mismatched and ambiguous identities expose no workrooms', () => {
  for (const [actor, records] of [
    [{ ...member, status: 'PENDING' }, [staff]],
    [{ ...member, _id: 'different-member' }, [staff]],
    [member, [{ ...staff, staffStatus: 'DISABLED' }]],
    [member, [staff, { ...staff }]],
    [member, []]
  ]) {
    const result = projectLtposWorkspaces(actor, records);
    assert.equal(result.name, '');
    assert.equal(result.workspaceIds.length, 0);
  }
});

test('the portal preserves existing Top Management and Super Admin department boundaries', () => {
  const top = projectLtposWorkspaces(member, [{ ...staff, departments: [], role: 'TOP MANAGEMENT' }]);
  assert.deepEqual([...top.workspaceIds], ['purchase', 'warehouse', 'finance']);
  const admin = projectLtposWorkspaces(member, [{ ...staff, departments: [], role: 'SUPER ADMIN' }]);
  assert.deepEqual([...admin.workspaceIds], ['purchase', 'support', 'warehouse', 'finance']);
});
