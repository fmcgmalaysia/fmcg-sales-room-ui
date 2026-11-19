import { readManagedStaffIdentity, requireManagedDepartmentAccess } from 'backend/staffManagementAccess.js';
export async function getPurchaseStaffContext(company, action = 'VIEW') {
  const { member, record } = await readManagedStaffIdentity();
  requireManagedDepartmentAccess(record, 'PURCHASE', action, company);
  return { staffId: record.title, staffName: record.staffName, role: String(record.role).trim().toUpperCase(), memberId: member._id };
}
