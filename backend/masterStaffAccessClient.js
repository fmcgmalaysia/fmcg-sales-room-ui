import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

const endpoint = 'https://fmcg999.wixstudio.com/master/_functions/staffAccess';

// Call only after authenticating the current FMCG member and checking their
// local member binding. Never pass an email from a browser message.
async function requestStaffAccess(loginEmail, action, customerId, verifiedFmcgEmail = false, assignment = {}) {
  const secret = await getSecret('MASTER_STAFF_AUTH_SHARED_SECRET');
  if (!secret) throw Error('Staff authorization is unavailable.');
  const result = await fetch(endpoint, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
    body: JSON.stringify({ ...assignment, loginEmail, action, customerId, ...(verifiedFmcgEmail ? { verifiedFmcgEmail } : {}) })
  });
  if (result.status === 409 && action === 'SALES_GRANT_INITIAL_ACCESS') {
    throw Error('Salesperson access changed during registration. Review the customer grant in LTPOS.');
  }
  if (!result.ok) throw Error('Staff authorization is unavailable.');
  return result.json();
}

export async function masterAllowsStaffAction(loginEmail, action, customerId) {
  return (await requestStaffAccess(loginEmail, action, customerId)).allowed === true;
}

const scopeActions = ['VIEW', 'ASSIST_SELECTION', 'SEND_ORDER_REQUEST', 'EDIT_REVIEW_QTY', 'SUBMIT_ORDER', 'EDIT_QUOTATION', 'PUBLISH_QUOTATION', 'MANAGE_CUSTOMER'];

export async function getMasterStaffScope(loginEmail, verifiedFmcgEmail = false) {
  const result = await requestStaffAccess(loginEmail, 'DIRECTORY_SCOPE', undefined, verifiedFmcgEmail);
  if (result.allowed !== true) return null;
  const scope = result.scope;
  if (!scope || typeof scope.allCustomers !== 'boolean' || !scope.customerActions ||
      scopeActions.some(action => !Array.isArray(scope.customerActions[action]) ||
        scope.customerActions[action].some(id => typeof id !== 'string' || !id.trim() || id.length > 160))) {
    throw Error('Staff authorization is incomplete.');
  }
  const customerScope = { allCustomers: scope.allCustomers, canCreateCustomers: scope.canCreateCustomers === true,
    customerActions: Object.fromEntries(scopeActions.map(action => [action, [...scope.customerActions[action]]])) };
  if (!verifiedFmcgEmail) return customerScope;
  const { staffId, staffName } = result.identity ?? {};
  if (typeof staffId !== 'string' || !staffId.trim() || typeof staffName !== 'string' || !staffName.trim()) {
    throw Error('Staff identity is incomplete.');
  }
  return { staffId, staffName, customerScope };
}

export async function getMasterSalesCreationAssignees(loginEmail) {
  const result = await requestStaffAccess(loginEmail, 'SALES_CREATION_ASSIGNEES');
  if (result.allowed !== true) return null;
  if (typeof result.mayAssignOthers !== 'boolean' || !Array.isArray(result.assignees) ||
      (!result.mayAssignOthers && result.assignees.length !== 1) ||
      result.assignees.some(row => typeof row?.staffId !== 'string' || !/^STF-[A-Z0-9]{5,20}$/.test(row.staffId) ||
        typeof row.staffName !== 'string' || !row.staffName.trim())) {
    throw Error('Salesperson assignment is unavailable.');
  }
  return { mayAssignOthers: result.mayAssignOthers, assignees: result.assignees };
}

export async function resolveMasterSalesCreationAssignee(loginEmail, targetStaffId) {
  const result = await requestStaffAccess(loginEmail, 'SALES_CREATION_ASSIGNEE', undefined, false, { targetStaffId });
  if (result.allowed !== true) return null;
  if (typeof result.owner?.staffId !== 'string' || !/^STF-[A-Z0-9]{5,20}$/.test(result.owner.staffId) ||
      (targetStaffId && result.owner.staffId !== targetStaffId) ||
      typeof result.owner.staffName !== 'string' || !result.owner.staffName.trim() ||
      typeof result.grantRevision !== 'string' || !/^[a-f0-9]{64}$/.test(result.grantRevision)) {
    throw Error('Salesperson assignment is unavailable.');
  }
  return { staffId: result.owner.staffId, staffName: result.owner.staffName, grantRevision: result.grantRevision };
}

export async function confirmMasterInitialSalesAccess(loginEmail, customerId, targetStaffId, grantRevision) {
  const result = await requestStaffAccess(loginEmail, 'SALES_GRANT_INITIAL_ACCESS', customerId, false, { targetStaffId, grantRevision });
  if (result.allowed !== true) throw Error('Initial customer access could not be confirmed in LTPOS.');
}

export function staffMayAccessCustomer(staff, action, customerId) {
  const id = String(customerId ?? '').trim();
  if (staff?.authorized !== true || !id || !scopeActions.includes(action)) return false;
  return staff.customerScope?.allCustomers === true ||
    staff.customerScope?.customerActions?.[action]?.includes(id) === true;
}

export function requireStaffCustomerAccess(staff, action, customerId) {
  if (!staffMayAccessCustomer(staff, action, customerId)) throw Error('You do not have permission for this customer action.');
}
