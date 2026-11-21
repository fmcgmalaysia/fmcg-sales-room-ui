import { createHash } from 'crypto';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { confirmMasterInitialSalesAccess } from 'backend/masterStaffAccessClient.js';
import { isWebQuotationReady } from 'backend/webQuotationCustomer.js';
import { prepareActivatedBuyerMember } from 'backend/buyerMemberProvisioning.js';

const write = { suppressAuth: true };
const read = { ...write, consistentRead: true };
const customers = 'WixCustomers';
const users = 'WixCustomerUsers';

export async function webQuotationRegistrationEnabled() {
  try { return await getSecret('MASTER_WEB_QUOTATION_ONBOARDING') === 'ENABLED'; }
  catch { return false; }
}

export async function reserveWebQuotationCustomer(record) {
  const id = 'WEB-' + createHash('sha256').update(record.title).digest('hex').slice(0, 32);
  try { return await wixData.insert(customers, { ...record, _id: id }, write); }
  catch (error) {
    const saved = await wixData.get(customers, id, read).catch(() => null);
    if (!saved) throw error;
    const same = ['title', 'primaryEmail', 'assignedStaffId', 'customerShortName', 'quotationMode']
      .every(field => saved[field] === record[field]);
    if (!same) throw Error('This company already has a different registration.');
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

export async function activateWebQuotationCustomer({ customerRecord, userRecord, staff }) {
  const { customerId, assignedStaffId, customerShortName, title, salesInitialGrantRevision } = customerRecord;
  const result = async (customer, user) => {
    const membership = await prepareActivatedBuyerMember(customer, user);
    const details = { customerId, assignedStaffId, customerShortName, companyName: title, quotationMode: 'WEB',
      webQuotationStatus: customer.webQuotationStatus, customerStatus: customer.customerStatus,
      wixCustomerRecordId: customer._id, wixCustomerUserRecordId: user._id, accessCreated: user.status === 'ACTIVE' };
    if (membership === 'READY') return { ok: true, result: details };
    const retryable = membership === 'RETRY';
    return { ok: false, retryable, result: details, error: retryable
      ? 'Customer access is active. The company login is pending. Retry the same registration to finish opening it.'
      : 'Customer access is active. The company login needs review. Please contact your administrator.' };
  };
  if (userRecord.customerId !== customerId || !userRecord.primaryUser || userRecord.email !== customerRecord.primaryEmail ||
      assignedStaffId !== staff.staffId || !['ACTIVE', 'PENDING'].includes(userRecord.status)) {
    throw Error('This customer registration requires admin review.');
  }
  if (isWebQuotationReady(customerRecord) && userRecord.status === 'ACTIVE') return result(customerRecord, userRecord);
  if (customerRecord.quotationMode !== 'WEB' || customerRecord.webQuotationStatus !== 'PENDING' ||
      customerRecord.lifecycleStatus !== 'ACTIVE' || customerRecord.accessStatus !== 'PENDING' ||
      !/^[a-f0-9]{64}$/.test(salesInitialGrantRevision || '')) throw Error('This customer registration requires review.');

  try {
    await confirmMasterInitialSalesAccess(staff.loginEmail, customerId, assignedStaffId, salesInitialGrantRevision);
    const currentUser = await wixData.get(users, userRecord._id, read);
    if (currentUser?.customerId !== customerId || currentUser.email !== customerRecord.primaryEmail ||
        !['ACTIVE', 'PENDING'].includes(currentUser.status)) throw Error('Customer user changed.');
    const user = currentUser.status === 'ACTIVE' ? currentUser : await wixData.update(users, { ...currentUser, status: 'ACTIVE' }, write);
    const current = await wixData.get(customers, customerRecord._id, read);
    if (isWebQuotationReady(current) && current?.customerId === customerId && current.assignedStaffId === assignedStaffId) return result(current, user);
    if (current?.customerId !== customerId || current.assignedStaffId !== assignedStaffId || current.lifecycleStatus !== 'ACTIVE' ||
        current.accessStatus !== 'PENDING' || current.webQuotationStatus !== 'PENDING' || current.primaryEmail !== user.email) {
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
