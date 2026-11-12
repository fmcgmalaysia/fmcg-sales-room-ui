// StaffMasterAccess remains the MASTER employee directory.
const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();
const email = value => text(value).toLowerCase();
const levels = new Set(['VIEW', 'EDIT']);
const departments = new Set(['PURCHASE', 'WAREHOUSE', 'ACCOUNT', 'SUPPORT', 'SALES MANAGEMENT']);

export function resolveManagedStaff(member, rows) {
  const memberId = text(member?._id);
  const memberEmail = email(member?.loginEmail);
  if (!memberId || !memberEmail || member.status !== 'APPROVED') {
    throw Error('Sign in with your approved staff account.');
  }
  const emailMatches = rows.filter(row => email(row.staffEmail) === memberEmail);
  const identityMatches = rows.filter(row => text(row.description) === memberId);
  const staff = emailMatches[0];
  if (emailMatches.length !== 1 || identityMatches.length !== 1 || staff !== identityMatches[0] ||
      upper(staff.staffStatus) !== 'ACTIVE' || !text(staff.title) || !text(staff.staffName)) {
    throw Error('Staff access is not authorized.');
  }
  return staff;
}

export function requireStaffManager(member, rows) {
  const staff = resolveManagedStaff(member, rows);
  if (upper(staff.role) !== 'SUPER ADMIN') throw Error('Super Admin access is required.');
  return staff;
}

export function normalizeStaffAccess(input = {}) {
  const departmentAccess = {};
  for (const [department, level] of Object.entries(input.departmentAccess ?? {})) {
    if (!departments.has(department) || !levels.has(level)) throw Error('Invalid department permission.');
    departmentAccess[department] = level;
  }
  const supportViewCustomerIds = input.supportViewCustomerIds ?? [];
  const supportEditCustomerIds = input.supportEditCustomerIds ?? [];
  if ([supportViewCustomerIds, supportEditCustomerIds].some(ids =>
      !Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !text(id))) ||
      (supportEditCustomerIds.length && departmentAccess.SUPPORT !== 'EDIT') ||
      ((input.supportViewAll === true || supportViewCustomerIds.length) && !departmentAccess.SUPPORT)) {
    throw Error('Invalid Support customer permission.');
  }
  if (input.supportViewAll !== undefined && typeof input.supportViewAll !== 'boolean') throw Error('Invalid Support view scope.');
  if (input.salesRoom !== undefined && typeof input.salesRoom !== 'boolean') throw Error('Invalid Sales Room permission.');
  return {
    departmentAccess,
    supportViewAll: input.supportViewAll === true,
    supportViewCustomerIds: [...new Set(supportViewCustomerIds.map(text))],
    supportEditCustomerIds: [...new Set(supportEditCustomerIds.map(text))],
    salesRoom: input.salesRoom === true
  };
}

export function canUseDepartment(staff, department, action, customerId) {
  if (upper(staff?.staffStatus) !== 'ACTIVE' || !departments.has(department) || !levels.has(action)) return false;
  if (upper(staff.role) === 'SUPER ADMIN') return true;
  const access = staff.staffAccess?.departmentAccess?.[department];
  if (!levels.has(access) || (action === 'EDIT' && access !== 'EDIT')) return false;
  if (department !== 'SUPPORT') return true;
  const id = text(customerId);
  if (!id) return false;
  const scope = staff.staffAccess;
  const canEditCustomer = Array.isArray(scope.supportEditCustomerIds) && scope.supportEditCustomerIds.includes(id);
  if (action === 'EDIT') return canEditCustomer;
  return canEditCustomer || scope.supportViewAll === true ||
    (Array.isArray(scope.supportViewCustomerIds) && scope.supportViewCustomerIds.includes(id));
}

export function canUseSalesManagementReport(staff, authoritativeStaffId) {
  if (!canUseDepartment(staff, 'SALES MANAGEMENT', 'VIEW')) return false;
  return upper(staff.role) === 'SUPER ADMIN' ||
    Boolean(text(authoritativeStaffId) && text(authoritativeStaffId) === text(staff.title));
}

export function projectManagedStaff(row) {
  return {
    staffId: text(row.title),
    name: text(row.staffName),
    email: email(row.staffEmail),
    status: upper(row.staffStatus),
    role: upper(row.role),
    linked: Boolean(text(row.description)),
    access: normalizeStaffAccess(row.staffAccess ?? {})
  };
}

export function prepareStaffRegistration(input, rows, staffId) {
  const name = text(input?.name);
  const workEmail = email(input?.email);
  if (!name || name.length > 80 || workEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    throw Error('Enter a valid staff name and email.');
  }
  if (!text(staffId) || rows.some(row => text(row.title) === staffId || email(row.staffEmail) === workEmail)) {
    throw Error('This staff identity is already registered.');
  }
  // The existing department checks use this legacy list. Keep it empty for
  // pending records, including records with planned permissions.
  return {
    title: staffId,
    description: '',
    staffName: name,
    staffEmail: workEmail,
    staffStatus: 'PENDING',
    role: 'STAFF',
    departments: [],
    staffAccess: normalizeStaffAccess(input.access)
  };
}
