const { createHash } = require('node:crypto');

function newWebCustomerFields(enabled) {
  return enabled ? { quotationMode: 'WEB', webQuotationStatus: 'PENDING' } : {};
}

async function reserveWebCustomer(wixData, collection, record, options) {
  if (record.quotationMode !== 'WEB') return wixData.insert(collection, record, options);
  // Equal, normalized company names already represent a registration conflict.
  // A deterministic insert key also covers two submissions that both read before either inserts.
  const id = 'WEB-' + createHash('sha256').update(record.title).digest('hex').slice(0, 32);
  try {
    return await wixData.insert(collection, { ...record, _id: id }, options);
  } catch (error) {
    const saved = await wixData.get(collection, id, { ...options, consistentRead: true }).catch(() => null);
    if (!saved) throw error;
    const sameRegistration = ['title', 'primaryEmail', 'assignedStaffId', 'customerShortName', 'salesInitialGrantRevision']
      .every(field => saved[field] === record[field]);
    if (!sameRegistration) throw Error('This company already has a different registration.');
    return saved;
  }
}

async function activateWebRegistration({ customerRecord, userRecord, staff, wixData, confirmMasterInitialSalesAccess }) {
  const customerId = customerRecord.customerId;
  const result = (status, accessCreated) => ({
    customerId,
    companyName: customerRecord.title,
    customerShortName: customerRecord.customerShortName,
    assignedStaffId: customerRecord.assignedStaffId,
    quotationMode: 'WEB',
    webQuotationStatus: status,
    accessCreated
  });

  if (customerRecord.webQuotationStatus === 'READY') {
    if (userRecord.status !== 'ACTIVE' || customerRecord.lifecycleStatus !== 'ACTIVE' ||
        customerRecord.accessStatus !== 'ACTIVE') throw Error('This customer account requires admin review.');
    return { ok: true, result: result('READY', true) };
  }
  if (customerRecord.webQuotationStatus !== 'PENDING' || customerRecord.lifecycleStatus !== 'ACTIVE' ||
      customerRecord.accessStatus !== 'PENDING' || !['PENDING', 'ACTIVE'].includes(userRecord.status) ||
      !customerRecord.salesInitialGrantRevision || userRecord.customerId !== customerId) {
    throw Error('This registration cannot confirm its original LTPOS access request.');
  }
  const options = { suppressAuth: true };
  try {
    await confirmMasterInitialSalesAccess(staff.loginEmail, customerId, customerRecord.assignedStaffId,
      customerRecord.salesInitialGrantRevision);
    if (userRecord.status !== 'ACTIVE') {
      await wixData.update('WixCustomerUsers', { ...userRecord, status: 'ACTIVE' }, options);
    }
    // This is the final visibility gate, even if the user row was saved earlier.
    await wixData.update('WixCustomers', {
      ...customerRecord, customerStatus: 'REGISTERED', accessStatus: 'ACTIVE', webQuotationStatus: 'READY'
    }, options);
    return { ok: true, result: result('READY', true) };
  } catch (_) {
    // Retry via the original reservation. Do not undo a write whose receipt was lost.
    return { ok: false, retryable: true, error: 'Registration confirmation is pending. Retry the same registration.',
      result: result('PENDING', false) };
  }
}

function patchOnce(source, before, after) {
  const pieces = source.split(before);
  if (pieces.length !== 2) throw Error('Isolated source reference changed: ' + before.trim().slice(0, 90));
  return pieces.join(after);
}

function patchOnboarding(source) {
  // Preserve both original call sites. Only customers reserved in server-enabled WEB mode take the new path.
  const call = 'return provisionQuotationDesk({';
  const branches = source.split(call);
  if (branches.length !== 3) throw Error('Expected exactly two onboarding provisioning entry points.');
  source = branches.join('return (customerRecord.quotationMode === \'WEB\' ? provisionWebQuotation : provisionQuotationDesk)({');
  source = patchOnce(source, 'salesInitialGrantRevision: staff.grantRevision,',
    'salesInitialGrantRevision: staff.grantRevision,\n        ...newWebCustomerFields(webRegistrationEnabled),');
  source = patchOnce(source, 'customerRecord = await wixData.insert(CUSTOMER_COLLECTION, {',
    'customerRecord = await reserveWebCustomer(wixData, CUSTOMER_COLLECTION, {');
  return source + '\nfunction provisionWebQuotation(input) {\n' +
    '  return activateWebRegistration({ ...input, wixData, confirmMasterInitialSalesAccess });\n}\n';
}

module.exports = { activateWebRegistration, newWebCustomerFields, reserveWebCustomer, patchOnce, patchOnboarding };
