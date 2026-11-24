import { requestMasterFulfilment } from 'backend/masterFulfilmentClient.js';
import { withMasterQuantities } from 'backend/masterQuantityClient.js';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { createHash } from 'crypto';
import wixData from 'wix-data';
import { fetch } from 'wix-fetch';
import wixRealtimeBackend from 'wix-realtime-backend';
import { submitNctSalesOrder } from 'backend/nctSalesIntake.js';
import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import { requireStaffCustomerAccess, staffMayAccessCustomer, getMasterSalesCreationAssignees, resolveMasterSalesCreationAssignee } from 'backend/masterStaffAccessClient.js';
import { reserveWebQuotationCustomer, reserveWebQuotationPrimaryUser, reserveLinkedRegistrationPrimary, activateWebQuotationCustomer } from 'backend/webQuotationRegistration.js';
import { companyUserEmail, findCompanyLogin, linkedAccessId, saveLinkedCompanyUser } from 'backend/buyerCompanyAccess.js';
import { hasApprovedBuyerMember } from 'backend/buyerMemberProvisioning.js';
import { isWebQuotationCustomer, isWebQuotationReady } from 'backend/webQuotationCustomer.js';
import { applyWebQuotations } from 'backend/masterWebQuotationData.js';


const STAFF_COLLECTION = 'StaffMaster';
const CUSTOMER_COLLECTION = 'WixCustomers';
const CUSTOMER_USER_COLLECTION = 'WixCustomerUsers';

const PROFILE_AUDIT_COLLECTION = 'CustomerProfileAudit';
const USER_AUDIT_COLLECTION = 'CustomerUserAudit';
const ASSIGNMENT_AUDIT_COLLECTION = 'CustomerAssignmentAudit';
const BUYER_LIST_COLLECTION = 'WixBuyerListItems';
const BUYER_ORDER_COLLECTION = 'WixBuyerOrders';
const BUYER_LINE_COLLECTION = 'WixBuyerOrderLines';
const BUYER_ORDER_AUDIT_COLLECTION = 'WixOrderAudit';
const ACCOUNT_NOTIFICATION_COLLECTION = 'WixAccountNotifications';

const BUSINESS_TYPES = Object.freeze([
  'WHOLESALE',
  'RETAIL',
  'E-COMMERCE',
  'SOURCING AGENT',
  'OTHERS'
]);
const CURRENCIES = Object.freeze(['USD', 'MYR', 'SGD', 'RMB', 'JPY']);

export const getAssignableSalesStaff = webMethod(Permissions.SiteMember, async () => {
  const context = await requireAuthorizedStaffContext();
  const routing = await getMasterSalesCreationAssignees(context.loginEmail);
  const staff = routing?.assignees ?? [];
  const mayAssignOthers = routing?.mayAssignOthers === true;
  return Object.freeze({ ok: true, staff, canCreate: mayAssignOthers || staff.length > 0,
    mayAssignOthers, quotationMode: 'WEB' });
});

export const createSalesRoomCustomer = webMethod(
  Permissions.SiteMember,
  async (payload) => {
    const customer = normalizeAndValidate(payload || {});
    const staff = await resolveCustomerRouting(payload?.assignedStaffId);

    const linkRequested = payload?.linkExistingLogin === 'yes';
    const existingAccess = linkRequested ? await findCompanyLogin(customer.picEmail) : await findCustomerUserByEmail(customer.picEmail);
    if (existingAccess && !linkRequested) {
      return resumeExistingRegistration(existingAccess, customer, staff);
    }
    if (linkRequested && (!existingAccess?._id || existingAccess.linkedLoginId ||
        upper(existingAccess.status) !== 'ACTIVE' || !(await hasApprovedBuyerMember(existingAccess)))) {
      return { ok: false, error: 'Confirm an active, approved Buyer Room login before linking this company.' };
    }
    const linkedLogin = linkRequested ? existingAccess : null;

    const duplicateCompany = await wixData
      .query(CUSTOMER_COLLECTION)
      .eq('title', customer.companyName)
      .limit(2)
      .find({ suppressAuth: true, consistentRead: true });
    const prior = duplicateCompany.items.length === 1 && duplicateCompany.items[0];
    if (linkedLogin && prior?.customerId === linkedLogin.customerId) {
      return resumeExistingRegistration(linkedLogin, customer, staff);
    }
    const sameRegistration = prior && isWebQuotationCustomer(prior) && /^[a-f0-9]{64}$/.test(prior.salesInitialGrantRevision || '') &&
      prior.assignedStaffId === staff.staffId && prior.primaryEmail === customer.picEmail &&
      prior.customerShortName === customer.customerShortName;
    const sameLinkedPrimary = linkedLogin && sameRegistration &&
      prior.primaryUserId === linkedAccessId(prior.customerId, linkedLogin._id);
    const resume = sameRegistration && (linkedLogin ? sameLinkedPrimary : !prior.primaryUserId?.startsWith('LINK-')) &&
      ['REGISTERING', 'ACCESS RECORD ERROR'].includes(upper(prior.customerStatus)) &&
      (!linkedLogin || prior.accessStatus === 'PENDING');
    if (sameLinkedPrimary && isWebQuotationReady(prior)) {
      const userRecord = await reserveLinkedRegistrationPrimary(prior, linkedLogin);
      return activateWebQuotationCustomer({ customerRecord: prior, userRecord, staff, linkedLogin });
    }
    if (duplicateCompany.items.length && !resume) {
      throw new Error('This company is already registered.');
    }

    const duplicateShortName = await wixData
      .query(CUSTOMER_COLLECTION)
      .eq('customerShortName', customer.customerShortName)
      .limit(1)
      .find({ suppressAuth: true });

    if (duplicateShortName.items.some(item => !resume || item._id !== prior._id)) {
      throw new Error('This CUSTOMER SHORT NAME is already in use.');
    }

    const proposedCustomerId = resume ? prior.customerId : await generateUniqueCustomerId();
    const now = new Date();
    const customerFields = {
        title: customer.companyName,
        customerShortName: customer.customerShortName,
        customerId: proposedCustomerId,
        country: customer.country,
        natureOfBusiness: customer.natureOfBusiness,
        picTitle: customer.picTitle,
        picName: customer.picName,
        mobileNo: customer.picMobile,
        whatsapp: customer.whatsapp,
        preferredCurrency: customer.preferredCurrency,
        selectionLimit: 100,
        destinationPortName: customer.destinationPort,
        assignedStaffId: staff.staffId,
        salesInitialGrantRevision: staff.grantRevision,
        customerStatus: 'REGISTERING',
        lifecycleStatus: 'ACTIVE',
        accessStatus: 'PENDING',
        reactivationStatus: 'NONE',
        primaryEmail: customer.picEmail,
        ...(linkedLogin ? { primaryUserId: linkedAccessId(proposedCustomerId, linkedLogin._id) } : {})
    };
    const customerRecord = resume ? prior
      : await reserveWebQuotationCustomer({ ...customerFields, quotationMode: 'WEB', webQuotationStatus: 'PENDING' }, linkedLogin);
    const customerId = normalize(customerRecord.customerId);
    const userId = linkedLogin ? customerRecord.primaryUserId : 'USR-' + customerId + '-01';

    let userRecord;
    try {
      userRecord = linkedLogin ? await reserveLinkedRegistrationPrimary(customerRecord, linkedLogin) : await reserveWebQuotationPrimaryUser({
        title: customer.picName,
        userId,
        customerId,
        mobileNo: customer.picMobile,
        status: 'PENDING',
        authorizedTime: now,
        email: customer.picEmail,
        primaryUser: true,
        failedLoginCount: 0
      });
    } catch {
      if (linkedLogin) return { ok: false, retryable: true, result: { customerId },
        error: 'Company reserved. Retry to confirm the linked buyer access.' };
      throw Error('Customer reserved. Retry this registration to confirm buyer access.');
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
      auditActor,
      Boolean(linkedLogin)
    );
    await writeAuditChanges(
      USER_AUDIT_COLLECTION,
      linkedLogin ? 'CUSTOMER_USER_LOGIN_LINKED' : 'CUSTOMER_USER_CREATED',
      customerId,
      userId,
      [
        { fieldId: 'title', fieldLabel: 'USER NAME', beforeValue: '', afterValue: userRecord.title },
        { fieldId: 'email', fieldLabel: 'USER EMAIL', beforeValue: '', afterValue: linkedLogin ? companyUserEmail(userRecord) : userRecord.email },
        { fieldId: 'mobileNo', fieldLabel: 'USER MOBILE NO', beforeValue: '', afterValue: userRecord.mobileNo }
      ],
      auditActor,
      Boolean(linkedLogin)
    );

    return activateWebQuotationCustomer({ customerRecord, userRecord, staff, linkedLogin });
  }
);

async function loadSalesRoomCustomers() {
    const staff = await requireAuthorizedStaffContext();
    let query = wixData.query(CUSTOMER_COLLECTION).limit(1000);

    if (!staff.canBrowseAllCustomers) {
      const ids = staff.customerScope.customerActions.VIEW;
      if (!ids.length) return Object.freeze({ ok: true, summary: { customerCount: 0, qdReadyCount: 0 }, customers: [] });
      query = query.hasSome('customerId', ids);
    }

    const [customerResult, userResult, memberResult] = await Promise.all([
      query.find({ suppressAuth: true, consistentRead: true }),
      wixData.query(CUSTOMER_USER_COLLECTION).limit(1000).find({ suppressAuth: true }),
      wixData.query('Members/FullData').limit(1000).find({ suppressAuth: true }).catch(() => ({ items: [] }))
    ]);
    const customerIds = new Set(
      customerResult.items.map((item) => normalize(item.customerId))
    );

    const activeUserCounts = new Map();
    const pendingUserCounts = new Map();
    const pendingUserReceivedAt = new Map();
    const lastLoginByCustomer = new Map();
    const membersById = new Map();
    const membersByEmail = new Map();
    for (const member of memberResult.items || []) {
      const memberId = normalize(member._id);
      const email = normalizeEmail(member.loginEmail);
      if (memberId) membersById.set(memberId, member);
      if (email) membersByEmail.set(email, member);
    }
    for (const user of userResult.items) {
      const customerId = normalize(user.customerId);
      if (!customerIds.has(customerId)) {
        continue;
      }
      if (upper(user.status) === 'PENDING' && upper(user.requestSource) === 'BUYER ROOM') {
        pendingUserCounts.set(customerId, Number(pendingUserCounts.get(customerId) || 0) + 1);
        const receivedAt = user.requestedAt || user._createdDate || null;
        const current = pendingUserReceivedAt.get(customerId);
        if (receivedAt && (!current || new Date(receivedAt).getTime() < new Date(current).getTime())) pendingUserReceivedAt.set(customerId, receivedAt);
      }
      if (upper(user.status) !== 'ACTIVE') continue;
      activeUserCounts.set(
        customerId,
        Number(activeUserCounts.get(customerId) || 0) + 1
      );
      const member =
        membersById.get(normalize(user.wixMemberId || user.memberId)) ||
        membersByEmail.get(normalizeEmail(user.email));
      const lastLoginAt = member?.lastLoginDate || member?.lastLogin || null;
      if (lastLoginAt) {
        const current = lastLoginByCustomer.get(customerId);
        if (!current || new Date(lastLoginAt).getTime() > new Date(current).getTime()) {
          lastLoginByCustomer.set(customerId, lastLoginAt);
        }
      }
    }

    const customers = customerResult.items.filter(item => staffMayAccessCustomer(staff, 'VIEW', item.customerId))
      .map((item) => ({
        customerId: normalize(item.customerId),
        companyName: normalize(item.title),
        customerShortName: upper(item.customerShortName),
        country: normalize(item.country),
        ...(isWebQuotationCustomer(item) ? { quotationMode: 'WEB', webQuotationStatus: upper(item.webQuotationStatus) } : {}),
        customerStatus: upper(item.customerStatus),
        lifecycleStatus: upper(item.lifecycleStatus || 'ACTIVE'),
        accessStatus: upper(item.accessStatus || (upper(item.customerStatus) === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE')),
        reactivationStatus: upper(item.reactivationStatus || 'NONE'),
        assignedStaffId: upper(item.assignedStaffId),
        primaryEmail: normalizeEmail(item.primaryEmail),
        preferredCurrency: upper(item.preferredCurrency || 'USD'),
        selectionLimit: [100, 300, 500, 700].includes(Number(item.selectionLimit)) ? Number(item.selectionLimit) : 100,
        accessUserCount: Number(
          activeUserCounts.get(normalize(item.customerId)) || 0
        ),
        pendingUserRequestCount: Number(pendingUserCounts.get(normalize(item.customerId)) || 0),
        pendingUserRequestReceivedAt: pendingUserReceivedAt.get(normalize(item.customerId)) || null,
        lastLoginAt: lastLoginByCustomer.get(normalize(item.customerId)) || null,
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
          (item) => item.quotationMode === 'WEB' && item.webQuotationStatus === 'READY'
        ).length
      },
      customers
    });
}

export const getSalesRoomCustomers = webMethod(
  Permissions.SiteMember,
  loadSalesRoomCustomers
);

async function readWebQuoteCounters(customers, listRows) {
  const webRows = new Map(customers.filter(isWebQuotationCustomer).map(customer => [customer.customerId, []]));
  for (const { record, data } of listRows) {
    const selections = webRows.get(normalize(data.customerId));
    if (selections && !record.removed && !data.removed) selections.push({ record, data });
  }
  const result = new Map();
  const activeCustomers = customers.filter(customer => isWebQuotationReady(customer) && webRows.get(customer.customerId).length);
  if (!activeCustomers.length) return { counts: result, selections: webRows };
  const activeRows = activeCustomers.flatMap(customer => webRows.get(customer.customerId));
  const productIds = [...new Set(activeRows.map(row => normalize(row.data.productId)).filter(Boolean))];
  const products = new Map();
  try {
    for (let index = 0; index < productIds.length; index += 100) {
      const batch = productIds.slice(index, index + 100);
      const page = await wixData.query('FMCGMALAYSIA').hasSome('_id', batch).limit(100).find({ suppressAuth:true, consistentRead:true });
      for (const item of page.items) products.set(item._id, item);
    }
  } catch (error) {
    console.warn('Sales Room web quotation counters could not read product packing', error);
    for (const customer of activeCustomers) result.set(customer.customerId, null);
    return { counts: result, selections: webRows };
  }
  await Promise.all(activeCustomers.map(async (customer) => {
    const rows = webRows.get(customer.customerId);
    try {
      const selections = rows.map(({ record, data }) => {
        const product = products.get(normalize(data.productId));
        const barcode = normalize(data.barcode || data.unitBarcode);
        if (!product || normalize(product.barcode) !== barcode) throw Error('Product packing requires reconciliation.');
        // Match Buyer Room packing when Catalogue still uses the legacy price field.
        const hasCatalogueEa = product.ea != null && String(product.ea).trim() !== '';
        return { ...data, id:record._id, barcode, ea:money(data.ea || product.ea || product.price),
          catalogueEa:hasCatalogueEa ? money(product.ea) : null };
      });
      const projected = await applyWebQuotations(customer, selections);
      const quoted = projected.filter(row => row.quoteActive === true).length;
      const pending = projected.filter(row => row.quoteStatus === 'RFQ');
      const received = pending.map(row => row.selectedAt).filter(value => Number.isFinite(Date.parse(value)));
      received.sort((a,b) => new Date(a) - new Date(b));
      result.set(customer.customerId, { quoted, awaiting:pending.length, rfq:pending.length, pendingQuoteReceivedAt:received[0] || '', lastQuoteSyncedAt:'' });
    } catch (error) {
      console.warn('Sales Room web quotation counters could not be confirmed', error);
      result.set(customer.customerId, null);
    }
  }));
  return { counts: result, selections: webRows };
}

export const getSalesRoomCustomersOperational = webMethod(
  Permissions.SiteMember,
  async () => {
    const base = await loadSalesRoomCustomers();
    const [listRows, orderRows, lineRows] = await Promise.all([
      readAllPayloadRows(BUYER_LIST_COLLECTION),
      readAllPayloadRows(BUYER_ORDER_COLLECTION),
      readAllPayloadRows(BUYER_LINE_COLLECTION)
    ]);

    const visibleCustomers = base.customers || [];
    const { counts: webCounts, selections } = await readWebQuoteCounters(visibleCustomers, listRows);
    const incomingStatuses = new Set(['CONFIRMED', 'PROCESSING', 'PROFORMA REQUESTED']);
    const incomingOrders = orderRows.filter((row) => incomingStatuses.has(upper(row.data.status)) && !row.data.receiptOnly);
    const incomingByCustomer = new Map();
    for (const row of incomingOrders) {
      const customerId = normalize(row.data.customerId);
      if (!customerId) continue;
      const current = incomingByCustomer.get(customerId) || { count: 0, incomingOrderReceivedAt: '' };
      current.count += 1;
      const receivedAt = row.data.confirmedAt || row.record?._createdDate || '';
      if (receivedAt && (!current.incomingOrderReceivedAt || new Date(receivedAt).getTime() < new Date(current.incomingOrderReceivedAt).getTime())) {
        current.incomingOrderReceivedAt = receivedAt;
      }
      incomingByCustomer.set(customerId, current);
    }
    const activeLineByCustomer = new Map();
    for (const row of lineRows) {
      const line = row.data;
      const customerId = normalize(line.customerId);
      if (!customerId || line.addedToOrderId || isCompletedProgressLine(line)) continue;
      activeLineByCustomer.set(customerId, Number(activeLineByCustomer.get(customerId) || 0) + 1);
    }
    const customers = visibleCustomers.map((customer) => {
      const quote = webCounts.has(customer.customerId) ? webCounts.get(customer.customerId) : { quoted: 0, awaiting: 0, rfq: 0, pendingQuoteReceivedAt: '', lastQuoteSyncedAt: '' };
      const incoming = incomingByCustomer.get(customer.customerId) || { count: 0, incomingOrderReceivedAt: '' };
      return {
        ...customer,
        quotedItemCount: quote?.quoted ?? null,
        awaitingQuoteItemCount: quote?.awaiting ?? null,
        rfqItemCount: quote?.rfq ?? null,
        quoteWorkStatusAvailable: Boolean(quote),
        pendingQuoteCount: quote?.awaiting ?? null,
        selectedItemCount: selections.get(customer.customerId)?.length ?? 0,
        pendingQuoteReceivedAt: quote?.pendingQuoteReceivedAt || '',
        lastQuoteSyncedAt: quote?.lastQuoteSyncedAt || '',
        confirmedOrderCount: incoming.count,
        activeOrderLineCount: Number(activeLineByCustomer.get(customer.customerId) || 0),
        incomingOrderReceivedAt: incoming.incomingOrderReceivedAt
      };
    });

    return Object.freeze({
      ok: true,
      customers,
      summary: {
        ...(base.summary || {}),
        customerCount: customers.length,
        quoteCustomerCount: customers.every(item => item.awaitingQuoteItemCount !== null) ? customers.filter(item => item.awaitingQuoteItemCount > 0).length : null,
        quotedItemCount: customers.every(item => item.quotedItemCount !== null) ? customers.reduce((sum, item) => sum + item.quotedItemCount, 0) : null,
        unquotedItemCount: customers.every(item => item.awaitingQuoteItemCount !== null) ? customers.reduce((sum, item) => sum + item.awaitingQuoteItemCount, 0) : null,
        pendingQuoteItemCount: customers.every((item) => item.quoteWorkStatusAvailable) ? customers.reduce((sum, item) => sum + item.pendingQuoteCount, 0) : null,
        confirmedOrderCount: incomingOrders.length
      }
    });
  }
);

export const getSalesRoomConfirmedOrders = webMethod(
  Permissions.SiteMember,
  async () => {
    const staff = await requireAuthorizedStaffContext();
    const customerIds = await authorizedCustomerIdSet(staff);
    const [orders, lines] = await Promise.all([
      readPayloadRows(BUYER_ORDER_COLLECTION),
      readPayloadRows(BUYER_LINE_COLLECTION)
    ]);
    const incomingStatuses = new Set(['CONFIRMED', 'PROCESSING', 'PROFORMA REQUESTED']);
    const rows = orders
      .map((entry) => entry.data)
      .filter((order) => customerIds.has(normalize(order.customerId)) && !order.receiptOnly && incomingStatuses.has(upper(order.status)))
      .map((order) => ({
        ...order,
        status: upper(order.status || 'CONFIRMED'),
        totalCartons: order.effectiveTotalCartons ?? order.totalCartons,
        estimatedTotal: order.effectiveEstimatedTotal ?? order.estimatedTotal,
        productCount: lines.filter((line) => normalize(line.data.orderId) === normalize(order.orderId) && !line.data.addedToOrderId).length
      }))
      .sort((a, b) => String(b.confirmedAt || '').localeCompare(String(a.confirmedAt || '')));
    return Object.freeze({ ok: true, orders: rows });
  }
);

export const checkSalesRoomOrderReceipt = webMethod(
  Permissions.SiteMember,
  async (orderId) => {
    const staff = await requireAuthorizedStaffContext();
    const receipt = await submitNctSalesOrder({ orderId: normalize(orderId), staff, reconcileOnly: true,
      authorizeCustomer: customerId => findAuthorizedCustomer(customerId, staff),
      readPayloadRows: readAllPayloadRows, putPayload });
    return Object.freeze({ ok: true, receipt });
  }
);

export const getSalesRoomOrderDetail = webMethod(
  Permissions.SiteMember,
  async (orderId) => {
    const staff = await requireAuthorizedStaffContext();
    let orderEntry = (await readPayloadRows(BUYER_ORDER_COLLECTION))
      .find((entry) => normalize(entry.data.orderId) === normalize(orderId));
    if (!orderEntry) throw new Error('Order was not found.');
    await findAuthorizedCustomer(orderEntry.data.customerId, staff);
    if (!orderEntry.data.masterReceipt) {
      const receipt = await submitNctSalesOrder({ orderId: normalize(orderId), staff, reconcileOnly: true,
        authorizeCustomer: customerId => findAuthorizedCustomer(customerId, staff),
        readPayloadRows: readAllPayloadRows, putPayload });
      if (receipt) orderEntry = (await readPayloadRows(BUYER_ORDER_COLLECTION))
        .find(entry => normalize(entry.data.orderId) === normalize(orderId));
      if (!orderEntry) throw new Error('Order was not found after receipt recovery.');
    }
    const lines = (await readPayloadRows(BUYER_LINE_COLLECTION))
      .map((entry) => entry.data)
      .filter((line) => normalize(line.orderId) === normalize(orderId) && !line.addedToOrderId)
      .sort((a, b) => normalize(a.lineId).localeCompare(normalize(b.lineId)));
    const [displayOrder] = orderEntry.data.masterReceipt?.submissionId ? await withMasterQuantities(normalize(orderEntry.data.customerId), [{...orderEntry.data, lines}]) : [{...orderEntry.data, lines}];
    const sortRows=lines.map(line=>({record:{_id:line.itemId||line.productId||line.lineId},data:{productId:line.itemId||line.productId,barcode:line.barcode}}));
    const barcodes=[...new Set(lines.map(line=>normalize(line.barcode)).filter(Boolean))],sortProducts=[];
    for(let i=0;i<barcodes.length;i+=100){const batch=barcodes.slice(i,i+100),keys=[...batch,...batch.filter(value=>Number.isFinite(Number(value))).map(Number)];const result=await wixData.query('FMCGMALAYSIA').hasSome('barcode',keys).limit(1000).find({suppressAuth:true,consistentRead:true});sortProducts.push(...result.items);}
    const selectionOrder=await salesSelectionSortProjection(sortRows,sortProducts);
    return Object.freeze({ ok: true, order: { ...displayOrder, selectionOrder, totalCartons: orderEntry.data.effectiveTotalCartons ?? orderEntry.data.totalCartons, estimatedTotal: orderEntry.data.effectiveEstimatedTotal ?? orderEntry.data.estimatedTotal } });
  }
);

export const getSalesRoomOrderForm = webMethod(
  Permissions.SiteMember,
  async (customerId) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff);
    const lines = (await readPayloadRows(BUYER_LIST_COLLECTION))
      .map((entry) => entry.data)
      .filter((item) => normalize(item.customerId) === normalize(customer.customerId) && !item.removed)
      .map((item) => ({
        ...item,
        id: normalize(item.id || item.itemId),
        vipPrice: money(item.vipPriceCtn || item.vipPrice),
        orderQtyCtn: quantity(item.orderQtyCtn)
      }));
    return Object.freeze({
      ok: true,
      customer: {
        customerId: normalize(customer.customerId),
        companyName: normalize(customer.title),
        customerShortName: upper(customer.customerShortName),
        currency: upper(customer.preferredCurrency || 'USD')
      },
      lines
    });
  }
);

export const confirmSalesRoomOrderForm = webMethod(
  Permissions.SiteMember,
  async (customerId, requestedLines) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff, 'SEND_ORDER_REQUEST');
    const requests = Array.isArray(requestedLines) ? requestedLines : [];
    if (!requests.length) throw new Error('Enter at least one order quantity.');
    const listRows = (await readPayloadRows(BUYER_LIST_COLLECTION))
      .filter((entry) => normalize(entry.data.customerId) === normalize(customer.customerId) && !entry.data.removed);
    const byId = new Map(listRows.map((entry) => [normalize(entry.data.id || entry.data.itemId), entry.data]));
    const lines = requests.map((request, index) => orderLineFromListItem(byId.get(normalize(request.itemId)), request, index));
    return createConfirmedOrder(customer, staff, lines, 'SALES ASSISTED');
  }
);

export const saveSalesRoomOrderQty = webMethod(
  Permissions.SiteMember,
  async (orderId, lineId, newQuantityCtn, expectedRevision, requestId) => {
    const staff = await requireAuthorizedStaffContext();
    const nextQty = Number(newQuantityCtn);
    if (!Number.isSafeInteger(nextQty) || nextQty < 0) throw new Error('Enter a whole carton quantity of zero or more.');
    const key = normalize(requestId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new Error('Refresh the order and try again.');
    return withSalesOrderMutation(orderId, staff, async (orderEntry) => {
      const order = orderEntry.data;
      const auditId = 'SALES-QTY-' + key;
      const prior = (await readAllPayloadRows(BUYER_ORDER_AUDIT_COLLECTION)).find(entry => normalize(entry.data.auditId) === auditId);
      if (prior) {
        if (normalize(prior.data.orderId) !== normalize(orderId) || normalize(prior.data.detail?.lineId) !== normalize(lineId) || Number(prior.data.detail?.newQuantityCtn) !== nextQty || upper(prior.data.actorStaffId) !== upper(staff.staffId)) throw new Error('Order edit request conflict.');
        return { ok: true, orderId: normalize(orderId), message: 'Quantity change already saved.' };
      }
      if (order.submittedAt || normalize(order.destination) || !['CONFIRMED', 'PROFORMA REQUESTED'].includes(upper(order.status))) throw new Error('Quantities are locked after transfer to NCT / GHR.');
      if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) !== quantity(order.revision)) throw new Error('This order has changed. Refresh it before editing.');
      const entries = (await readAllPayloadRows(BUYER_LINE_COLLECTION)).filter(entry => normalize(entry.data.orderId) === normalize(orderId) && normalize(entry.data.customerId) === normalize(order.customerId) && !entry.data.addedToOrderId);
      const entry = entries.find(item => normalize(item.data.lineId) === normalize(lineId));
      if (!entry) throw new Error('Order line was not found.');
      const line = entry.data;
      if (line.masterSubmittedAt || line.submittedToMasterAt || line.orderConfirmedAt || ['committedQtyCtn', 'committedQty', 'customerOrderQty', 'masterQtyCtn', 'completedQtyCtn'].some(field => line[field] !== undefined && line[field] !== null && line[field] !== '')) throw new Error('This line is already committed and cannot be changed.');
      const previousQty = quantity(line.effectiveRequestedQtyCtn ?? line.requestedQtyCtn ?? line.quantityCtn);
      if (nextQty === previousQty) return { ok: true, orderId: normalize(orderId), message: 'Quantity is unchanged.' };
      const at = new Date().toISOString();
      const actorName = normalize(staff.staffName || staff.title || staff.loginEmail);
      const nextLine = { ...line, originalQuantityCtn: quantity(line.originalQuantityCtn ?? line.quantityCtn), effectiveRequestedQtyCtn: nextQty, effectiveLineAmount: money(nextQty * money(line.lockedPriceCtn || line.lockedUnitPrice)), effectiveLineCbm: nextQty * Number(line.cbmPerCtn || 0), lastQuantityEditAt: at, lastQuantityEditBy: actorName, updatedAt: at };
      const effectiveLines = entries.map(item => item === entry ? nextLine : item.data);
      const nextOrder = { ...order, originalTotalCartons: quantity(order.originalTotalCartons ?? order.totalCartons), effectiveTotalCartons: effectiveLines.reduce((sum, item) => sum + quantity(item.effectiveRequestedQtyCtn ?? item.requestedQtyCtn ?? item.quantityCtn), 0), effectiveEstimatedTotal: money(effectiveLines.reduce((sum, item) => sum + money(item.effectiveLineAmount ?? item.lineAmount), 0)), effectiveTotalCbm: effectiveLines.reduce((sum, item) => sum + Number(item.effectiveLineCbm ?? item.lineCbm ?? 0), 0), revision: quantity(order.revision) + 1, updatedAt: at };
      try {
        await putPayload(BUYER_LINE_COLLECTION, entry.record.title, nextLine);
        await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, nextOrder);
        await putPayload(BUYER_ORDER_AUDIT_COLLECTION, auditId, { auditId, action: 'SALES_QTY_UPDATED', orderId: normalize(orderId), customerId: normalize(order.customerId), at, actorStaffId: upper(staff.staffId), actorEmail: normalizeEmail(staff.loginEmail), actorName, detail: { lineId: normalize(lineId), barcode: normalize(line.barcode), itemName: normalize(line.itemName), originalQuantityCtn: nextLine.originalQuantityCtn, previousQuantityCtn: previousQty, newQuantityCtn: nextQty, revision: nextOrder.revision } });
      } catch (error) {
        try {
          await putPayload(BUYER_LINE_COLLECTION, entry.record.title, line);
          await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, order);
        } catch (recoveryError) {
          error.keepOrderMutationLock = true;
          console.error('Order quantity recovery failed', recoveryError);
          throw Object.assign(new Error('Order update needs Admin review. Further changes are locked.'), { keepOrderMutationLock: true });
        }
        throw error;
      }
      try { await wixRealtimeBackend.publish({ name: 'sales-room-signals' }, { type: 'ORDER_QUANTITY_CHANGED', at }); }
      catch (error) { console.warn('Order realtime refresh failed', error); }
      return { ok: true, orderId: normalize(orderId), order: { ...nextOrder, totalCartons: nextOrder.effectiveTotalCartons, estimatedTotal: nextOrder.effectiveEstimatedTotal, lines: effectiveLines }, message: 'Quantity updated. Buyer Room will refresh automatically.' };
    });
  }
);

export const saveSalesRoomOrderPo = webMethod(
  Permissions.SiteMember,
  async (orderId, customerPoNumber, expectedRevision, requestId) => {
    const staff = await requireAuthorizedStaffContext();
    if (typeof customerPoNumber !== 'string' || /[\r\n\x00-\x1f]/.test(customerPoNumber) || customerPoNumber.trim().length > 100) throw new Error('Enter a P.O. number of up to 100 characters.');
    const value = customerPoNumber.trim(), key = normalize(requestId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new Error('Refresh the order and try again.');
    return withSalesOrderMutation(orderId, staff, async (orderEntry) => {
      const order = orderEntry.data, auditId = 'SALES-PO-' + key;
      const prior = (await readAllPayloadRows(BUYER_ORDER_AUDIT_COLLECTION)).find(entry => normalize(entry.data.auditId) === auditId);
      if (prior) {
        if (normalize(prior.data.orderId) !== normalize(orderId) || prior.data.detail?.customerPoNumber !== value || upper(prior.data.actorStaffId) !== upper(staff.staffId)) throw new Error('Order edit request conflict.');
        return { ok: true, orderId: normalize(orderId), message: 'P.O. number already saved.' };
      }
      if (order.submittedAt || normalize(order.destination) || !['CONFIRMED', 'PROFORMA REQUESTED'].includes(upper(order.status))) throw new Error('P.O. number is locked after transfer to NCT / GHR.');
      if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) !== quantity(order.revision)) throw new Error('This order has changed. Refresh it before editing.');
      if (normalize(order.customerPoNumber) === value) return { ok: true, orderId: normalize(orderId), message: 'P.O. number is unchanged.' };
      const at = new Date().toISOString(), next = { ...order, customerPoNumber: value, revision: quantity(order.revision) + 1 };
      try {
        await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, next);
        await putPayload(BUYER_ORDER_AUDIT_COLLECTION, auditId, { auditId, action: 'CUSTOMER_PO_UPDATED', orderId: normalize(orderId), customerId: normalize(order.customerId), at, actorStaffId: upper(staff.staffId), actorEmail: normalizeEmail(staff.loginEmail), detail: { previousCustomerPoNumber: normalize(order.customerPoNumber), customerPoNumber: value, revision: next.revision } });
      } catch (error) {
        try { await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, order); }
        catch (recoveryError) { console.error('Order P.O. recovery failed', recoveryError); throw Object.assign(new Error('Order update needs Admin review. Further changes are locked.'), { keepOrderMutationLock: true }); }
        throw error;
      }
      return { ok: true, orderId: normalize(orderId), message: 'P.O. number saved.' };
    });
  }
);

export const saveSalesRoomOrderPlanning = webMethod(
  Permissions.SiteMember,
  async (orderId, customerPoNumber, estimatedShipmentDate, expectedRevision, requestId, expectedShipmentRevision) => {
    const staff = await requireAuthorizedStaffContext();
    if (typeof customerPoNumber !== 'string' || /[\r\n\x00-\x1f]/.test(customerPoNumber) || customerPoNumber.trim().length > 100) throw new Error('Enter a P.O. number of up to 100 characters.');
    if (typeof estimatedShipmentDate !== 'string') throw new Error('Select a valid shipment date.');
    const value = customerPoNumber.trim(), date = estimatedShipmentDate.trim(), key = normalize(requestId);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 1000 || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) throw new Error('Select a valid shipment date.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw new Error('Refresh the order and try again.');
    return withSalesOrderMutation(orderId, staff, async (orderEntry) => {
      const order = orderEntry.data, auditId = 'SALES-PLAN-' + key;
      const prior = (await readAllPayloadRows(BUYER_ORDER_AUDIT_COLLECTION)).find(entry => normalize(entry.data.auditId) === auditId);
      if (prior) {
        if (normalize(prior.data.orderId) !== normalize(orderId) || prior.data.detail?.customerPoNumber !== value || prior.data.detail?.estimatedShipmentDate !== date || upper(prior.data.actorStaffId) !== upper(staff.staffId)) throw new Error('Order edit request conflict.');
        return { ok: true, orderId: normalize(orderId), message: 'Order details already saved.' };
      }
      if (order.submittedAt || normalize(order.destination)) {
        if (!['NCT','GHR'].includes(order.destination) || !normalize(order.masterReceipt?.submissionId) || value !== normalize(order.customerPoNumber)) throw new Error('Customer P.O. is locked after transfer to NCT / GHR.');
        if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) !== quantity(order.revision) || typeof expectedShipmentRevision !== 'string') throw new Error('Refresh the order before changing its shipment date.');
        const customer = await findAuthorizedCustomer(order.customerId, staff);
        const receipt = await requestMasterFulfilment({company:order.destination,customerId:normalize(order.customerId),customerName:normalize(customer.companyName||customer.title)||normalize(order.customerId),staff,action:'ORDER_DATE',requestId:key,input:{orderId:normalize(orderId),submissionId:normalize(order.masterReceipt.submissionId),date,version:expectedShipmentRevision}});
        if (receipt?.ok !== true || receipt.orderId !== normalize(orderId) || receipt.customerId !== normalize(order.customerId) || receipt.company !== order.destination || receipt.requestId !== key || receipt.date !== date || !normalize(receipt.revision)) throw new Error('Shipment date receipt is not confirmed. Retry the same save.');
        return {ok:true,orderId:normalize(orderId),message:'Shipment date saved.',shipmentDateRevision:receipt.revision};
      }
      if (!['CONFIRMED', 'PROFORMA REQUESTED'].includes(upper(order.status))) throw new Error('Order details are locked.');
      if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) !== quantity(order.revision)) throw new Error('This order has changed. Refresh it before editing.');
      if (normalize(order.customerPoNumber) === value && normalize(order.estimatedShipmentDate) === date) return { ok: true, orderId: normalize(orderId), message: 'Order details are unchanged.' };
      const at = new Date().toISOString(), actorName = normalize(staff.staffName || staff.title || staff.loginEmail);
      const next = { ...order, customerPoNumber: value, estimatedShipmentDate: date, revision: quantity(order.revision) + 1 };
      if (normalize(order.estimatedShipmentDate) !== date) { next.shipmentDateUpdatedAt = at; next.shipmentDateUpdatedBy = actorName; }
      try {
        await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, next);
        await putPayload(BUYER_ORDER_AUDIT_COLLECTION, auditId, { auditId, action: 'ORDER_PLANNING_UPDATED', orderId: normalize(orderId), customerId: normalize(order.customerId), at, actorStaffId: upper(staff.staffId), actorEmail: normalizeEmail(staff.loginEmail), actorName, detail: { previousCustomerPoNumber: normalize(order.customerPoNumber), customerPoNumber: value, previousEstimatedShipmentDate: normalize(order.estimatedShipmentDate), estimatedShipmentDate: date, revision: next.revision } });
      } catch (error) {
        try { await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, order); }
        catch (recoveryError) { console.error('Order planning recovery failed', recoveryError); throw Object.assign(new Error('Order update needs Admin review. Further changes are locked.'), { keepOrderMutationLock: true }); }
        throw error;
      }
      return { ok: true, orderId: normalize(orderId), message: 'Order details saved.' };
    });
  }
);

async function withSalesOrderMutation(orderId, staff, action) {
  const id = normalize(orderId);
  const initial = (await readAllPayloadRows(BUYER_ORDER_COLLECTION)).find(entry => normalize(entry.data.orderId) === id);
  if (!initial) throw new Error('Order was not found.');
  await findAuthorizedCustomer(initial.data.customerId, staff, 'EDIT_REVIEW_QTY');
  if (initial.data.receiptOnly) throw new Error('This submission is a receipt. Open its active order task instead.');
  const lockId = 'ORDER-LOCK-' + id;
  try { await wixData.insert(BUYER_ORDER_AUDIT_COLLECTION, { _id: lockId, title: lockId, payload: JSON.stringify({ action: 'ORDER_MUTATION_LOCK', orderId: id, customerId: initial.data.customerId, at: new Date().toISOString() }) }, { suppressAuth: true }); }
  catch (error) {
    let lock = null;
    try { lock = await wixData.get(BUYER_ORDER_AUDIT_COLLECTION, lockId, { suppressAuth: true, consistentRead: true }); } catch (_) { /* Preserve the actual insert error when no lock exists. */ }
    if (lock) throw new Error('This order is being updated. Refresh it and try again.');
    throw error;
  }
  let release = true;
  try {
    const record = await wixData.get(BUYER_ORDER_COLLECTION, initial.record._id, { suppressAuth: true, consistentRead: true });
    return await action({ record, data: payloadData(record) });
  } catch (error) { release = !error.keepOrderMutationLock; throw error; }
  finally {
    if (release) await wixData.remove(BUYER_ORDER_AUDIT_COLLECTION, lockId, { suppressAuth: true });
  }
}

export const submitSalesRoomOrder = webMethod(
  Permissions.SiteMember,
  async (orderId, destination) => {
    const staff = await requireAuthorizedStaffContext();
    const target = upper(destination);
    if (!['NCT', 'GHR'].includes(target)) throw new Error('Select a valid receiving company.');
    if (['NCT', 'GHR'].includes(target)) {
      const input = { orderId: normalize(orderId), staff, destination: target,
        authorizeCustomer: customerId => findAuthorizedCustomer(customerId, staff, 'SUBMIT_ORDER'),
        readPayloadRows: readAllPayloadRows, putPayload };
      let receipt, entered = false;
      try {
        receipt = await withSalesOrderMutation(orderId, staff,
          orderEntry => { entered = true; return submitNctSalesOrder({ ...input, lockedOrderEntry: orderEntry }); });
      } catch (error) {
        if (entered) throw error;
        receipt = await submitNctSalesOrder({ ...input, initialError: error });
      }
      return Object.freeze({ ...receipt, status: 'SUBMITTED TO ' + target });
    }
    return withSalesOrderMutation(orderId, staff, async (orderEntry) => {
    const next = { ...orderEntry.data, status: 'SUBMITTED TO ' + target, destination: target, submittedAt: new Date().toISOString(), submittedBy: normalizeEmail(staff.loginEmail) };
    await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, next);
    await writeOrderAudit('ORDER_SUBMITTED', orderId, next.customerId, staff, { destination: target });
    return Object.freeze({ ok: true, orderId: normalize(orderId), status: next.status, destination: target });
    });
  }
);

export const createSalesRoomProforma = webMethod(
  Permissions.SiteMember,
  async (orderId) => {
    const staff = await requireAuthorizedStaffContext();
    return withSalesOrderMutation(orderId, staff, async (orderEntry) => {
    const next = { ...orderEntry.data, status: 'PROFORMA REQUESTED', proformaRequestedAt: new Date().toISOString(), proformaRequestedBy: normalizeEmail(staff.loginEmail) };
    await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, next);
    await writeOrderAudit('PROFORMA_REQUESTED', orderId, next.customerId, staff, {});
    return Object.freeze({ ok: true, orderId: normalize(orderId), status: next.status });
    });
  }
);

export const getSalesRoomCustomerDetail = webMethod(
  Permissions.SiteMember,
  async (customerId) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff);

    // CUSTOMER ID is a business key maintained by Sales Room.  Read the
    // small user directory first and match it in code instead of relying on
    // a CMS equality filter.  This also works while a newly added CMS field
    // is still being indexed after a site publish.
    const userResult = await wixData
      .query(CUSTOMER_USER_COLLECTION)
      .limit(1000)
      .find({ suppressAuth: true });
    const customerUsers = userResult.items
      .filter((user) => normalize(user.customerId) === normalize(customer.customerId))
      .slice(0, 5);

    return Object.freeze({
      ok: true,
      customer: {
        customerId: normalize(customer.customerId),
        companyName: normalize(customer.title),
        customerShortName: upper(customer.customerShortName),
        country: normalize(customer.country),
        natureOfBusiness: normalize(customer.natureOfBusiness),
        picTitle: normalize(customer.picTitle),
        picName: normalize(customer.picName),
        mobileNo: normalize(customer.mobileNo),
        whatsapp: upper(customer.whatsapp),
        preferredCurrency: upper(customer.preferredCurrency),
        selectionLimit: [100, 300, 500, 700].includes(Number(customer.selectionLimit)) ? Number(customer.selectionLimit) : 100,
        destinationPortName: normalize(customer.destinationPortName),
        address1: normalize(customer.address1),
        address2: normalize(customer.address2),
        address3: normalize(customer.address3),
        primaryEmail: normalizeEmail(customer.primaryEmail),
        primaryUserId: normalize(customer.primaryUserId),
        companyWebsite: normalize(customer.companyWebsite),
        assignedStaffId: upper(customer.assignedStaffId),
        ...(isWebQuotationCustomer(customer) ? { quotationMode: 'WEB', webQuotationStatus: upper(customer.webQuotationStatus) } : {}),
        customerStatus: upper(customer.customerStatus),
        lifecycleStatus: upper(customer.lifecycleStatus || 'ACTIVE'),
        accessStatus: upper(customer.accessStatus || (upper(customer.customerStatus) === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE')),
        reactivationStatus: upper(customer.reactivationStatus || 'NONE'),
        accountUpdatedAt: customer._updatedDate || customer._createdDate || null
      },
      users: customerUsers
        .map((user) => ({
          userId: normalize(user.userId),
          userName: normalize(user.title),
          email: companyUserEmail(user),
          mobileNo: normalize(user.mobileNo),
          status: upper(user.status),
          primaryUser: normalize(customer.primaryUserId) ? normalize(user.userId || user._id) === normalize(customer.primaryUserId) : Boolean(user.primaryUser),
          wixMemberId: normalize(user.wixMemberId),
          inviteStatus: upper(user.inviteStatus || (normalize(user.wixMemberId) ? 'JOINED' : 'NOT SENT')),
          requestSource: upper(user.requestSource),
          requestedAt: user.requestedAt || user._createdDate || null
        }))
        .sort((a, b) => a.userId.localeCompare(b.userId))
    });
  }
);

export const updateSalesRoomCustomerLifecycle = webMethod(
  Permissions.SiteMember,
  async (customerId, action, payload = {}) => {
    const normalizedAction = upper(action);
    const staff = await requireAuthorizedStaffContext();
    if (normalizedAction !== 'REQUEST_REACTIVATION' && !staff.canViewAllCustomers) {
      throw new Error('Admin access is required for this customer account action.');
    }
    const customer = await findAuthorizedCustomer(customerId, staff, 'MANAGE_CUSTOMER');
    const reason = normalize(payload?.reason);
    if (!reason) throw new Error('A reason is required for every customer account action.');
    const beforeLifecycle = upper(customer.lifecycleStatus || 'ACTIVE');
    const beforeAccess = upper(customer.accessStatus || (upper(customer.customerStatus) === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'));
    const beforeReactivation = upper(customer.reactivationStatus || 'NONE');
    const patch = {};

    if (normalizedAction === 'REQUEST_REACTIVATION') {
      if (beforeLifecycle === 'ARCHIVED') {
        throw new Error('Archived customers must be restored by an admin.');
      }
      if (beforeAccess !== 'SUSPENDED') {
        throw new Error('Only suspended customers can request reactivation.');
      }
      patch.lifecycleStatus = 'ACTIVE';
      patch.accessStatus = 'SUSPENDED';
      patch.reactivationStatus = 'REQUESTED';
    } else if (normalizedAction === 'SUSPEND') {
      patch.lifecycleStatus = 'ACTIVE';
      patch.accessStatus = 'SUSPENDED';
      patch.reactivationStatus = 'NONE';
    } else if (normalizedAction === 'ARCHIVE') {
      patch.lifecycleStatus = 'ARCHIVED';
      patch.accessStatus = 'SUSPENDED';
      patch.reactivationStatus = 'NONE';
    } else if (normalizedAction === 'ACTIVATE' || normalizedAction === 'RESTORE' || normalizedAction === 'APPROVE_REACTIVATION') {
      patch.lifecycleStatus = 'ACTIVE';
      patch.accessStatus = (isWebQuotationCustomer(customer) && upper(customer.webQuotationStatus) === 'READY') ? 'ACTIVE' : 'PENDING';
      patch.reactivationStatus = normalizedAction === 'APPROVE_REACTIVATION' || (normalizedAction === 'ACTIVATE' && beforeReactivation === 'REQUESTED') ? 'APPROVED' : 'NONE';
    } else if (normalizedAction === 'REJECT_REACTIVATION') {
      patch.lifecycleStatus = beforeLifecycle;
      patch.accessStatus = 'SUSPENDED';
      patch.reactivationStatus = 'REJECTED';
    } else {
      throw new Error('Unsupported customer account action.');
    }

    const users = await wixData
      .query(CUSTOMER_USER_COLLECTION)
      .eq('customerId', normalize(customer.customerId))
      .limit(100)
      .find({ suppressAuth: true });
    const performsReactivationCleanup = ['RESTORE', 'APPROVE_REACTIVATION'].includes(normalizedAction) || (normalizedAction === 'ACTIVATE' && beforeAccess === 'SUSPENDED');
    let selectedPrimary = null;
    if (performsReactivationCleanup) {
      const requestedPrimaryId = normalize(payload?.primaryUserId);
      selectedPrimary = users.items.find(user => normalize(user.userId || user._id) === requestedPrimaryId) || null;
      if (!selectedPrimary || ['REJECTED', 'REVOKED'].includes(upper(selectedPrimary.status))) {
        throw new Error('Select one existing eligible user as the Primary User before reactivating this account.');
      }
      patch.primaryUserId = normalize(selectedPrimary.userId || selectedPrimary._id);
    }

    const updated = await wixData.update(
      CUSTOMER_COLLECTION,
      { ...customer, ...patch },
      { suppressAuth: true }
    );

    if (performsReactivationCleanup) {
      const primaryId = normalize(selectedPrimary.userId || selectedPrimary._id);
      for (const user of users.items) {
        const userId = normalize(user.userId || user._id);
        const keep = userId === primaryId;
        await wixData.update(CUSTOMER_USER_COLLECTION, {
          ...user,
          primaryUser: keep,
          status: keep ? 'ACTIVE' : upper(user.status) === 'PENDING' ? 'REJECTED' : 'REVOKED'
        }, { suppressAuth: true });
      }
    }

    await writeAuditChanges(
      PROFILE_AUDIT_COLLECTION,
      'CUSTOMER_ACCOUNT_UPDATED',
      normalize(customer.customerId),
      normalize(customer.customerId),
      [
        { fieldId: 'lifecycleStatus', fieldLabel: 'Lifecycle Status', beforeValue: beforeLifecycle, afterValue: patch.lifecycleStatus },
        { fieldId: 'accessStatus', fieldLabel: 'Access Status', beforeValue: beforeAccess, afterValue: patch.accessStatus },
        { fieldId: 'reactivationStatus', fieldLabel: 'Reactivation Status', beforeValue: beforeReactivation, afterValue: patch.reactivationStatus },
        { fieldId: 'reason', fieldLabel: 'Reason', beforeValue: '', afterValue: reason }
      ],
      staff
    );

    return Object.freeze({
      ok: true,
      customerId: normalize(updated.customerId),
      action: normalizedAction,
      lifecycleStatus: upper(updated.lifecycleStatus),
      accessStatus: upper(updated.accessStatus),
      reactivationStatus: upper(updated.reactivationStatus)
    });
  }
);


const LOCKED_CUSTOMER_FIELDS = Object.freeze([
  'customerId',
  'customerShortName',
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
  'customerStatus',
  'lifecycleStatus',
  'accessStatus',
  'reactivationStatus',
  'accountUpdatedAt'
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

export const updateSalesRoomSelectionLimit = webMethod(
  Permissions.SiteMember,
  async (customerId, requestedLimit) => {
    const staff = await requireAuthorizedStaffContext();
    if (!staff.canViewAllCustomers) throw new Error('Only Admin can change a customer selection allowance.');
    const limit = Number(requestedLimit);
    if (![100, 300, 500, 700].includes(limit) || String(requestedLimit).trim() !== String(limit)) {
      throw new Error('Choose an allowance of 100, 300, 500 or 700 products.');
    }
    const customer = await findAuthorizedCustomer(customerId, staff, 'MANAGE_CUSTOMER');
    const before = [100, 300, 500, 700].includes(Number(customer.selectionLimit)) ? Number(customer.selectionLimit) : 100;
    if (before === limit) return Object.freeze({ ok: true, customerId: normalize(customer.customerId), selectionLimit: limit, changed: false });
    await wixData.update(CUSTOMER_COLLECTION, { ...customer, selectionLimit: limit }, { suppressAuth: true });
    await writeAuditChanges(PROFILE_AUDIT_COLLECTION, 'SELECTION_LIMIT_UPDATED', normalize(customer.customerId), normalize(customer.customerId), [{
      fieldId: 'selectionLimit', fieldLabel: 'MY SELECTION ALLOWANCE', beforeValue: before, afterValue: limit
    }], staff);
    return Object.freeze({ ok: true, customerId: normalize(customer.customerId), selectionLimit: limit, changed: true });
  }
);

export const updateSalesRoomCustomerProfile = webMethod(
  Permissions.SiteMember,
  async (customerId, payload) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff, 'MANAGE_CUSTOMER');
    const input = payload && typeof payload === 'object' ? payload : {};

    for (const key of LOCKED_CUSTOMER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        throw new Error('CUSTOMER SHORT NAME, COMPANY NAME, COUNTRY, CUSTOMER ID, assignment and QD routing are locked.');
      }
    }

    const patch = {};
    for (const key of Object.keys(EDITABLE_CUSTOMER_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        patch[key] = normalizeEditableCustomerValue(key, input[key]);
      }
    }

    const changes = Object.keys(patch)
      .filter((key) => comparableCustomerProfileValue(key, customer[key]) !== patch[key])
      .map((key) => ({
        fieldId: key,
        fieldLabel: EDITABLE_CUSTOMER_FIELDS[key],
        beforeValue: customer[key],
        afterValue: patch[key]
      }));

    if (Object.prototype.hasOwnProperty.call(patch, 'customerShortName') && upper(customer.customerShortName) !== patch.customerShortName) {
      const duplicate = await wixData
        .query(CUSTOMER_COLLECTION)
        .eq('customerShortName', patch.customerShortName)
        .limit(2)
        .find({ suppressAuth: true });
      if (duplicate.items.some((item) => normalize(item.customerId) !== normalize(customer.customerId))) {
        throw new Error('This CUSTOMER SHORT NAME is already in use.');
      }
    }

    if (!changes.length) {
      return Object.freeze({ ok: true, customerId: normalize(customer.customerId), changedFields: [] });
    }

    await wixData.update(
      CUSTOMER_COLLECTION,
      { ...customer, ...Object.fromEntries(changes.map(({ fieldId, afterValue }) => [fieldId, afterValue])) },
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

function comparableCustomerProfileValue(key, value) {
  if (key === 'primaryEmail') return normalizeEmail(value);
  if (['customerShortName', 'natureOfBusiness', 'preferredCurrency', 'whatsapp', 'picTitle'].includes(key)) return upper(value);
  return normalize(value);
}

export const saveSalesRoomCustomerUser = webMethod(
  Permissions.SiteMember,
  async (customerId, slotNumber, payload) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff, 'MANAGE_CUSTOMER');
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
    const customerAccessStatus = upper(customer.accessStatus || 'PENDING');
    const customerLifecycleStatus = upper(customer.lifecycleStatus || 'ACTIVE');
    const permittedUserStatus = customerLifecycleStatus === 'ARCHIVED' || customerAccessStatus === 'SUSPENDED' || customerAccessStatus === 'BLOCKED'
      ? 'SUSPENDED'
      : customerAccessStatus === 'ACTIVE'
        ? 'ACTIVE'
        : 'PENDING';
    const nextUser = {
      ...(existing || {}),
      title: userName,
      userId,
      customerId: normalizedCustomerId,
      email,
      mobileNo,
      primaryUser: slot === 1,
      status: permittedUserStatus,
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

async function allCustomerUsers(customerId = '') {
  let query = wixData.query(CUSTOMER_USER_COLLECTION);
  if (customerId) query = query.eq('customerId', normalize(customerId));
  const result = await query.limit(1000).find({ suppressAuth: true, consistentRead: true });
  return result.items;
}

function countsTowardUserLimit(user) {
  return ['ACTIVE', 'PENDING'].includes(upper(user?.status));
}

function validateCustomerUserInput(payload = {}) {
  const userName = normalize(payload.userName || payload.name);
  const email = normalizeEmail(payload.email);
  const mobileNo = normalize(payload.mobileNo || payload.mobile);
  if (!userName || userName.length > 120) throw new Error('Enter the user name.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid work email.');
  if (!/^\+?[0-9 ()-]{7,24}$/.test(mobileNo)) throw new Error('Enter a valid international mobile number.');
  return { userName, email, mobileNo };
}

function primaryUserFrom(customer, users) {
  const configured = normalize(customer.primaryUserId);
  return users.find(user => configured ? normalize(user.userId || user._id) === configured : Boolean(user.primaryUser)) || null;
}

export const addSalesRoomCustomerUser = webMethod(Permissions.SiteMember, async (customerId, payload = {}, requestId = '') => {
  const staff = await requireAuthorizedStaffContext();
  const customer = await findAuthorizedCustomer(customerId, staff, 'MANAGE_CUSTOMER');
  const lifecycle = upper(customer.lifecycleStatus || 'ACTIVE');
  const access = upper(customer.accessStatus || customer.customerStatus);
  if (lifecycle === 'ARCHIVED' || access !== 'ACTIVE') throw new Error('Users can only be added to an active customer account.');
  const input = validateCustomerUserInput(payload);
  const requestKey = normalize(requestId);
  if (!requestKey || requestKey.length > 100) throw new Error('A valid request reference is required.');
  if (payload.linkExistingLogin === 'yes') {
    if (!isWebQuotationReady(customer)) throw new Error('Approve this company before linking a Buyer Room login.');
    const id = normalize(customer.customerId);
    const scopedUsers = await allCustomerUsers(id);
    const current = scopedUsers.find(user => normalize(user.requestId) === requestKey &&
      user.linkedLoginId && companyUserEmail(user) === input.email && countsTowardUserLimit(user));
    if (current) return { ok: true, customerId: id, userId: normalize(current.userId), status: current.status, duplicateRequest: true };
    if (scopedUsers.some(user => companyUserEmail(user) === input.email && countsTowardUserLimit(user))) throw new Error('This email is already listed for this customer.');
    if (scopedUsers.filter(countsTowardUserLimit).length >= 5) throw new Error('This customer already has the maximum of 5 users.');
    const login = await findCompanyLogin(input.email);
    if (!login || upper(login.status) !== 'ACTIVE') throw new Error('An active existing Buyer Room login is required.');
    const { user, duplicateRequest } = await saveLinkedCompanyUser(id, login, {
      title: input.userName, mobileNo: input.mobileNo, requestId: requestKey, requestSource: 'SALES ROOM'
    });
    if (!duplicateRequest) await writeAuditChanges(USER_AUDIT_COLLECTION, 'CUSTOMER_USER_LOGIN_LINKED', id, user.userId, [
      { fieldId: 'status', fieldLabel: 'USER ACCESS', beforeValue: '', afterValue: 'ACTIVE' },
      { fieldId: 'email', fieldLabel: 'USER EMAIL', beforeValue: '', afterValue: input.email }
    ], staff);
    return { ok: true, customerId: id, userId: user.userId, status: 'ACTIVE' };
  }
  const directory = await allCustomerUsers();
  const repeated = directory.find(user => normalize(user.requestId) === requestKey && normalize(user.customerId) === normalize(customer.customerId));
  if (repeated) return { ok: true, customerId: normalize(customer.customerId), userId: normalize(repeated.userId), duplicateRequest: true };
  const customerUsers = directory.filter(user => normalize(user.customerId) === normalize(customer.customerId));
  const emailMatch = directory.find(user => normalizeEmail(user.email) === input.email);
  if (emailMatch && normalize(emailMatch.customerId) !== normalize(customer.customerId)) throw new Error('This email already has a Buyer Room login. Select Link existing login to grant access to this company.');
  if (emailMatch && ['ACTIVE', 'PENDING'].includes(upper(emailMatch.status))) throw new Error('This email is already listed for this customer.');
  if (customerUsers.filter(countsTowardUserLimit).length >= 5) throw new Error('This customer already has the maximum of 5 users.');
  const now = new Date();
  const userId = normalize(emailMatch?.userId) || `USR-${normalize(customer.customerId)}-${now.getTime().toString(36).toUpperCase()}`;
  const next = {
    ...(emailMatch || {}), title: input.userName, userId, customerId: normalize(customer.customerId), email: input.email,
    mobileNo: input.mobileNo, status: 'ACTIVE', primaryUser: false, requestId: requestKey, requestSource: 'SALES ROOM',
    failedLoginCount: Number(emailMatch?.failedLoginCount || 0)
  };
  const saved = emailMatch
    ? await wixData.update(CUSTOMER_USER_COLLECTION, next, { suppressAuth: true })
    : await wixData.insert(CUSTOMER_USER_COLLECTION, next, { suppressAuth: true });
  await writeAuditChanges(USER_AUDIT_COLLECTION, 'CUSTOMER_USER_CREATED', normalize(customer.customerId), userId, [
    { fieldId: 'status', fieldLabel: 'USER ACCESS', beforeValue: upper(emailMatch?.status), afterValue: 'ACTIVE' },
    { fieldId: 'email', fieldLabel: 'USER EMAIL', beforeValue: normalizeEmail(emailMatch?.email), afterValue: input.email }
  ], staff);
  const primary = primaryUserFrom(customer, customerUsers);
  await Promise.all([
    primary ? putAccountNotification({ eventId: `SALES-USER-PRIMARY-${requestKey}`, customerId: customer.customerId, recipientUserId: primary.userId, type: 'USER ACCESS', heading: 'User added', message: `${input.userName} was added by your salesperson.`, targetUserId: userId }) : Promise.resolve(),
    putAccountNotification({ eventId: `SALES-USER-TARGET-${requestKey}`, customerId: customer.customerId, recipientUserId: userId, type: 'USER ACCESS', heading: 'Buyer Room access granted', message: 'Your salesperson has granted access to this company Buyer Room.', targetUserId: userId })
  ]);
  return { ok: true, customerId: normalize(customer.customerId), userId: normalize(saved.userId), status: 'ACTIVE' };
});

export const reviewSalesRoomCustomerUser = webMethod(Permissions.SiteMember, async (customerId, userId, action, payload = {}) => {
  const staff = await requireAuthorizedStaffContext();
  const customer = await findAuthorizedCustomer(customerId, staff, 'MANAGE_CUSTOMER');
  const normalizedAction = upper(action);
  const users = await allCustomerUsers(customer.customerId);
  const target = users.find(user => normalize(user.userId || user._id) === normalize(userId));
  if (!target) throw new Error('Customer user was not found.');
  const targetId = normalize(target.userId || target._id);
  const primary = primaryUserFrom(customer, users);
  const primaryId = normalize(primary?.userId || primary?._id);
  const now = new Date();
  let next = { ...target };
  let actionName = '';
  let notificationHeading = '';
  let notificationMessage = '';

  if (normalizedAction === 'APPROVE') {
    if (upper(customer.accessStatus) !== 'ACTIVE' || upper(customer.lifecycleStatus || 'ACTIVE') === 'ARCHIVED') throw new Error('Activate the customer account before approving users.');
    if (upper(target.status) !== 'PENDING') throw new Error('Only pending user requests can be approved.');
    if (users.filter(user => countsTowardUserLimit(user) && normalize(user.userId || user._id) !== targetId).length >= 5) throw new Error('This customer already has the maximum of 5 users.');
    next = { ...next, status: 'ACTIVE' };
    actionName = 'CUSTOMER_USER_APPROVED'; notificationHeading = 'User request approved'; notificationMessage = `${normalize(target.title) || target.email} can now access Buyer Room.`;
  } else if (normalizedAction === 'REJECT') {
    if (upper(target.status) !== 'PENDING') throw new Error('Only pending user requests can be rejected.');
    if (!normalize(payload.reason)) throw new Error('Enter a rejection reason.');
    next = { ...next, status: 'REJECTED', primaryUser: false };
    actionName = 'CUSTOMER_USER_REJECTED'; notificationHeading = 'User request rejected'; notificationMessage = normalize(payload.reason);
  } else if (normalizedAction === 'REVOKE') {
    if (targetId === primaryId) throw new Error('Transfer Primary User access before removing this user.');
    if (!normalize(payload.reason)) throw new Error('Enter a removal reason.');
    next = { ...next, status: 'REVOKED', primaryUser: false };
    actionName = 'CUSTOMER_USER_REVOKED'; notificationHeading = 'User access removed'; notificationMessage = normalize(payload.reason);
  } else if (normalizedAction === 'SET_PRIMARY') {
    if (upper(target.status) !== 'ACTIVE') throw new Error('Primary access can only be assigned to an active user.');
    if (targetId === primaryId) return { ok: true, unchanged: true, customerId: normalize(customer.customerId), userId: targetId };
    await wixData.update(CUSTOMER_COLLECTION, { ...customer, primaryUserId: targetId }, { suppressAuth: true });
    for (const user of users) {
      const id = normalize(user.userId || user._id);
      if (Boolean(user.primaryUser) !== (id === targetId)) await wixData.update(CUSTOMER_USER_COLLECTION, { ...user, primaryUser: id === targetId }, { suppressAuth: true });
    }
    await writeAuditChanges(USER_AUDIT_COLLECTION, 'PRIMARY_USER_CHANGED', normalize(customer.customerId), targetId, [{ fieldId: 'primaryUserId', fieldLabel: 'PRIMARY USER', beforeValue: primaryId, afterValue: targetId }], staff);
    await Promise.all([
      primaryId ? putAccountNotification({ eventId: `PRIMARY-OLD-${normalize(payload.requestId) || now.getTime()}`, customerId: customer.customerId, recipientUserId: primaryId, type: 'PRIMARY USER', heading: 'Primary User changed', message: `${normalize(target.title) || target.email} is now the Primary User.`, targetUserId: targetId }) : Promise.resolve(),
      putAccountNotification({ eventId: `PRIMARY-NEW-${normalize(payload.requestId) || now.getTime()}`, customerId: customer.customerId, recipientUserId: targetId, type: 'PRIMARY USER', heading: 'You are now the Primary User', message: 'Your salesperson changed the Primary User for this company.', targetUserId: targetId })
    ]);
    return { ok: true, customerId: normalize(customer.customerId), userId: targetId, action: normalizedAction };
  } else {
    throw new Error('Unsupported customer user action.');
  }

  const saved = await wixData.update(CUSTOMER_USER_COLLECTION, next, { suppressAuth: true });
  await writeAuditChanges(USER_AUDIT_COLLECTION, actionName, normalize(customer.customerId), targetId, [{ fieldId: 'status', fieldLabel: 'USER ACCESS', beforeValue: upper(target.status), afterValue: upper(saved.status) }], staff);
  const recipient = normalize(target.requestedByUserId) || primaryId;
  await Promise.all([
    recipient ? putAccountNotification({ eventId: `${actionName}-${targetId}-${now.getTime()}`, customerId: customer.customerId, recipientUserId: recipient, type: 'USER ACCESS', heading: notificationHeading, message: notificationMessage, targetUserId: targetId }) : Promise.resolve(),
    recipient !== targetId ? putAccountNotification({ eventId: `${actionName}-TARGET-${targetId}-${now.getTime()}`, customerId: customer.customerId, recipientUserId: targetId, type: 'USER ACCESS', heading: notificationHeading, message: notificationMessage, targetUserId: targetId }) : Promise.resolve()
  ]);
  return { ok: true, customerId: normalize(customer.customerId), userId: targetId, action: normalizedAction, status: upper(saved.status) };
});

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

function payloadData(record) {
  const raw = record?.payload;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw || '{}')); } catch (_) { return {}; }
}

async function readPayloadRows(collectionId) {
  const result = await wixData
    .query(collectionId)
    .limit(1000)
    .find({ suppressAuth: true, consistentRead: true });
  return result.items.map((record) => ({ record, data: payloadData(record) }));
}

async function readAllPayloadRows(collectionId) {
  let result = await wixData
    .query(collectionId)
    .limit(1000)
    .find({ suppressAuth: true, consistentRead: true });
  const items = [...result.items];
  while (typeof result.hasNext === 'function' && result.hasNext()) {
    result = await result.next();
    items.push(...result.items);
  }
  return items.map((record) => ({ record, data: payloadData(record) }));
}

// Read the same Catalogue classification/brand/sort fields used by Buyer workspaceItems.
// Only the authorized customer's selection rows are passed in; no operational writes.
async function salesSelectionSortProjection(rows,prefetched=null) {
  const ids = [...new Set(rows.map(row => normalize(row.data.productId)).filter(Boolean))], products = Array.isArray(prefetched)?[...prefetched]:[];
  for (let i = 0; !prefetched && i < ids.length; i += 100) {
    const result = await wixData.query('FMCGMALAYSIA').hasSome('_id', ids.slice(i, i + 100)).limit(100).find({ suppressAuth: true });
    products.push(...result.items);
  }
  const resolved = new Set(products.map(product => normalize(product.barcode)).filter(Boolean));
  const barcodes = [...new Set(rows.map(row => normalize(row.data.barcode || row.data.unitBarcode)).filter(Boolean))].filter(barcode => !resolved.has(barcode));
  for (const barcode of prefetched?[]:barcodes) {
    let product = null;
    try { product = (await wixData.query('FMCGMALAYSIA').eq('barcode', barcode).limit(1).find({ suppressAuth: true, consistentRead: true })).items[0]; } catch (_) { /* Match Buyer's numeric barcode retry. */ }
    if (!product && Number.isFinite(Number(barcode))) {
      try { product = (await wixData.query('FMCGMALAYSIA').eq('barcode', Number(barcode)).limit(1).find({ suppressAuth: true, consistentRead: true })).items[0]; } catch (_) { /* Product is unavailable. */ }
    }
    if (product) products.push(product);
  }
  const refs = value => (Array.isArray(value) ? value : value ? [value] : []).map(entry => normalize(entry?._id || entry)).filter(Boolean);
  const categoryMap = new Map(), referencedIds = [...new Set(products.flatMap(product => refs(product.subCategories)))];
  for (let i = 0; i < referencedIds.length; i += 100) {
    const result = await wixData.query('subCategories').hasSome('_id', referencedIds.slice(i, i + 100)).limit(100).find({ suppressAuth: true });
    result.items.forEach(item => categoryMap.set(normalize(item._id), upper(item.mainCategory)));
  }
  const foodIds = (await wixData.query('subCategories').startsWith('mainCategory', 'FOOD').limit(1000).find({ suppressAuth: true })).items.map(item => normalize(item._id)).filter(Boolean);
  const productIds = [...new Set(products.map(product => normalize(product._id)).filter(Boolean))], foodProducts = new Set();
  if (foodIds.length) for (let i = 0; i < productIds.length; i += 100) {
    const result = await wixData.query('FMCGMALAYSIA').hasSome('_id', productIds.slice(i, i + 100)).hasSome('subCategories', foodIds).limit(100).find({ suppressAuth: true });
    result.items.forEach(item => foodProducts.add(normalize(item._id)));
  }
  const byId = new Map(products.map(product => [normalize(product._id), product])), byBarcode = new Map(products.map(product => [normalize(product.barcode), product]));
  return rows.map(({ record, data }) => {
    const product = byId.get(normalize(data.productId)) || byBarcode.get(normalize(data.barcode || data.unitBarcode)) || {};
    return { id: normalize(record._id || data.id || data.itemId), barcode: normalize(data.barcode || data.unitBarcode || product.barcode), category: normalize(data.category || data.mainCategory || (foodProducts.has(normalize(product._id)) ? 'FOOD' : '') || product.mainCategory || refs(product.subCategories).map(id => categoryMap.get(id)).find(Boolean)), brandName: normalize(product.brandName), sortNo: normalize(product.pointBaseSortId) };
  });
}

export const getSalesRoomOrderProgress = webMethod(
  Permissions.SiteMember,
  async (customerId) => {
    const staff = await requireAuthorizedStaffContext();
    const customer = await findAuthorizedCustomer(customerId, staff);
    const normalizedCustomerId = normalize(customer.customerId);
    const [orderRows, lineRows, selectionRows] = await Promise.all([
      readAllPayloadRows(BUYER_ORDER_COLLECTION),
      readAllPayloadRows(BUYER_LINE_COLLECTION),
      readAllPayloadRows(BUYER_LIST_COLLECTION)
    ]);
    const linesByOrder = new Map();
    for (const row of lineRows) {
      const line = row.data;
      if (normalize(line.customerId) !== normalizedCustomerId || line.addedToOrderId) continue;
      const orderId = normalize(line.orderId);
      if (!orderId) continue;
      if (!linesByOrder.has(orderId)) linesByOrder.set(orderId, []);
      linesByOrder.get(orderId).push(line);
    }
    const orders = orderRows
      .map((row) => row.data)
      .filter((order) => normalize(order.customerId) === normalizedCustomerId && !order.receiptOnly)
      .map((order) => {
        const orderId = normalize(order.orderId);
        const storedLines = linesByOrder.get(orderId) || [];
        const embeddedLines = Array.isArray(order.lines) ? order.lines : Array.isArray(order.pendingLines) ? order.pendingLines : [];
        const lines = storedLines.length ? storedLines : embeddedLines;
        return { ...order, orderId, lines };
      })
      .filter((order) => order.lines.length)
      .sort((a, b) => new Date(b.confirmedAt || 0).getTime() - new Date(a.confirmedAt || 0).getTime());
    const currentOrders = (await withMasterQuantities(normalizedCustomerId, orders))
      .map(order => ({ ...order, lines: order.lines.filter(line => !isCompletedProgressLine(line)) }))
      .filter(order => order.lines.length);
    return Object.freeze({
      ok: true,
      customerId: normalizedCustomerId,
      companyName: normalize(customer.title),
      customerShortName: upper(customer.customerShortName),
      activeLineCount: currentOrders.reduce((sum, order) => sum + order.lines.length, 0),
      selectionOrder: await salesSelectionSortProjection(selectionRows.filter(row => normalize(row.data.customerId) === normalizedCustomerId)),
      orders: currentOrders
    });
  }
);

async function putPayload(collectionId, title, payload) {
  const result = await wixData
    .query(collectionId)
    .eq('title', normalize(title))
    .limit(2)
    .find({ suppressAuth: true, consistentRead: true });
  if (result.items.length > 1) throw new Error('Duplicate operational record. Admin review is required.');
  const next = { ...(result.items[0] || {}), title: normalize(title), payload: JSON.stringify(payload) };
  if ([BUYER_LIST_COLLECTION, BUYER_ORDER_COLLECTION, BUYER_LINE_COLLECTION].includes(collectionId)) next.customerId = normalize(payload.customerId);
  if (collectionId === BUYER_LIST_COLLECTION) {
    next.removed = Boolean(payload.removed);
    next.qdSyncStatus = upper(payload.qdSyncStatus);
  }
  if (collectionId === BUYER_ORDER_COLLECTION) {
    next.orderId = normalize(payload.orderId);
    next.orderSortKey = normalize(payload.confirmedAt) + '|' + normalize(payload.orderId);
    next.status = upper(payload.status);
    next.isComplete = Boolean(payload.isComplete);
  }
  if (collectionId === BUYER_LINE_COLLECTION) next.orderId = normalize(payload.orderId);
  return result.items.length
    ? wixData.update(collectionId, next, { suppressAuth: true })
    : wixData.insert(collectionId, next, { suppressAuth: true });
}

async function putAccountNotification({ eventId, customerId, recipientUserId = '', type, heading, message, targetUserId = '' }) {
  const id = normalize(eventId);
  if (!id) return;
  await putPayload(ACCOUNT_NOTIFICATION_COLLECTION, id, {
    eventId: id,
    customerId: normalize(customerId),
    recipientUserId: normalize(recipientUserId),
    type: upper(type),
    heading: normalize(heading),
    message: normalize(message),
    targetUserId: normalize(targetUserId),
    createdAt: new Date().toISOString(),
    readByUserIds: []
  });
}

async function authorizedCustomerIdSet(staff) {
  let query = wixData.query(CUSTOMER_COLLECTION).limit(1000);
  if (!staff.canBrowseAllCustomers) {
    const ids = staff.customerScope.customerActions.VIEW;
    if (!ids.length) return new Set();
    query = query.hasSome('customerId', ids);
  }
  const result = await query.find({ suppressAuth: true });
  return new Set(result.items.filter(item => staffMayAccessCustomer(staff, 'VIEW', item.customerId)).map((item) => normalize(item.customerId)));
}

function quantity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Number(money(value).toFixed(2));
}

function orderLineFromListItem(item, request, index) {
  const qty = quantity(request?.quantityCtn);
  if (!item || qty < 1) throw new Error('Invalid order line.');
  const lockedUnitPrice = money(item.vipPriceCtn || item.vipPrice);
  if (!(lockedUnitPrice > 0)) throw new Error('All ordered products must have a V.I.P price.');
  return {
    lineId: 'L' + String(index + 1).padStart(3, '0'),
    itemId: normalize(item.id || item.itemId),
    barcode: normalize(item.barcode),
    itemName: normalize(item.itemName),
    packingSize: normalize(item.packingSize),
    cbmPerCtn: money(item.cbmPerCtn),
    currency: upper(item.vipCurrency || item.currency || 'USD'),
    lockedUnitPrice,
    quantityCtn: qty,
    lineAmount: roundMoney(lockedUnitPrice * qty)
  };
}

async function createConfirmedOrder(customer, staff, lines, source) {
  const customerId = normalize(customer.customerId);
  const orderId = 'ORD-' + customerId.replace(/[^A-Z0-9-]/gi, '').toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
  const confirmedAt = new Date().toISOString();
  const order = {
    orderId,
    customerId,
    companyName: normalize(customer.title),
    currency: lines[0]?.currency || upper(customer.preferredCurrency || 'USD'),
    status: 'CONFIRMED',
    isComplete: true,
    lineCount: lines.length,
    source,
    confirmedAt,
    confirmedBy: normalizeEmail(staff.loginEmail),
    totalCartons: lines.reduce((sum, line) => sum + line.quantityCtn, 0),
    estimatedTotal: roundMoney(lines.reduce((sum, line) => sum + line.lineAmount, 0))
  };
  for (const line of lines) {
    await putPayload(BUYER_LINE_COLLECTION, orderId + '|' + line.lineId, { ...line, orderId, customerId, priceLockedAt: confirmedAt });
  }
  await writeOrderAudit('SALES_CONFIRMED_ORDER', orderId, customerId, staff, { source });
  await putPayload(BUYER_ORDER_COLLECTION, orderId, order);
  return Object.freeze({ ok: true, orderId, status: order.status });
}

async function recalculateOrder(orderEntry) {
  const lines = (await readPayloadRows(BUYER_LINE_COLLECTION))
    .map((entry) => entry.data)
    .filter((line) => normalize(line.orderId) === normalize(orderEntry.data.orderId));
  const next = {
    ...orderEntry.data,
    totalCartons: lines.reduce((sum, line) => sum + quantity(line.quantityCtn), 0),
    estimatedTotal: roundMoney(lines.reduce((sum, line) => sum + money(line.lineAmount), 0)),
    updatedAt: new Date().toISOString()
  };
  await putPayload(BUYER_ORDER_COLLECTION, orderEntry.record.title, next);
  return next;
}

async function writeOrderAudit(action, orderId, customerId, staff, detail) {
  const auditId = 'OA-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  await putPayload(BUYER_ORDER_AUDIT_COLLECTION, auditId, {
    auditId,
    action,
    orderId: normalize(orderId),
    customerId: normalize(customerId),
    at: new Date().toISOString(),
    actorStaffId: upper(staff.staffId),
    actorEmail: normalizeEmail(staff.loginEmail),
    detail: detail || {}
  });
}

function normalizeEditableCustomerValue(key, value) {
  if (key === 'customerShortName') return validateCustomerShortName(value);
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

async function writeAuditChanges(collectionId, action, customerId, entityId, changes, staff, once = false) {
  if (!changes.length) return;

  const changedAt = new Date().toISOString();
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const auditId = once
      ? 'AUD-' + createHash('sha256').update(JSON.stringify([action, customerId, entityId, change.fieldId])).digest('hex').slice(0, 32)
      :
      'AUD-' +
      changedAt.replace(/\D/g, '').slice(0, 17) +
      '-' +
      String(index + 1).padStart(2, '0') +
      '-' +
      Math.random().toString(36).slice(2, 8).toUpperCase();

    await wixData.insert(
      collectionId,
      {
        ...(once ? { _id: auditId } : {}),
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
    ).catch(async error => {
      if (!once) throw error;
      const saved = await wixData.get(collectionId, auditId, { suppressAuth: true, consistentRead: true }).catch(() => null);
      if (!saved || saved.customerId !== customerId || saved.entityId !== entityId ||
          saved.action !== action || saved.fieldId !== change.fieldId ||
          saved.afterValue !== auditValue(change.afterValue)) throw error;
    });
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
  return getCurrentStaffContext();
}

async function requireAuthorizedStaffContext() {
  const context = await resolveCurrentStaffContext();
  if (!context?.authorized) {
    throw new Error('This member is not authorized in STAFF MASTER.');
  }
  return context;
}

async function requireAdminStaffContext() {
  const context = await requireAuthorizedStaffContext();
  if (!context.canViewAllCustomers) {
    throw new Error('Only Admin can change customer account status.');
  }
  return context;
}

async function findAuthorizedCustomer(customerId, staff, action = 'VIEW') {
  const normalizedCustomerId = normalize(customerId);
  if (!normalizedCustomerId) {
    throw new Error('CUSTOMER ID is required.');
  }

  // Use the same proven read path as the customer list.  In production the
  // direct .eq('customerId', ...) query intermittently failed for freshly
  // published CMS schemas, which broke Manage Account, Order Form and the
  // assisted Catalogue together.  Filtering the bounded customer directory
  // in code keeps authorization deterministic and removes that shared point
  // of failure.
  requireStaffCustomerAccess(staff, action, normalizedCustomerId);
  const query = wixData.query(CUSTOMER_COLLECTION).limit(1000);
  const result = await query.find({ suppressAuth: true });
  const matches = result.items.filter(
    (item) => normalize(item.customerId) === normalizedCustomerId
  );

  if (matches.length !== 1) {
    throw new Error(
      matches.length > 1
        ? 'Duplicate CUSTOMER ID. Admin review is required.'
        : 'Customer was not found.'
    );
  }

  const customer = matches[0];

  return customer;
}

async function resolveCustomerRouting(requestedAssignedStaffId) {
  const context = await requireAuthorizedStaffContext();
  const owner = await resolveMasterSalesCreationAssignee(context.loginEmail, normalize(requestedAssignedStaffId));
  if (!owner) {
    throw Error('Select an active salesperson with customer creation access in LTPOS.');
  }
  return { ...owner, loginEmail: context.loginEmail };
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

  const customerRecord = customerResult.items[0];
  if (upper(customerRecord.title) !== customer.companyName) {
    if (upper(existingAccess.status) === 'ACTIVE') {
      return { ok: false, requiresExistingBuyerLogin: true };
    }
    throw new Error('An active existing Buyer Room login is required.');
  }
  if (normalize(customerRecord.assignedStaffId) !== staff.staffId) {
    throw new Error('This customer belongs to another salesperson.');
  }
  if (!isWebQuotationCustomer(customerRecord)) {
    throw new Error('This customer registration requires admin review.');
  }
  return activateWebQuotationCustomer({ customerRecord, userRecord: existingAccess, staff });
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


function normalizeAndValidate(raw) {
  const p = {
    companyName: upper(raw.companyName),
    customerShortName: validateCustomerShortName(raw.customerShortName),
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

function validateCustomerShortName(value) {
  const normalized = upper(value).replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 24) {
    throw new Error('CUSTOMER SHORT NAME must contain 2 to 24 characters.');
  }
  if (!/^[A-Z0-9][A-Z0-9 .&'()/-]*$/.test(normalized)) {
    throw new Error('CUSTOMER SHORT NAME contains unsupported characters.');
  }
  return normalized;
}

function isCompletedProgressLine(line = {}) {
  const status = upper(line.lineStatus || line.progressStatus || line.status);
  return Boolean(
    line.shippedOn ||
    line.shippedAt ||
    line.cancelledAt ||
    status.includes('SHIP') ||
    status.includes('CANCEL') ||
    status === 'COMPLETED'
  );
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
  requireStaffCustomerAccess(staff, 'VIEW', normalizedCustomerId);
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
    if (action === 'QD_OPENED') requireStaffCustomerAccess(staff, 'EDIT_QUOTATION', customer.customerId);

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
        entityId: customer ? normalize(customer.customerId) : upper(staff.staffId),
        action,
        fieldId: '',
        fieldLabel: normalize(payload?.fieldLabel || detail),
        beforeValue: '',
        afterValue: customerName,
        changedAt,
        changedByStaffId: upper(staff.staffId),
        changedByStaffName: normalize(staff.staffName || staff.staffId),
        changedByEmail: normalizeEmail(staff.loginEmail),
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

export const salesRoomShipment = webMethod(Permissions.SiteMember,async(customerId,company,action,requestId,input)=>{if(['CHAT_LIST','CHAT_PAGE','CHAT_SAVE','DOCUMENT'].includes(action))throw Error('Use Support for customer documents and department communication.');const staff=await requireAuthorizedStaffContext();const customer=await findAuthorizedCustomer(customerId,staff,['HISTORY','READ'].includes(action)?'VIEW':'EDIT_REVIEW_QTY');return requestMasterFulfilment({customerId:normalize(customer.customerId),customerName:normalize(customer.companyName)||normalize(customer.customerId),company,staff,action,requestId,input});});
