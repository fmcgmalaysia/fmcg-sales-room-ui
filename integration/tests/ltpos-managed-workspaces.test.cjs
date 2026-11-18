const test = require('node:test');
const assert = require('node:assert/strict');
const {projectLtposWorkspaces} = require('./load-master-module.cjs')('ltposWorkspacePolicy.js');

test('LTPOS uses active MASTER grants for department and Sales Room links', () => {
  const staff = {staffName:'Employee',staffStatus:'ACTIVE',role:'STAFF',departments:['ACCOUNT'],
    staffAccess:{departmentAccess:{PURCHASE:'VIEW'},companyIds:['GHR'],salesRoom:'EDIT',salesFunction:'SUPPORT'}};
  assert.deepEqual([...projectLtposWorkspaces(staff).workspaceIds],['purchase','sales-room']);
  assert.equal(projectLtposWorkspaces({...staff,staffStatus:'DISABLED'}).workspaceIds.length,0);
  assert.deepEqual([...projectLtposWorkspaces({...staff,role:'SUPER ADMIN'}).workspaceIds],
    ['purchase','support','warehouse','finance','sales-management','staff-management','sales-room']);
});

test('Sales Management is projected only from its existing department grant', () => {
  const staff = { staffName: 'Employee', staffStatus: 'ACTIVE', role: 'STAFF',
    staffAccess: { departmentAccess: { 'SALES MANAGEMENT': 'VIEW' }, companyIds: ['GHR'] } };
  assert.deepEqual([...projectLtposWorkspaces(staff).workspaceIds], ['sales-management']);
  assert.deepEqual([...projectLtposWorkspaces({ ...staff, staffAccess: { ...staff.staffAccess, companyIds: [] } }).workspaceIds], []);
});
