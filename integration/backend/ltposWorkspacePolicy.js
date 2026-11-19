import { canEnterDepartment, canEnterQuotations, normalizeStaffAccess } from 'backend/staffManagementPolicy.js';

export function projectLtposWorkspaces(record) {
  if (record?.staffStatus !== 'ACTIVE') return { name: '', workspaceIds: [] };
  const choices = [
    ['purchase', 'PURCHASE'],
    ['support', 'SUPPORT'],
    ['warehouse', 'WAREHOUSE'],
    ['finance', 'ACCOUNT'],
    ['stock-control', 'STOCK CONTROL']
  ];
  const workspaceIds = choices.filter(([, department]) =>
    ['NCT', 'GHR'].some(company => canEnterDepartment(record, department, 'VIEW', company))
  ).map(([id]) => id);
  const isManager = String(record.role ?? '').trim().toUpperCase() === 'SUPER ADMIN';
  if (canEnterQuotations(record) && !workspaceIds.includes('sales-management')) workspaceIds.push('sales-management');
  if (isManager) workspaceIds.push('staff-management');
  if (isManager || normalizeStaffAccess(record.staffAccess ?? {}).customerWork.enabled) workspaceIds.push('sales-room');
  return { name: record.staffName, workspaceIds };
}
