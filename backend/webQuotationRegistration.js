import { createHash } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { confirmMasterInitialSalesAccess } from 'backend/masterStaffAccessClient.js';
import { isWebQuotationReady } from 'backend/webQuotationCustomer.js';
import { prepareActivatedBuyerMember } from 'backend/buyerMemberProvisioning.js';
import { linkedAccessId } from 'backend/buyerCompanyAccess.js';

const write = { suppressAuth: true };
const read = { ...write, consistentRead: true };
const customers = 'WixCustomers';
const users = 'WixCustomerUsers';

export async function webQuotationRegistrationEnabled() {
  try { return await getSecret('MASTER_WEB_QUOTATION_ONBOARDING') === 'ENABLED'; }
  catch { return false; }
}

export async function reserveWebQuotationCustomer(record, linkedLogin) {
  const id = 'WEB-' + createHash('sha256').update(record.title).digest('hex').slice(0, 32);
  try { return await wixData.insert(customers, { ...record, _id: id }, write); }
  catch (error) {
    const saved = await wixData.get(customers, id, read).catch(() => null);
    if (!saved) throw error;
    const same = ['title', 'primaryEmail', 'assignedStaffId', 'customerShortName', 'quotationMode']
      .every(field => saved[field] === record[field]);
    const expectedPrimary = linkedLogin ? linkedAccessId(saved.customerId, linkedLogin._id) : record.primaryUserId;
    if (!same || (saved.primaryUserId || '') !== (expectedPrimary || '')) {
      throw Error('This company already has a different registration.');
    }
    return saved;
  }
}

export async function reserveWebQuotationPrimaryUser(user) {
  const id = 'WEB-' + createHash('sha256').update(user.email).digest('hex').slice(0, 32);
  try { return await wixData.insert(users, { ...user, _id: id }, write); }
  catch (error) {
    const saved = await wixData.get(users, id, read).catch(() => null);
    if (!saved) throw error;
    if (!saved.primaryUser || saved.customerId !== user.customerId || saved.userId !== user.userId || saved.email !== user.email) {
      throw Error('The original customer access reservation could not be confirmed.');
    }
    return saved;
  }
}

function matchesInitialUser(user, customer, linkedLogin) {
  if (user?.customerId !== customer.customerId || !user.primaryUser ||
      !['ACTIVE', 'PENDING'].includes(user.status)) return false;
  if (!linkedLogin) return user.email === customer.primaryEmail;
  return user.userId === customer.primaryUserId && user._id === customer.primaryUserId &&
    user.linkedLoginId === linkedLogin._id && user.linkedLoginEmail === customer.primaryEmail &&
    !user.email && !user.wixMemberId;
}

export async function reserveLinkedRegistrationPrimary(customer, login) {
  const id = customer.primaryUserId;
  if (id !== linkedAccessId(customer.customerId, login._id) || customer.primaryEmail !== login.email ||
      customer.customerId === login.customerId) throw Error('The original company link could not be confirmed.');
  const saved = await wixData.get(users, id, read).catch(() => null);
  if (saved) {
    if (!matchesInitialUser(saved, customer, login)) throw Error('The original company link could not be confirmed.');
    return saved;
  }
  if (customer.webQuotationStatus !== 'PENDING' || customer.accessStatus !== 'PENDING') {
    throw Error('This customer registration requires admin review.');
  }
  try {
    return await wixData.insert(users, {
      _id: id, userId: id, customerId: customer.customerId, title: customer.picName,
      mobileNo: customer.mobileNo, status: 'PENDING', authorizedTime: new Date(),
      primaryUser: true, linkedLoginId: login._id, linkedLoginEmail: customer.primaryEmail
    }, write);
  } catch (error) {
    const current = await wixData.get(users, id, read);
    if (!matchesInitialUser(current, customer, login)) throw error;
    return current;
  }
}

export async function activateWebQuotationCustomer({ customerRecord, userRecord, staff, linkedLogin }) {
  const { customerId, assignedStaffId, customerShortName, title, salesInitialGrantRevision } = customerRecord;
  const result = async (customer, user) => {
    const membership = linkedLogin ? 'READY' : await prepareActivatedBuyerMember(customer, user);
    const details = { customerId, assignedStaffId, customerShortName, companyName: title, quotationMode: 'WEB',
      webQuotationStatus: customer.webQuotationStatus, customerStatus: customer.customerStatus,
      wixCustomerRecordId: customer._id, wixCustomerUserRecordId: user._id, accessCreated: user.status === 'ACTIVE' };
    if (membership === 'READY') return { ok: true, result: details };
    const retryable = membership === 'RETRY';
    return { ok: false, retryable, result: details, error: retryable
      ? 'Customer access is active. The company login is pending. Retry the same registration to finish opening it.'
      : 'Customer access is active. The company login needs review. Please contact your administrator.' };
  };
  if (!matchesInitialUser(userRecord, customerRecord, linkedLogin) || assignedStaffId !== staff.staffId) {
    throw Error('This customer registration requires admin review.');
  }
  if (isWebQuotationReady(customerRecord) && userRecord.status === 'ACTIVE') return result(customerRecord, userRecord);
  if (customerRecord.quotationMode !== 'WEB' || customerRecord.webQuotationStatus !== 'PENDING' ||
      customerRecord.lifecycleStatus !== 'ACTIVE' || customerRecord.accessStatus !== 'PENDING' ||
      !/^[a-f0-9]{64}$/.test(salesInitialGrantRevision || '')) throw Error('This customer registration requires review.');

  try {
    await confirmMasterInitialSalesAccess(staff.loginEmail, customerId, assignedStaffId, salesInitialGrantRevision);
    const currentUser = await wixData.get(users, userRecord._id, read);
    const sameUser = linkedLogin ? matchesInitialUser(currentUser, customerRecord, linkedLogin) :
      currentUser?.customerId === customerId && currentUser.email === customerRecord.primaryEmail &&
      ['ACTIVE', 'PENDING'].includes(currentUser.status);
    if (!sameUser) throw Error('Customer user changed.');
    const user = currentUser.status === 'ACTIVE' ? currentUser : await wixData.update(users, { ...currentUser, status: 'ACTIVE' }, write);
    const current = await wixData.get(customers, customerRecord._id, read);
    if (isWebQuotationReady(current) && current?.customerId === customerId && current.assignedStaffId === assignedStaffId &&
        (!linkedLogin || matchesInitialUser(user, current, linkedLogin))) return result(current, user);
    if (current?.customerId !== customerId || current.assignedStaffId !== assignedStaffId || current.lifecycleStatus !== 'ACTIVE' ||
        current.accessStatus !== 'PENDING' || current.webQuotationStatus !== 'PENDING' ||
        (linkedLogin ? !matchesInitialUser(user, current, linkedLogin) : current.primaryEmail !== user.email)) {
      throw Error('Customer changed before activation.');
    }
    const customer = await wixData.update(customers, { ...current, webQuotationStatus: 'READY', customerStatus: 'REGISTERED', accessStatus: 'ACTIVE' }, write);
    if (!isWebQuotationReady(customer)) throw Error('Customer activation was not confirmed.');
    return result(customer, user);
  } catch {
    return { ok: false, retryable: true, error: 'Registration confirmation is pending. Retry the same registration.',
      result: { customerId, quotationMode: 'WEB', webQuotationStatus: 'PENDING' } };
  }
}
