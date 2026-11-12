import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

const endpoint = 'https://fmcg999.wixstudio.com/master/_functions/staffAccess';

// Call only after authenticating the current FMCG member and checking their
// local member binding. Never pass an email from a browser message.
async function requestStaffAccess(loginEmail, action, customerId, verifiedFmcgEmail = false) {
  const secret = await getSecret('MASTER_STAFF_AUTH_SHARED_SECRET');
  if (!secret) throw Error('Staff authorization is unavailable.');
  const result = await fetch(endpoint, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
    body: JSON.stringify({ loginEmail, action, customerId, ...(verifiedFmcgEmail ? { verifiedFmcgEmail } : {}) })
  });
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

export function staffMayAccessCustomer(staff, action, customerId) {
  const id = String(customerId ?? '').trim();
  if (staff?.authorized !== true || !id || !scopeActions.includes(action)) return false;
  return staff.customerScope?.allCustomers === true ||
    staff.customerScope?.customerActions?.[action]?.includes(id) === true;
}

export function requireStaffCustomerAccess(staff, action, customerId) {
  if (!staffMayAccessCustomer(staff, action, customerId)) throw Error('You do not have permission for this customer action.');
}
