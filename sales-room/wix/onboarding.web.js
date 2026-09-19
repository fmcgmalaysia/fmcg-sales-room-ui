import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { fetch } from 'wix-fetch';import { request as httpsRequest } from 'https';
import { getSecret } from 'wix-secrets-backend';

const APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxv2gchSDxbWxMdycz04XOKH8ONhhET0UPGgHM_buD-4wqaXbcboi6hnj1tMbu3wihc/exec';
const SECRET_NAME = 'NCT_ONBOARDING_SHARED_SECRET';

const STAFF_COLLECTION = 'StaffMaster';
const CUSTOMER_COLLECTION = 'WixCustomers';
const CUSTOMER_USER_COLLECTION = 'WixCustomerUsers';

const PROFILE_AUDIT_COLLECTION = 'CustomerProfileAudit';
const USER_AUDIT_COLLECTION = 'CustomerUserAudit';
const ASSIGNMENT_AUDIT_COLLECTION = 'CustomerAssignmentAudit';

const BUSINESS_TYPES = Object.freeze([
  'WHOLESALE',
  'RETAIL',
  'E-COMMERCE',
  'SOURCING AGENT',
  'OTHERS'
]);
const CURRENCIES = Object.freeze(['USD', 'MYR', 'SGD', 'RMB', 'JPY']);

export const getAssignableSalesStaff = webMethod(
  Permissions.SiteMember,
  async () => {
    const context = await requireAuthorizedStaffContext();
    let query = wixData
      .query(STAFF_COLLECTION)
      .eq('status', 'ACTIVE')
      .limit(1000);

    if (!context.canViewAllCustomers) {
      query = query.eq('staffId', upper(context.staffId));
    }

    const result = await query.find({ suppressAuth: true });
    const staff = result.items
      .map((item) => ({
        staffId: upper(item.staffId),
        staffName: upper(item.title)
      }))
      .filter((item) => item.staffId && item.staffName)
      .sort((a, b) => a.staffName.localeCompare(b.staffName));

    return Object.freeze({ ok: true, staff });
  }
);

export const createSalesRoomCustomer = webMethod(
  Permissions.SiteMember,
  async (payload) => {
    const customer = normalizeAndValidate(payload || {});
    const staff = await resolveCustomerRouting(payload?.assignedStaffId);

    const existingAccess = await findCustomerUserByEmail(customer.picEmail);
    if (existingAccess) {
      return resumeExistingRegistration(existingAccess, customer, staff);
    }

    const duplicateCompany = await wixData
      .query(CUSTOMER_COLLECTION)
      .eq('title', customer.companyName)
      .limit(1)
      .find({ suppressAuth: true });

    if (duplicateCompany.items.length) {
      throw new Error('This company is already registered.');
    }

    const customerId = await generateUniqueCustomerId();
    const userId = 'USR-' + customerId + '-01';
    const now = new Date();

    let customerRecord = await wixData.insert(
      CUSTOMER_COLLECTION,
      {
        title: customer.companyName,
        customerId,
        country: customer.country,
        natureOfBusiness: customer.natureOfBusiness,
        picTitle: customer.picTitle,
        picName: customer.picName,
        mobileNo: customer.picMobile,
        whatsapp: customer.whatsapp,
        preferredCurrency: customer.preferredCurrency,
        destinationPortName: customer.destinationPort,
        assignedStaffId: staff.staffId,
        qdOwnerStaffId: staff.staffId,
        qdFileId: '',
        qdFileLabel: '',
        qdSheetName: 'WIX QUOTATION',
        qdSheetId: '',
        qdTemplateVersion: '',
        qdStatus: 'PENDING',
        customerStatus: 'REGISTERING',
        primaryEmail: customer.picEmail
      },
      { suppressAuth: true }
    );

    let userRecord;
    try {
      userRecord = await wixData.insert(
        CUSTOMER_USER_COLLECTION,
        {
          title: customer.picName,
          userId,
          customerId,
          mobileNo: customer.picMobile,
          status: 'PENDING',
          authorizedTime: now,
          email: customer.picEmail,
          primaryUser: true,
          failedLoginCount: 0
        },
        { suppressAuth: true }
      );
    } catch (error) {
      customerRecord = await updateCustomerState(
        customerRecord,
        'ERROR',
        'ACCESS RECORD ERROR'
      );
      throw new Error('Customer was reserved, but the access record could not be created: ' + safeMessage(error));
    }

    const auditActor = await requireAuthorizedStaffContext();
    await writeAuditChanges(
      ASSIGNMENT_AUDIT_COLLECTION,
      'INITIAL_ASSIGNMENT',
      customerId,
      customerId,
      [{
        fieldId: 'assignedStaffId',
        fieldLabel: 'ASSIGNED SALESPERSON',
        beforeValue: '',
        afterValue: staff.staffId
      }],
      auditActor
    );
    await writeAuditChanges(
      USER_AUDIT_COLLECTION,
      'CUSTOMER_USER_CREATED',
      customerId,
      userId,
      [
        { fieldId: 'title', fieldLabel: 'USER NAME', beforeValue: '', afterValue: userRecord.title },
        { fieldId: 'email', fieldLabel: 'USER EMAIL', beforeValue: '', afterValue: userRecord.email },
        { fieldId: 'mobileNo', fieldLabel: 'USER MOBILE NO', beforeValue: '', afterValue: userRecord.mobileNo }
      ],
      auditActor
    );

    return provisionQuotationDesk({
      customerRecord,
      userRecord,
      staff
    });
  }
);

export const verifySalesRoomCustomerQd = webMethod(
  Permissions.SiteMember,
  async (customerId) => {
    const staff = await requireAuthorizedStaffContext();
    let customerRecord = await findAuthorizedCustomer(customerId, staff);
    const qdFileId = normalize(customerRecord.qdFileId);
    if (!qdFileId) throw new Error('This customer has no Quotation Desk file.');

    const sharedSecret = await getSecret(SECRET_NAME);
    const response = await httpsFetchLike(APPS_SCRIPT_ENDPOINT, {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'VERIFY_QD',
        sharedSecret,
        customerId: normalize(customerRecord.customerId),
        assignedStaffId: upper(customerRecord.assignedStaffId),
        qdFileId
      })
    });
    const body = parseAppsScriptResponse(await response.text());
    if (!response.ok || !body.ok) {
      throw new Error(body.error || 'Quotation Desk activation verification failed.');
    }

    const qdStatus = upper(body.result?.qdStatus || 'ACTIVATION_REQUIRED');
    customerRecord = await updateCustomerState(
      customerRecord,
      qdStatus,
      qdStatus === 'READY' ? 'REGISTERED' : 'ACTIVATION REQUIRED',
      {
        qdFileId: normalize(body.result?.qdFileId || qdFileId),
        qdFileLabel: normalize(body.result?.qdFileName || customerRecord.qdFileLabel),
        qdSheetId: normalize(body.result?.qdSheetId || customerRecord.qdSheetId),
        qdSheetName: normalize(body.result?.qdSheetName || 'WIX QUOTATION'),
        qdTemplateVersion: normalize(body.result?.qdTemplateVersion || customerRecord.qdTemplateVersion),
        qdLastVerifiedAt: new Date()
      }
    );

    if (qdStatus === 'READY') {
      const users = await wixData.query(CUSTOMER_USER_COLLECTION)
        .eq('customerId', normalize(customerRecord.customerId))
        .limit(5)
        .find({ suppressAuth: true });
      for (const user of users.items) {
        if (upper(user.status) === 'PENDING') {
          await wixData.update(
            CUSTOMER_USER_COLLECTION,
            { ...user, status: 'ACTIVE', authorizedTime: user.authorizedTime || new Date() },
            { suppressAuth: true }
          );
        }
      }
    }

    return Object.freeze({
      ok: true,
      customerId: normalize(customerRecord.customerId),
      qdStatus,
      customerStatus: upper(customerRecord.customerStatus),
      qdFileId: normalize(customerRecord.qdFileId),
      qdFileLabel: normalize(customerRecord.qdFileLabel)
    });
  }
);


export const getSalesRoomCustomers = webMethod(
  Permissions.SiteMember,
  async () => {
    const staff = await requireAuthorizedStaffContext();
    let query = wixData.query(CUSTOMER_COLLECTION).limit(1000);

    if (!staff.canViewAllCustomers) {
      query = query.eq('assignedStaffId', upper(staff.staffId));
    }

    const customerResult = await query.find({ suppressAuth: true });
    const customerIds = new Set(
      customerResult.items.map((item) => normalize(item.customerId))
    );

    const userResult = await wixData
      .query(CUSTOMER_USER_COLLECTION)
      .limit(1000)
      .find({ suppressAuth: true });

    const activeUserCounts = new Map();
    for (const user of userResult.items) {
      const customerId = normalize(user.customerId);
      if (!customerIds.has(customerId) || upper(user.status) !== 'ACTIVE') {
        continue;
      }
      activeUserCounts.set(
        customerId,
        Number(activeUserCounts.get(customerId) || 0) + 1
      );
    }

    const customers = customerResult.items
      .map((item) => ({
        customerId: normalize(item.customerId),
        companyName: normalize(item.title),
        country: normalize(item.country),
        qdStatus: upper(item.qdStatus),
        customerStatus: upper(item.customerStatus),
        assignedStaffId: upper(item.assignedStaffId),
        accessUserCount: Number(
          activeUserCounts.get(normalize(item.customerId)) || 0
        ),
        updatedAt: item._updatedDate || item._createdDate || null
      }))
      .sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      });

    return Object.freeze({
      ok: true,
      summary: {
        customerCount: customers.length,
        qdReadyCount: customers.filter(
          (item) => item.qdStatus === 'READY'
        ).length
      },
      customers
    });
  }
);

export const getSalesRoomCustomerDetail = webMethod(
  Permissions.SiteMember,
  async (customerId) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff);

    const userResult = await wixData
      .query(CUSTOMER_USER_COLLECTION)
      .eq('customerId', normalize(customer.customerId))
      .limit(5)
      .find({ suppressAuth: true });

    return Object.freeze({
      ok: true,
      customer: {
        customerId: normalize(customer.customerId),
        companyName: normalize(customer.title),
        country: normalize(customer.country),
        natureOfBusiness: normalize(customer.natureOfBusiness),
        picTitle: normalize(customer.picTitle),
        picName: normalize(customer.picName),
        mobileNo: normalize(customer.mobileNo),
        whatsapp: upper(customer.whatsapp),
        preferredCurrency: upper(customer.preferredCurrency),
        destinationPortName: normalize(customer.destinationPortName),
        address1: normalize(customer.address1),
        address2: normalize(customer.address2),
        address3: normalize(customer.address3),
        primaryEmail: normalizeEmail(customer.primaryEmail),
        companyWebsite: normalize(customer.companyWebsite),
        assignedStaffId: upper(customer.assignedStaffId),
        qdOwnerStaffId: upper(customer.qdOwnerStaffId),
        qdFileId: normalize(customer.qdFileId),
        qdFileLabel: normalize(customer.qdFileLabel),
        qdSheetId: normalize(customer.qdSheetId),
        qdSheetName: normalize(customer.qdSheetName),
        qdTemplateVersion: normalize(customer.qdTemplateVersion),
        qdLastVerifiedAt: customer.qdLastVerifiedAt || null,
        qdStatus: upper(customer.qdStatus),
        customerStatus: upper(customer.customerStatus)
      },
      users: userResult.items
        .map((user) => ({
          userId: normalize(user.userId),
          userName: normalize(user.title),
          email: normalizeEmail(user.email),
          mobileNo: normalize(user.mobileNo),
          status: upper(user.status),
          primaryUser: Boolean(user.primaryUser),
          wixMemberId: normalize(user.wixMemberId)
        }))
        .sort((a, b) => a.userId.localeCompare(b.userId))
    });
  }
);


const LOCKED_CUSTOMER_FIELDS = Object.freeze([
  'customerId',
  'companyName',
  'title',
  'country',
  'assignedStaffId',
  'qdOwnerStaffId',
  'qdFileId',
  'qdFileLabel',
  'qdSheetId',
  'qdSheetName',
  'qdTemplateVersion',
  'qdStatus',
  'customerStatus'
]);

const EDITABLE_CUSTOMER_FIELDS = Object.freeze({
  natureOfBusiness: 'NATURE OF BUSINESS',
  picTitle: 'PERSON IN CHARGE TITLE',
  picName: 'PERSON IN CHARGE NAME',
  mobileNo: 'MOBILE NO',
  whatsapp: 'WHATSAPP',
  preferredCurrency: 'PREFERRED CURRENCY',
  destinationPortName: 'DESTINATION PORT',
  address1: 'ADDRESS LINE 1',
  address2: 'ADDRESS LINE 2',
  address3: 'ADDRESS LINE 3',
  primaryEmail: 'PRIMARY EMAIL',
  companyWebsite: 'COMPANY WEBSITE'
});

export const updateSalesRoomCustomerProfile = webMethod(
  Permissions.SiteMember,
  async (customerId, payload) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff);
    const input = payload && typeof payload === 'object' ? payload : {};

    for (const key of LOCKED_CUSTOMER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        throw new Error('COMPANY NAME, COUNTRY, CUSTOMER ID, assignment and QD routing are locked.');
      }
    }

    const patch = {};
    for (const key of Object.keys(EDITABLE_CUSTOMER_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        patch[key] = normalizeEditableCustomerValue(key, input[key]);
      }
    }

    const changes = Object.keys(patch)
      .filter((key) => auditValue(customer[key]) !== auditValue(patch[key]))
      .map((key) => ({
        fieldId: key,
        fieldLabel: EDITABLE_CUSTOMER_FIELDS[key],
        beforeValue: customer[key],
        afterValue: patch[key]
      }));

    if (!changes.length) {
      return Object.freeze({ ok: true, customerId: normalize(customer.customerId), changedFields: [] });
    }

    await wixData.update(
      CUSTOMER_COLLECTION,
      { ...customer, ...patch },
      { suppressAuth: true }
    );

    await writeAuditChanges(
      PROFILE_AUDIT_COLLECTION,
      'PROFILE_FIELD_UPDATED',
      normalize(customer.customerId),
      normalize(customer.customerId),
      changes,
      staff
    );

    return Object.freeze({
      ok: true,
      customerId: normalize(customer.customerId),
      changedFields: changes.map((item) => item.fieldId)
    });
  }
);

export const saveSalesRoomCustomerUser = webMethod(
  Permissions.SiteMember,
  async (customerId, slotNumber, payload) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff);
    const slot = Number(slotNumber);

    if (!Number.isInteger(slot) || slot < 1 || slot > 5) {
      throw new Error('USER slot must be between 1 and 5.');
    }

    const input = payload && typeof payload === 'object' ? payload : {};
    const email = normalizeEmail(input.email);
    const mobileNo = normalize(input.mobileNo);
    const userName = normalize(input.userName);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a valid USER email.');
    }
    if (mobileNo.replace(/\D/g, '').length < 4) {
      throw new Error('USER mobile number must contain at least 4 digits.');
    }

    const normalizedCustomerId = normalize(customer.customerId);
    const userId = 'USR-' + normalizedCustomerId + '-' + String(slot).padStart(2, '0');

    const existingResult = await wixData
      .query(CUSTOMER_USER_COLLECTION)
      .eq('userId', userId)
      .limit(2)
      .find({ suppressAuth: true });

    if (existingResult.items.length > 1) {
      throw new Error('Duplicate USER slot. Admin review is required.');
    }

    const emailResult = await wixData
      .query(CUSTOMER_USER_COLLECTION)
      .eq('email', email)
      .limit(2)
      .find({ suppressAuth: true });

    const existing = existingResult.items[0] || null;
    const emailConflict = emailResult.items.find((item) => !existing || item._id !== existing._id);
    if (emailConflict) {
      throw new Error('This email is already assigned to another customer user.');
    }

    const before = existing || {};
    const nextUser = {
      ...(existing || {}),
      title: userName,
      userId,
      customerId: normalizedCustomerId,
      email,
      mobileNo,
      primaryUser: slot === 1,
      status: existing ? upper(existing.status) || 'PENDING' : 'PENDING',
      authorizedTime: existing?.authorizedTime || new Date(),
      failedLoginCount: Number(existing?.failedLoginCount || 0)
    };

    const userRecord = existing
      ? await wixData.update(CUSTOMER_USER_COLLECTION, nextUser, { suppressAuth: true })
      : await wixData.insert(CUSTOMER_USER_COLLECTION, nextUser, { suppressAuth: true });

    const userFields = [
      ['title', 'USER NAME'],
      ['email', 'USER EMAIL'],
      ['mobileNo', 'USER MOBILE NO']
    ];
    const changes = userFields
      .filter(([key]) => auditValue(before[key]) !== auditValue(userRecord[key]))
      .map(([key, label]) => ({
        fieldId: key,
        fieldLabel: label,
        beforeValue: before[key],
        afterValue: userRecord[key]
      }));

    await writeAuditChanges(
      USER_AUDIT_COLLECTION,
      existing ? 'CUSTOMER_USER_UPDATED' : 'CUSTOMER_USER_CREATED',
      normalizedCustomerId,
      userId,
      changes,
      staff
    );

    return Object.freeze({
      ok: true,
      customerId: normalizedCustomerId,
      userId,
      slotNumber: slot,
      status: upper(userRecord.status),
      changedFields: changes.map((item) => item.fieldId)
    });
  }
);

export const getSalesRoomCustomerAudit = webMethod(
  Permissions.SiteMember,
  async (customerId) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff);
    const normalizedCustomerId = normalize(customer.customerId);
    const collections = [
      ['PROFILE', PROFILE_AUDIT_COLLECTION],
      ['USER', USER_AUDIT_COLLECTION],
      ['ASSIGNMENT', ASSIGNMENT_AUDIT_COLLECTION]
    ];

    const groups = await Promise.all(
      collections.map(async ([category, collectionId]) => {
        const result = await wixData
          .query(collectionId)
          .eq('customerId', normalizedCustomerId)
          .limit(100)
          .find({ suppressAuth: true });

        return result.items.map((item) => ({
          category,
          auditId: normalize(item.auditId),
          entityId: normalize(item.entityId),
          action: normalize(item.action),
          fieldId: normalize(item.fieldId),
          fieldLabel: normalize(item.fieldLabel),
          beforeValue: normalize(item.beforeValue),
          afterValue: normalize(item.afterValue),
          changedAt: normalize(item.changedAt),
          changedByStaffId: upper(item.changedByStaffId),
          changedByStaffName: normalize(item.changedByStaffName),
          changedByEmail: normalizeEmail(item.changedByEmail),
          changedByRole: upper(item.changedByRole)
        }));
      })
    );

    return Object.freeze({
      ok: true,
      customerId: normalizedCustomerId,
      items: groups.flat().sort((a, b) => b.changedAt.localeCompare(a.changedAt)).slice(0, 100)
    });
  }
);

function normalizeEditableCustomerValue(key, value) {
  if (key === 'natureOfBusiness') {
    const normalized = upper(value);
    if (!BUSINESS_TYPES.includes(normalized)) throw new Error('Invalid nature of business.');
    return normalized;
  }
  if (key === 'preferredCurrency') {
    const normalized = upper(value);
    if (!CURRENCIES.includes(normalized)) throw new Error('Invalid currency.');
    return normalized;
  }
  if (key === 'whatsapp') {
    const normalized = upper(value);
    if (!['YES', 'NO'].includes(normalized)) throw new Error('WHATSAPP must be YES or NO.');
    return normalized;
  }
  if (key === 'picTitle') {
    const normalized = upper(value);
    if (normalized && !['MR', 'MRS', 'MS', 'DR'].includes(normalized)) throw new Error('Invalid title.');
    return normalized;
  }
  if (key === 'primaryEmail') {
    const normalized = normalizeEmail(value);
    if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Invalid primary email.');
    return normalized;
  }
  if (key === 'mobileNo') {
    const normalized = normalize(value);
    if (normalized && normalized.replace(/\D/g, '').length < 4) throw new Error('Mobile number must contain at least 4 digits.');
    return normalized;
  }
  return normalize(value);
}

async function writeAuditChanges(collectionId, action, customerId, entityId, changes, staff) {
  if (!changes.length) return;

  const changedAt = new Date().toISOString();
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const auditId =
      'AUD-' +
      changedAt.replace(/\D/g, '').slice(0, 17) +
      '-' +
      String(index + 1).padStart(2, '0') +
      '-' +
      Math.random().toString(36).slice(2, 8).toUpperCase();

    await wixData.insert(
      collectionId,
      {
        title: auditId,
        auditId,
        customerId: normalize(customerId),
        entityId: normalize(entityId),
        action: normalize(action),
        fieldId: normalize(change.fieldId),
        fieldLabel: normalize(change.fieldLabel),
        beforeValue: auditValue(change.beforeValue),
        afterValue: auditValue(change.afterValue),
        changedAt,
        changedByStaffId: upper(staff.staffId),
        changedByStaffName: normalize(staff.staffName),
        changedByEmail: normalizeEmail(staff.loginEmail),
        changedByRole: upper(staff.role)
      },
      { suppressAuth: true }
    );
  }
}

function auditValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}


function memberEmail(member) {
  const firstContactEmail = member?.contactDetails?.emails?.[0];
  return normalizeEmail(
    member?.loginEmail ||
      (typeof firstContactEmail === 'string'
        ? firstContactEmail
        : firstContactEmail?.email)
  );
}

function deniedStaffContext(reason) {
  return Object.freeze({ authorized: false, reason });
}

async function resolveCurrentStaffContext() {
  let member;

  try {
    member = await currentMember.getMember({ fieldsets: ['FULL'] });
  } catch (error) {
    return deniedStaffContext('MEMBER_LOOKUP_ERROR');
  }

  if (!member) {
    return deniedStaffContext('NOT_LOGGED_IN');
  }

  const memberId = normalize(member._id);
  const email = memberEmail(member);

  if (!memberId) {
    return deniedStaffContext('MEMBER_ID_MISSING');
  }

  let items;
  try {
    const result = await wixData
      .query(STAFF_COLLECTION)
      .limit(1000)
      .find({ suppressAuth: true });
    items = result.items;
  } catch (error) {
    return deniedStaffContext('STAFF_CMS_QUERY_ERROR');
  }

  const memberIdMatches = items.filter(
    (item) => normalize(item.wixMemberId) === memberId
  );
  if (memberIdMatches.length > 1) {
    return deniedStaffContext('DUPLICATE_WIX_MEMBER_ID');
  }

  let staff = memberIdMatches[0];
  let identitySource = 'WIX_MEMBER_ID';

  if (!staff) {
    if (!email) {
      return deniedStaffContext('MEMBER_EMAIL_MISSING');
    }

    const emailMatches = items.filter(
      (item) => normalizeEmail(item.staffEmail) === email
    );
    if (emailMatches.length !== 1) {
      return deniedStaffContext(
        emailMatches.length > 1
          ? 'DUPLICATE_STAFF_EMAIL'
          : 'STAFF_NOT_REGISTERED'
      );
    }

    staff = emailMatches[0];
    identitySource = 'EMAIL_FALLBACK';

    const linkedMemberId = normalize(staff.wixMemberId);
    if (linkedMemberId && linkedMemberId !== memberId) {
      return deniedStaffContext('STAFF_MEMBER_MISMATCH');
    }

    if (!linkedMemberId) {
      try {
        staff = await wixData.update(
          STAFF_COLLECTION,
          { ...staff, wixMemberId: memberId },
          { suppressAuth: true }
        );
        identitySource = 'WIX_MEMBER_ID_LINKED';
      } catch (error) {
        return deniedStaffContext('MEMBER_LINK_FAILED');
      }
    }
  }

  const status = upper(staff.status);
  if (status !== 'ACTIVE') {
    return deniedStaffContext('STAFF_INACTIVE');
  }

  const role = upper(staff.role);
  const staffId = normalize(staff.staffId);
  const staffName = normalize(staff.title);
  const quotationDeskFileId = normalize(staff.quotationDeskFileId);

  if (!staffId || !staffName || !role) {
    return deniedStaffContext('STAFF_RECORD_INCOMPLETE');
  }

  return Object.freeze({
    authorized: true,
    staffId,
    staffName,
    loginEmail: email,
    role,
    quotationDeskFileId,
    identitySource,
    canViewAllCustomers: role === 'SUPER ADMIN' || role === 'ADMIN'
  });
}

async function requireAuthorizedStaffContext() {
  const context = await resolveCurrentStaffContext();
  if (!context?.authorized) {
    throw new Error('This member is not authorized in STAFF MASTER.');
  }
  return context;
}

async function findAuthorizedCustomer(customerId, staff) {
  const normalizedCustomerId = normalize(customerId);
  if (!normalizedCustomerId) {
    throw new Error('CUSTOMER ID is required.');
  }

  const result = await wixData
    .query(CUSTOMER_COLLECTION)
    .eq('customerId', normalizedCustomerId)
    .limit(2)
    .find({ suppressAuth: true });

  if (result.items.length !== 1) {
    throw new Error(
      result.items.length > 1
        ? 'Duplicate CUSTOMER ID. Admin review is required.'
        : 'Customer was not found.'
    );
  }

  const customer = result.items[0];
  if (
    !staff.canViewAllCustomers &&
    upper(customer.assignedStaffId) !== upper(staff.staffId)
  ) {
    throw new Error('This customer is assigned to another salesperson.');
  }

  return customer;
}

async function resolveCustomerRouting(requestedAssignedStaffId) {
  const context = await resolveCurrentStaffContext();
  if (!context?.authorized) {
    throw new Error('This member is not authorized in STAFF MASTER.');
  }

  const currentStaffId = upper(context.staffId);
  const requestedStaffId = upper(requestedAssignedStaffId);
  const canAssignCustomers = Boolean(context.canViewAllCustomers);
  const targetStaffId = canAssignCustomers
    ? requestedStaffId
    : currentStaffId;

  if (!targetStaffId) {
    throw new Error('Select an ACTIVE salesperson with a configured QD.');
  }
  if (
    !canAssignCustomers &&
    requestedStaffId &&
    requestedStaffId !== currentStaffId
  ) {
    throw new Error('Sales staff cannot assign a customer to another employee.');
  }

  const result = await wixData
    .query(STAFF_COLLECTION)
    .eq('staffId', targetStaffId)
    .eq('status', 'ACTIVE')
    .limit(2)
    .find({ suppressAuth: true });

  if (result.items.length !== 1) {
    throw new Error(
      result.items.length > 1
        ? 'Duplicate ACTIVE STAFF ID. Admin review is required.'
        : 'The assigned employee is not ACTIVE in STAFF MASTER.'
    );
  }

  const target = result.items[0];
  const staffName = upper(target.title);

  if (!staffName) {
    throw new Error('The assigned employee has no valid staff name.');
  }

  return Object.freeze({
    staffId: targetStaffId,
    staffName,
    assignedByStaffId: currentStaffId
  });
}

async function resumeExistingRegistration(existingAccess, customer, staff) {
  const customerResult = await wixData
    .query(CUSTOMER_COLLECTION)
    .eq('customerId', normalize(existingAccess.customerId))
    .limit(1)
    .find({ suppressAuth: true });

  if (!customerResult.items.length) {
    throw new Error('This email already has an access record without a customer record. Admin review is required.');
  }

  let customerRecord = customerResult.items[0];
  if (upper(customerRecord.title) !== customer.companyName) {
    throw new Error('This email is already authorized for another company.');
  }
  if (upper(customerRecord.assignedStaffId) !== staff.staffId) {
    throw new Error('This customer belongs to another salesperson.');
  }

  if (
    upper(customerRecord.qdStatus) === 'READY' &&
    upper(existingAccess.status) === 'ACTIVE'
  ) {
    return successResult(customerRecord, existingAccess, staff);
  }

  return provisionQuotationDesk({
    customerRecord,
    userRecord: existingAccess,
    staff
  });
}

function httpsFetchLike(url, options) { const send = (target, method, body) => new Promise((resolve, reject) => { const req = httpsRequest(target, { method, headers: options.headers || {} }, (res) => { let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers || {}, text })); }); req.on('error', reject); if (body) req.write(body); req.end(); }); return send(url, options.method || 'GET', options.body || '').then(async (first) => { let current = first; if ([301, 302, 303, 307, 308].includes(current.status)) { const location = normalize(current.headers.location); if (!location) throw new Error('QD redirect location is missing.'); current = await send(location, 'GET', ''); } return { status: current.status, ok: current.status >= 200 && current.status < 300, url: '', headers: { get: (name) => normalize(current.headers[String(name).toLowerCase()]) }, text: async () => current.text }; }); }
  async function provisionQuotationDesk({ customerRecord, userRecord, staff }) { const routingPayload = {
    customerId: normalize(customerRecord.customerId),
    assignedStaffId: upper(customerRecord.assignedStaffId),
    companyName: upper(customerRecord.title),
    currency: upper(customerRecord.preferredCurrency)
  };

  if (!routingPayload.companyName || !routingPayload.currency) {
    throw new Error('Customer QD creation data is incomplete.');
  }

  try {
    const sharedSecret = await getSecret(SECRET_NAME);
    let response = await httpsFetchLike(APPS_SCRIPT_ENDPOINT, {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },      // @ts-ignore Wix runtime passes this option to backend fetch.
      body: JSON.stringify({
        ...routingPayload,
        sharedSecret
      })
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) { const redirectUrl = normalize(response.headers?.get?.('location')); if (!redirectUrl) throw new Error('QD redirect location is missing.'); response = await fetch(redirectUrl, { method: 'get' }); } const responseText = await response.text(); let body; try { body  = parseAppsScriptResponse(responseText); } catch (_) { throw new Error('QD response ' + response.status + ' · ' + normalize(response.headers?.get?.('content-type')) + ' · ' + normalize(responseText).slice(0, 180)); }
    if (!response.ok || !body.ok) {
      throw new Error(body.error || 'Quotation Desk creation failed.');
    }

    const returnedStatus = upper(body.result?.qdStatus || 'ACTIVATION_REQUIRED');
    customerRecord = await updateCustomerState(
      customerRecord,
      returnedStatus,
      returnedStatus === 'READY' ? 'REGISTERED' : 'ACTIVATION REQUIRED',
      {
        qdOwnerStaffId: upper(customerRecord.qdOwnerStaffId || staff.staffId),
        qdFileId: normalize(body.result?.qdFileId || customerRecord.qdFileId),
        qdFileLabel: normalize(
          body.result?.qdFileName || customerRecord.qdFileLabel
        ),
        qdSheetId: normalize(body.result?.qdSheetId || customerRecord.qdSheetId),
        qdSheetName: normalize(
          body.result?.qdSheetName || customerRecord.qdSheetName
        ),
        qdTemplateVersion: normalize(body.result?.qdTemplateVersion || customerRecord.qdTemplateVersion),
        qdLastVerifiedAt: new Date()
      }
    );
    if (returnedStatus === 'READY') {
      userRecord = await wixData.update(
        CUSTOMER_USER_COLLECTION,
        {
          ...userRecord,
          status: 'ACTIVE',
          authorizedTime: userRecord.authorizedTime || new Date(),
          failedLoginCount: Number(userRecord.failedLoginCount || 0)
        },
        { suppressAuth: true }
      );
    }

    return successResult(customerRecord, userRecord, staff, body.result);
  } catch (error) {
    customerRecord = await updateCustomerState(
      customerRecord,
      'ERROR',
      'REGISTRATION ERROR'
    );

    if (upper(userRecord.status) !== 'PENDING') {
      userRecord = await wixData.update(
        CUSTOMER_USER_COLLECTION,
        {
          ...userRecord,
          status: 'PENDING'
        },
        { suppressAuth: true }
      );
    }

    return {
      ok: false,
      retryable: true,
      error: safeMessage(error),
      result: {
        customerId: customerRecord.customerId,
        qdFileId: customerRecord.qdFileId,
        qdStatus: customerRecord.qdStatus,
        customerStatus: customerRecord.customerStatus,
        assignedStaffId: staff.staffId,
        wixCustomerRecordId: customerRecord._id,
        wixCustomerUserRecordId: userRecord._id,
        accessCreated: false
      }
    };
  }
}

async function updateCustomerState(
  record,
  qdStatus,
  customerStatus,
  routingPatch = {}
) {
  return wixData.update(
    CUSTOMER_COLLECTION,
    {
      ...record,
      ...routingPatch,
      qdStatus,
      customerStatus
    },
    { suppressAuth: true }
  );
}

function successResult(customerRecord, userRecord, staff, qdResult = {}) {
  return {
    ok: true,
    result: {
      ...qdResult,
      customerId: customerRecord.customerId,
      qdSheetName: customerRecord.qdSheetName,
      qdStatus: customerRecord.qdStatus,
      customerStatus: customerRecord.customerStatus,
      assignedStaffId: staff.staffId,
      wixCustomerRecordId: customerRecord._id,
      wixCustomerUserRecordId: userRecord._id,
      accessCreated: upper(userRecord.status) === 'ACTIVE'
    }
  };
}

async function findCustomerUserByEmail(email) {
  const result = await wixData
    .query(CUSTOMER_USER_COLLECTION)
    .eq('email', email)
    .limit(2)
    .find({ suppressAuth: true });

  if (result.items.length > 1) {
    throw new Error('Duplicate customer access email. Admin review is required.');
  }
  return result.items[0] || null;
}

async function generateUniqueCustomerId() {
  const dateParts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const dateMap = Object.fromEntries(
    dateParts.map((part) => [part.type, part.value])
  );
  const datePart = dateMap.year + dateMap.month + dateMap.day;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const entropy = (
      Date.now().toString(16) +
      Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0')
    ).slice(-6).toUpperCase();
    const customerId = 'CUS-' + datePart + '-' + entropy;
    const duplicate = await wixData
      .query(CUSTOMER_COLLECTION)
      .eq('customerId', customerId)
      .limit(1)
      .find({ suppressAuth: true });

    if (!duplicate.items.length) return customerId;
  }

  throw new Error('Unable to generate a unique CUSTOMER ID. Please retry.');
}

function parseAppsScriptResponse(text) {
  const cleaned = String(text || '').replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const withoutHtml = cleaned.replace(/<[^>]*>/g, '').trim();
    try {
      return JSON.parse(withoutHtml);
    } catch (error) {
      throw new Error('Quotation Desk service returned an invalid response.');
    }
  }
}

function normalizeAndValidate(raw) {
  const p = {
    companyName: upper(raw.companyName),
    country: upper(raw.country),
    natureOfBusiness: upper(raw.natureOfBusiness),
    picTitle: upper(raw.picTitle),
    picName: upper(raw.picName),
    picEmail: normalizeEmail(raw.picEmail),
    picMobile: normalize(raw.picMobile),
    whatsapp: upper(raw.whatsapp),
    preferredCurrency: upper(raw.preferredCurrency),
    destinationPort: upper(raw.destinationPort)
  };

  for (const [key, value] of Object.entries(p)) {
    if (!value) throw new Error('Required field missing: ' + key);
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.picEmail)) {
    throw new Error('Invalid email.');
  }
  if (!BUSINESS_TYPES.includes(p.natureOfBusiness)) {
    throw new Error('Invalid business type.');
  }
  if (!['MR', 'MS'].includes(p.picTitle)) {
    throw new Error('Invalid PIC title.');
  }
  if (!['YES', 'NO'].includes(p.whatsapp)) {
    throw new Error('Invalid WhatsApp selection.');
  }
  if (!CURRENCIES.includes(p.preferredCurrency)) {
    throw new Error('Invalid currency.');
  }
  if (p.picMobile.replace(/\D/g, '').length < 4) {
    throw new Error('Mobile number must contain at least 4 digits.');
  }

  return Object.freeze(p);
}


function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return normalize(value).toLowerCase();
}

function upper(value) {
  return normalize(value).toUpperCase();
}

function safeMessage(error) {
  return normalize(error?.message || error || 'Unknown onboarding error.');
}




const SALES_ACTIVITY_ACTIONS = Object.freeze([
  'SALES_ROOM_ENTER',
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'QD_OPENED'
]);

function malaysiaDayWindow(dayOffset = 0) {
  const malaysiaOffsetMs = 8 * 60 * 60 * 1000;
  const localNow = new Date(Date.now() + malaysiaOffsetMs);
  const startLocalMs = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate() - Math.max(0, Number(dayOffset) || 0)
  );
  return Object.freeze({
    start: new Date(startLocalMs - malaysiaOffsetMs).toISOString(),
    end: new Date(startLocalMs + (24 * 60 * 60 * 1000) - malaysiaOffsetMs).toISOString()
  });
}

async function resolveActivityCustomer(customerId, staff) {
  const normalizedCustomerId = normalize(customerId);
  if (!normalizedCustomerId) return null;

  const result = await wixData.query(CUSTOMER_COLLECTION)
    .eq('customerId', normalizedCustomerId)
    .limit(1)
    .find({ suppressAuth: true });
  const customer = result.items[0];
  if (!customer) throw new Error('Customer record was not found.');
  if (!staff.canViewAllCustomers && upper(customer.assignedStaffId) !== upper(staff.staffId)) {
    throw new Error('This customer is not assigned to the current staff member.');
  }
  return customer;
}

async function hasRecentSalesActivity(action, staffId, customerId, seconds) {
  const cutoff = new Date(Date.now() - (seconds * 1000)).toISOString();
  let query = wixData.query(PROFILE_AUDIT_COLLECTION)
    .eq('action', action)
    .eq('changedByStaffId', upper(staffId))
    .ge('changedAt', cutoff)
    .limit(1);
  if (normalize(customerId)) query = query.eq('customerId', normalize(customerId));
  const result = await query.find({ suppressAuth: true });
  return result.items.length > 0;
}

export const recordSalesRoomActivity = webMethod(
  Permissions.SiteMember,
  async (payload) => {
    const staff = await requireAuthorizedStaffContext();
    const action = upper(payload?.action);
    if (!SALES_ACTIVITY_ACTIONS.includes(action)) throw new Error('Unsupported sales activity.');

    const customer = await resolveActivityCustomer(payload?.customerId, staff);
    if (action !== 'SALES_ROOM_ENTER' && !customer) throw new Error('Customer is required for this activity.');

    const customerId = customer ? normalize(customer.customerId) : '';
    const dedupeSeconds = action === 'SALES_ROOM_ENTER' ? 1800 : (action === 'QD_OPENED' ? 60 : 10);
    if (await hasRecentSalesActivity(action, staff.staffId, customerId, dedupeSeconds)) {
      return Object.freeze({ ok: true, deduplicated: true });
    }

    const changedAt = new Date().toISOString();
    const auditId = 'ACT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const customerName = customer ? normalize(customer.companyName || customer.title || customer.customerId) : '';
    const detail = action === 'SALES_ROOM_ENTER'
      ? 'Entered Sales Room'
      : action === 'CUSTOMER_CREATED'
        ? 'Created customer: ' + customerName
        : action === 'CUSTOMER_UPDATED'
          ? 'Updated customer: ' + customerName
          : 'Opened quotation desk: ' + customerName;

    await wixData.insert(
      PROFILE_AUDIT_COLLECTION,
      {
        title: detail,
        auditId,
        customerId,
        entityId: customer ? normalize(customer.qdFileId || customer.customerId) : upper(staff.staffId),
        action,
        fieldId: '',
        fieldLabel: normalize(payload?.fieldLabel || detail),
        beforeValue: '',
        afterValue: customerName,
        changedAt,
        changedByStaffId: upper(staff.staffId),
        changedByStaffName: normalize(staff.staffName || staff.name || staff.staffId),
        changedByEmail: normalizeEmail(staff.loginEmail || staff.email),
        changedByRole: upper(staff.role)
      },
      { suppressAuth: true }
    );

    return Object.freeze({ ok: true, deduplicated: false, changedAt });
  }
);

export const getSalesRoomActivityForAdmin = webMethod(
  Permissions.SiteMember,
  async (dayOffset = 0) => {
    const staff = await requireAuthorizedStaffContext();
    if (!staff.canViewAllCustomers) throw new Error('Admin access is required.');

    const window = malaysiaDayWindow(dayOffset);
    const [activityResult, staffResult] = await Promise.all([
      wixData.query(PROFILE_AUDIT_COLLECTION)
        .ge('changedAt', window.start)
        .lt('changedAt', window.end)
        .descending('changedAt')
        .limit(1000)
        .find({ suppressAuth: true }),
      wixData.query(STAFF_COLLECTION)
        .eq('status', 'ACTIVE')
        .ascending('staffName')
        .limit(1000)
        .find({ suppressAuth: true })
    ]);

    const events = activityResult.items
      .filter((item) => SALES_ACTIVITY_ACTIONS.includes(upper(item.action)))
      .map((item) => Object.freeze({
        auditId: normalize(item.auditId || item._id),
        action: upper(item.action),
        customerId: normalize(item.customerId),
        customerName: normalize(item.afterValue),
        detail: normalize(item.fieldLabel || item.title),
        changedAt: normalize(item.changedAt),
        staffId: upper(item.changedByStaffId),
        staffName: normalize(item.changedByStaffName),
        staffEmail: normalizeEmail(item.changedByEmail)
      }));

    const summaries = staffResult.items.map((item) => {
      const staffId = upper(item.staffId);
      const ownEvents = events.filter((event) => event.staffId === staffId);
      return Object.freeze({
        staffId,
        staffName: normalize(item.staffName || item.name || item.staffId),
        email: normalizeEmail(item.loginEmail || item.email),
        activityCount: ownEvents.length,
        lastActivityAt: ownEvents.length ? ownEvents[0].changedAt : '',
        activeToday: ownEvents.length > 0
      });
    });

    return Object.freeze({ ok: true, window, summaries, events });
  }
);


