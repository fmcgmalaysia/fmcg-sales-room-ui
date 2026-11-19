// StaffMasterAccess remains the MASTER employee directory.
const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();
const email = value => text(value).toLowerCase();
const levels = new Set(['VIEW', 'EDIT']);
const departments = new Set(['PURCHASE', 'WAREHOUSE', 'ACCOUNT', 'SUPPORT', 'SALES MANAGEMENT', 'STOCK CONTROL']);
const companies = new Set(['NCT', 'GHR']);
const salesFunctions = new Set(['SALES', 'SUPPORT']);
const customerActions = new Map([
  ['VIEW', 'VIEW'], ['ASSIST_SELECTION', 'EDIT'], ['SEND_ORDER_REQUEST', 'EDIT'],
  ['EDIT_REVIEW_QTY', 'EDIT'], ['SUBMIT_ORDER', 'EDIT'],
  ['EDIT_QUOTATION', 'EDIT'], ['PUBLISH_QUOTATION', 'EDIT'],
  ['MANAGE_CUSTOMER', 'EDIT'], ['CATALOGUE_VIEW', 'VIEW'], ['BUYER_ROOM_VIEW', 'VIEW']
]);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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
  if (!record(input)) throw Error('Invalid staff permissions.');
  const fields = new Set(['departmentAccess', 'companyIds', 'customerAccess', 'supportViewAll', 'salesRoom', 'salesFunction', 'customerWork', 'quotationAccess', 'performanceAccess']);
  if (Object.keys(input).some(key => !fields.has(key))) throw Error('Unknown staff permission.');
  if (!record(input.departmentAccess ?? {}) || !record(input.customerAccess ?? {})) throw Error('Invalid access scope.');
  const departmentAccess = {};
  for (const [department, level] of Object.entries(input.departmentAccess ?? {})) {
    if (!departments.has(department) || !levels.has(level)) throw Error('Invalid department permission.');
    departmentAccess[department] = level;
  }
  if (input.supportViewAll !== undefined && typeof input.supportViewAll !== 'boolean') throw Error('Invalid Support view scope.');
  if (input.supportViewAll === true && !departmentAccess.SUPPORT) throw Error('Support department permission is required.');
  if (input.performanceAccess !== undefined && input.performanceAccess !== '' && input.performanceAccess !== 'VIEW') throw Error('Invalid performance permission.');
  const companyIds = input.companyIds ?? [];
  if (!Array.isArray(companyIds) || companyIds.some(id => !companies.has(id))) throw Error('Invalid company permission.');
  const salesRoom = input.salesRoom ?? '';
  const salesFunction = input.salesFunction ?? '';
  if (salesRoom !== '' && !levels.has(salesRoom)) throw Error('Invalid Sales Room permission.');
  if (salesFunction !== '' && !salesFunctions.has(salesFunction)) throw Error('Invalid Sales Room function.');
  if (Boolean(salesRoom) !== Boolean(salesFunction)) throw Error('Choose the Sales Room function and access together.');
  const customerAccess = {};
  for (const [id, level] of Object.entries(input.customerAccess ?? {})) {
    if (!id || id !== text(id) || id.length > 160 || ['__proto__', 'constructor', 'prototype'].includes(id) || !levels.has(level)) {
      throw Error('Invalid customer permission.');
    }
    customerAccess[id] = level;
  }
  return {
    departmentAccess,
    companyIds: [...new Set(companyIds)],
    customerAccess,
    supportViewAll: input.supportViewAll === true,
    salesRoom,
    salesFunction,
    customerWork: normalizeCustomerWork(input.customerWork, {salesRoom, salesFunction}),
    quotationAccess: normalizeQuotationAccess(input.quotationAccess, departmentAccess, salesFunction),
    performanceAccess: input.performanceAccess ?? ''
  };
}

function normalizeQuotationAccess(value, departmentAccess, salesFunction) {
  if (value === undefined) return salesFunction === 'SALES' && departmentAccess['SALES MANAGEMENT'] === 'EDIT' ? 'EDIT' : '';
  if (value !== '' && value !== 'EDIT') throw Error('Invalid quotation permission.');
  return value;
}

function normalizeCustomerWork(input, legacy) {
  if (input === undefined) return {
    enabled: Boolean(legacy.salesRoom), scope: 'SELECTED',
    createCustomers: legacy.salesRoom === 'EDIT' && legacy.salesFunction === 'SALES',
    editProfiles: legacy.salesRoom === 'EDIT' && legacy.salesFunction === 'SALES',
    catalogue: legacy.salesRoom === 'EDIT' ? 'SELECT' : legacy.salesRoom ? 'VIEW' : '',
    buyerRoom: legacy.salesRoom === 'EDIT' ? 'REQUEST' : legacy.salesRoom ? 'VIEW' : '',
    submitOrders: legacy.salesRoom === 'EDIT'
  };
  const flags = ['enabled', 'createCustomers', 'editProfiles', 'submitOrders'];
  const fields = new Set([...flags, 'scope', 'catalogue', 'buyerRoom']);
  if (!record(input) || Object.keys(input).some(key => !fields.has(key)) ||
      flags.some(key => typeof input[key] !== 'boolean') || !['SELECTED', 'ALL'].includes(input.scope) ||
      !['', 'VIEW', 'SELECT'].includes(input.catalogue) || !['', 'VIEW', 'REQUEST'].includes(input.buyerRoom)) {
    throw Error('Invalid customer work permission.');
  }
  return Object.fromEntries([...fields].map(key => [key, input[key]]));
}

export function customerWorkPermission(staff, action) {
  const scope = normalizeStaffAccess(staff.staffAccess ?? {});
  const work = scope.customerWork;
  if (!work.enabled) return false;
  if (action === 'VIEW') return true;
  if (action === 'CATALOGUE_VIEW') return Boolean(work.catalogue);
  if (action === 'ASSIST_SELECTION') return work.catalogue === 'SELECT';
  if (action === 'BUYER_ROOM_VIEW') return Boolean(work.buyerRoom);
  if (['SEND_ORDER_REQUEST', 'EDIT_REVIEW_QTY'].includes(action)) return work.buyerRoom === 'REQUEST';
  if (action === 'SUBMIT_ORDER') return work.submitOrders;
  if (action === 'MANAGE_CUSTOMER') return work.editProfiles;
  return false;
}

export function canCreateManagedCustomer(staff) {
  if (upper(staff?.staffStatus) !== 'ACTIVE') return false;
  return upper(staff.role) === 'SUPER ADMIN' ||
    (normalizeStaffAccess(staff.staffAccess ?? {}).customerWork.enabled &&
      normalizeStaffAccess(staff.staffAccess ?? {}).customerWork.createCustomers);
}

export function canEnterQuotations(staff) {
  const scope = normalizeStaffAccess(staff?.staffAccess ?? {});
  return upper(staff?.staffStatus) === 'ACTIVE' &&
    (upper(staff.role) === 'SUPER ADMIN' || scope.quotationAccess === 'EDIT' || scope.performanceAccess === 'VIEW');
}

export function canQuoteManagedCustomer(staff, customer) {
  if (!canEnterQuotations(staff) || !text(customer?.customerId)) return false;
  if (upper(staff.role) === 'SUPER ADMIN') return true;
  return Boolean(text(customer.assignedStaffId) && upper(customer.assignedStaffId) === upper(staff.title));
}

function hasCustomerAccess(scope, customerId, action) {
  const id = text(customerId);
  if (!id || !own(scope?.customerAccess, id)) return false;
  const level = scope.customerAccess[id];
  return level === 'EDIT' || (level === 'VIEW' && action === 'VIEW');
}

// Callers must resolve the member first, and obtain company/customer from the
// target business record. Browser-supplied identifiers are not authorization.
export function canEnterDepartment(staff, department, action, companyId) {
  if (upper(staff?.staffStatus) !== 'ACTIVE' || !departments.has(department) || !levels.has(action) || !companies.has(companyId)) return false;
  if (upper(staff.role) === 'SUPER ADMIN') return true;
  if (!Array.isArray(staff.staffAccess?.companyIds) || !staff.staffAccess.companyIds.includes(companyId)) return false;
  const access = staff.staffAccess?.departmentAccess?.[department];
  return levels.has(access) && (action !== 'EDIT' || access === 'EDIT');
}

export function canUseDepartment(staff, department, action, customerId, companyId) {
  if (!canEnterDepartment(staff, department, action, companyId)) return false;
  if (upper(staff.role) === 'SUPER ADMIN') return true;
  if (department !== 'SUPPORT') return true;
  if (!text(customerId)) return false;
  const scope = staff.staffAccess;
  return hasCustomerAccess(scope, customerId, action) || (action === 'VIEW' && scope.supportViewAll === true);
}

export function canUseSalesRoomCustomer(staff, action, customerId) {
  if (upper(staff?.staffStatus) !== 'ACTIVE' || !customerActions.has(action) || !text(customerId)) return false;
  if (upper(staff.role) === 'SUPER ADMIN') return true;
  const scope = normalizeStaffAccess(staff.staffAccess ?? {});
  const level = customerActions.get(action);
  // Internal quotations use their own permission plus authoritative customer ownership.
  if (['EDIT_QUOTATION', 'PUBLISH_QUOTATION'].includes(action)) return false;
  if (!customerWorkPermission(staff, action)) return false;
  return scope.customerWork.scope === 'ALL' || hasCustomerAccess(scope, customerId, level);
}

// Request-local decisions for FMCG. No MASTER financial or employee directory
// fields leave this boundary, and FMCG does not maintain a second permission map.
export function projectFmcgStaffScope(staff) {
  if (upper(staff?.staffStatus) !== 'ACTIVE') return null;
  const scope = normalizeStaffAccess(staff.staffAccess ?? {});
  const allCustomers = upper(staff.role) === 'SUPER ADMIN';
  if (!allCustomers && !scope.customerWork.enabled) return null;
  const customerIds = Object.keys(scope.customerAccess);
  return {
    allCustomers,
    pages: allCustomers ? ['SALES_ROOM', 'CATALOGUE', 'BUYER_ROOM'] : ['SALES_ROOM',
      ...(scope.customerWork.catalogue ? ['CATALOGUE'] : []), ...(scope.customerWork.buyerRoom ? ['BUYER_ROOM'] : [])],
    canCreateCustomers: canCreateManagedCustomer(staff),
    allCustomerActions: allCustomers ? [] : [...customerActions.keys()].filter(action =>
      scope.customerWork.scope === 'ALL' && customerWorkPermission(staff, action)),
    customerActions: Object.fromEntries([...customerActions.keys()].map(action =>
      [action, customerIds.filter(id => canUseSalesRoomCustomer(staff, action, id))]))
  };
}

export function canUseSalesManagementReport(staff, authoritativeStaffId, companyId) {
  if (upper(staff?.staffStatus) !== 'ACTIVE' || !companies.has(companyId)) return false;
  if (upper(staff.role) === 'SUPER ADMIN') return true;
  const scope = normalizeStaffAccess(staff.staffAccess ?? {});
  if (scope.performanceAccess !== 'VIEW' || !scope.companyIds.includes(companyId)) return false;
  return Boolean(text(authoritativeStaffId) && text(authoritativeStaffId) === text(staff.title));
}

export function projectManagedStaff(row) {
  return {
    staffId: text(row.title),
    name: text(row.staffName),
    email: email(row.staffEmail),
    status: upper(row.staffStatus),
    role: upper(row.role),
    linked: Boolean(text(row.description)),
    revision: staffManagementRevision(row),
    access: normalizeStaffAccess(row.staffAccess ?? {})
  };
}

// A form revision is a stale-form guard, not a database compare-and-swap.
// The management writer serializes saves before checking it again.
export function staffManagementRevision(row) {
  return JSON.stringify([text(row._id), text(row._updatedDate), text(row.staffName),
    email(row.staffEmail), upper(row.staffStatus), text(row.description),
    upper(row.role), normalizeStaffAccess(row.staffAccess ?? {})]);
}

export function prepareStaffUpdate(input, rows, actorStaffId) {
  const matches = rows.filter(row => text(row.title) === text(input?.staffId));
  if (matches.length !== 1) throw Error('Employee identity could not be confirmed.');
  const row = matches[0];
  if (text(row.title) === text(actorStaffId) || upper(row.role) === 'SUPER ADMIN') {
    throw Error('Administrator identity cannot be changed here.');
  }
  if (input.revision !== staffManagementRevision(row)) throw Error('Employee details changed. Reopen the employee before saving.');
  if ((own(row.staffAccess, 'customerWork') && !own(input.access, 'customerWork')) ||
      (own(row.staffAccess, 'quotationAccess') && !own(input.access, 'quotationAccess')) ||
      (own(row.staffAccess, 'performanceAccess') && !own(input.access, 'performanceAccess'))) {
    throw Error('Employee details changed. Reopen the employee before saving.');
  }
  const name = text(input.name), workEmail = email(input.email);
  if (!name || name.length > 80 || workEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    throw Error('Enter a valid staff name and email.');
  }
  if (rows.some(other => other._id !== row._id && email(other.staffEmail) === workEmail)) {
    throw Error('This email is already registered.');
  }
  const status = upper(input.status);
  if (!['PENDING', 'ACTIVE', 'DISABLED'].includes(status)) throw Error('Invalid employee status.');
  const changedEmail = workEmail !== email(row.staffEmail);
  return { ...row, staffName: name, staffEmail: workEmail,
    staffStatus: changedEmail && status !== 'DISABLED' ? 'PENDING' : status,
    description: changedEmail ? '' : row.description,
    staffAccess: normalizeStaffAccess(input.access) };
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
