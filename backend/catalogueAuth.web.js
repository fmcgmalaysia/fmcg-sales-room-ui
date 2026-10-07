import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { request as httpsRequest } from 'https';
import { createBuyerSelectionExportToken } from 'backend/buyerSelectionExportToken.js';
import { createBuyerOrderExportToken } from 'backend/buyerOrderExportToken.js';
import { buildBuyerOrderDownload } from 'backend/buyerOrderDownload.js';
import { createBuyerSelectionMediaDownload } from 'backend/buyerSelectionDownload.js';

const CUSTOMER_COLLECTION = 'WixCustomers';
const CUSTOMER_USER_COLLECTION = 'WixCustomerUsers';
const STAFF_COLLECTION = 'StaffMaster';
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const SUBCATEGORY_COLLECTION = 'subCategories';
const BUYER_LIST_COLLECTION = 'WixBuyerListItems';
const DEFAULT_SELECTION_LIMIT = 100;
const SELECTION_LIMITS = new Set([100, 300, 500, 700]);
function selectionLimit(customer) { const value = Number(customer?.selectionLimit); return SELECTION_LIMITS.has(value) ? value : DEFAULT_SELECTION_LIMIT; }
const BUYER_ORDER_COLLECTION = 'WixBuyerOrders';
const BUYER_LINE_COLLECTION = 'WixBuyerOrderLines';
const BUYER_ORDER_AUDIT_COLLECTION = 'WixOrderAudit';
const ACCOUNT_NOTIFICATION_COLLECTION = 'WixAccountNotifications';
const USER_AUDIT_COLLECTION = 'CustomerUserAudit';
const ORDER_PAGE_SIZE = 20;
const QD_ROUTER_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzpMXT1ap2sOXRUkCAXx3BomPQK0E-0oTp6g3tna3Rs7cGHGRU0W2qRtwnU9YcC94qv/exec';
const QD_ROUTER_SECRET = 'FMCG_QD_ROUTER_TOKEN';

function normalize(value) { return String(value ?? '').trim(); }
function upper(value) { return normalize(value).toUpperCase(); }
function normalizeEmail(value) { return normalize(value).toLowerCase(); }
function quantity(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
function money(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function hasValue(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
function referenceIds(value) { return (Array.isArray(value) ? value : value ? [value] : []).map(entry => normalize(entry?._id || entry)).filter(Boolean); }
function imageUrl(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'object') {
    const candidates = [value.url, value.id, value.src, value.fileName, value.image, value.imageInfo?.url, value.imageInfo?.id, value.media?.url, value.media?.id];
    for (const candidate of candidates) {
      const resolved = imageUrl(candidate, depth + 1);
      if (resolved) return resolved;
    }
    return '';
  }
  const raw = normalize(value);
  if (!raw) return '';
  if (raw.startsWith('{')) {
    try { return imageUrl(JSON.parse(raw), depth + 1); } catch (_) { /* Continue with string parsing. */ }
  }
  const wixImage = /^(?:wix:)?image:\/\/v1\/([^/#?]+)/i.exec(raw);
  if (wixImage) return `https://static.wixstatic.com/media/${encodeURIComponent(decodeURIComponent(wixImage[1]))}`;
  const wixCdn = /^https?:\/\/static\.wixstatic\.com\/media\/([^/#?]+)/i.exec(raw);
  if (wixCdn) return `https://static.wixstatic.com/media/${encodeURIComponent(decodeURIComponent(wixCdn[1]))}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[A-Za-z0-9_.~-]+\.(?:avif|bmp|gif|heic|jpeg|jpg|png|svg|tif|tiff|webp)$/i.test(raw)) return `https://static.wixstatic.com/media/${encodeURIComponent(raw)}`;
  return '';
}
function memberEmail(member) {
  const candidate = member?.loginEmail || member?.contactDetails?.email || member?.contactDetails?.emails?.[0];
  return normalizeEmail(typeof candidate === 'string' ? candidate : candidate?.email);
}
function payloadData(record) {
  const raw = record?.payload;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw || '{}')); } catch (_) { return {}; }
}
async function productsByIds(ids) {
  const products = [];
  for (let index = 0; index < ids.length; index += 100) {
    const result = await wixData.query(PRODUCT_COLLECTION).hasSome('_id', ids.slice(index, index + 100)).limit(100).find({ suppressAuth: true });
    products.push(...result.items);
  }
  return products;
}
async function productsByBarcodes(barcodes) {
  const matches = [];
  for (let index = 0; index < barcodes.length; index += 20) {
    const batch = await Promise.all(barcodes.slice(index, index + 20).map(async barcode => {
    try {
      const textMatch = await wixData.query(PRODUCT_COLLECTION).eq('barcode', barcode).limit(1).find({ suppressAuth: true, consistentRead: true });
      if (textMatch.items[0]) return textMatch.items[0];
    } catch (_) { /* Retry numeric barcode below. */ }
    const numericBarcode = Number(barcode);
    if (!Number.isFinite(numericBarcode)) return null;
    try {
      const numberMatch = await wixData.query(PRODUCT_COLLECTION).eq('barcode', numericBarcode).limit(1).find({ suppressAuth: true, consistentRead: true });
      return numberMatch.items[0] || null;
    } catch (_) { return null; }
    }));
    matches.push(...batch);
  }
  return matches.filter(Boolean);
}
async function productCategoryContext(products) {
  const referencedIds = [...new Set(products.flatMap(product => referenceIds(product.subCategories)))];
  const map = new Map();
  for (let index = 0; index < referencedIds.length; index += 100) {
    const result = await wixData.query(SUBCATEGORY_COLLECTION).hasSome('_id', referencedIds.slice(index, index + 100)).limit(100).find({ suppressAuth: true });
    result.items.forEach(item => map.set(normalize(item._id), upper(item.mainCategory)));
  }
  // Wix does not consistently return multi-reference values on product rows.
  // Match the Catalogue's authoritative FOOD query so older selections still
  // receive the correct category even when product.subCategories is omitted.
  const foodSubResult = await wixData.query(SUBCATEGORY_COLLECTION).startsWith('mainCategory', 'FOOD').limit(1000).find({ suppressAuth: true });
  const foodSubCategoryIds = foodSubResult.items.map(item => normalize(item._id)).filter(Boolean);
  const productIds = [...new Set(products.map(product => normalize(product._id)).filter(Boolean))];
  const foodProductIds = new Set();
  if (foodSubCategoryIds.length) {
    for (let index = 0; index < productIds.length; index += 100) {
      const result = await wixData.query(PRODUCT_COLLECTION)
        .hasSome('_id', productIds.slice(index, index + 100))
        .hasSome('subCategories', foodSubCategoryIds)
        .limit(100)
        .find({ suppressAuth: true });
      result.items.forEach(item => foodProductIds.add(normalize(item._id)));
    }
  }
  return { map, foodProductIds };
}
async function putPayload(collectionId, title, payload) {
  const result = await wixData.query(collectionId).eq('title', normalize(title)).limit(2).find({ suppressAuth: true, consistentRead: true });
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
    if (!result.items.length && payload.requestId) next._id = normalize(payload.requestId);
  }
  if (collectionId === BUYER_LINE_COLLECTION) next.orderId = normalize(payload.orderId);
  if (collectionId === BUYER_LINE_COLLECTION && !result.items.length && payload.requestId) next._id = normalize(payload.requestId) + ':' + normalize(payload.lineId);
  if (collectionId === BUYER_ORDER_AUDIT_COLLECTION && !result.items.length && payload.requestId) next._id = 'A-' + normalize(payload.requestId);
  if (result.items.length) return wixData.update(collectionId, next, { suppressAuth: true });
  try { return await wixData.insert(collectionId, next, { suppressAuth: true }); }
  catch (error) {
    if (!next._id) throw error;
    let existing;
    try { existing = await wixData.get(collectionId, next._id, { suppressAuth: true, consistentRead: true }); }
    catch (_) { throw error; }
    if (normalize(existing.title) !== normalize(title)) throw error;
    return existing;
  }
}
async function signedInMember() {
  try { return await currentMember.getMember({ fieldsets: ['FULL'] }); } catch (_) { return null; }
}
async function requireStaff(member) {
  const memberId = normalize(member?._id);
  const email = memberEmail(member);
  let matches = memberId ? (await wixData.query(STAFF_COLLECTION).eq('wixMemberId', memberId).limit(2).find({ suppressAuth: true })).items : [];
  if (!matches.length && email) matches = (await wixData.query(STAFF_COLLECTION).eq('staffEmail', email).limit(2).find({ suppressAuth: true })).items;
  if (matches.length !== 1 || upper(matches[0].status) !== 'ACTIVE') throw new Error('Active staff authorization is required.');
  const staff = matches[0];
  const role = upper(staff.role);
  return { staffId: upper(staff.staffId), staffName: normalize(staff.title || staff.staffName || staff.staffId), email, role, canViewAllCustomers: ['ADMIN', 'SUPER ADMIN'].includes(role) };
}
async function customerById(customerId) {
  const result = await wixData.query(CUSTOMER_COLLECTION).eq('customerId', normalize(customerId)).limit(2).find({ suppressAuth: true });
  if (result.items.length !== 1) throw new Error('Customer account was not found.');
  return result.items[0];
}
function ensureActive(customer) {
  const lifecycle = upper(customer.lifecycleStatus || customer.customerStatus);
  const access = upper(customer.catalogueAccessStatus || customer.accessStatus || customer.customerStatus);
  if (lifecycle === 'ARCHIVED' || ['SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(access)) throw new Error('This customer account is suspended.');
}
function contextFromCustomer(customer, actor) {
  return { customerId: normalize(customer.customerId || customer._id), companyName: normalize(customer.title), email: normalizeEmail(actor.email), actorName: normalize(actor.name || actor.email), actorType: actor.type, actorUserId: normalize(actor.userId), primaryUser: Boolean(actor.primaryUser), currency: upper(customer.preferredCurrency || customer.tradingCurrency || 'USD'), selectionLimit: selectionLimit(customer), status: 'ACTIVE', qdFileId: normalize(customer.qdFileId), assignedStaffId: upper(customer.assignedStaffId) };
}

function httpsCall(url, options, body = '') {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, options, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: Number(response.statusCode || 0), headers: response.headers || {}, text }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Quotation Desk service timed out.')));
    if (body) req.write(body);
    req.end();
  });
}
async function routeQdAction(action, buyer, row) {
  if (!buyer.qdFileId) throw new Error('Quotation Desk file is not configured.');
  const payload = JSON.stringify({
    action,
    sharedSecret: await getSecret(QD_ROUTER_SECRET),
    customerId: buyer.customerId,
    assignedStaffId: buyer.assignedStaffId,
    qdFileId: buyer.qdFileId,
    wixMyListId: normalize(row.record._id || row.data.id || row.data.itemId),
    unitBarcode: normalize(row.data.unitBarcode || row.data.barcode)
  });
  let response = await httpsCall(QD_ROUTER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, payload);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
    if (!location) throw new Error('Quotation Desk redirect is missing.');
    response = await httpsCall(new URL(location, QD_ROUTER_ENDPOINT).toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  }
  let body = {};
  try { body = JSON.parse(response.text || '{}'); } catch (_) { /* handled below */ }
  if (response.status < 200 || response.status >= 300 || !body.ok) throw new Error(body.error || 'Quotation Desk update failed.');
  return body.result || {};
}
async function resolveBuyerContext(assistCustomerId = '') {
  const member = await signedInMember();
  if (!member?._id) throw new Error('Sign in is required.');
  const requestedId = normalize(assistCustomerId);
  if (requestedId) {
    const staff = await requireStaff(member);
    const customer = await customerById(requestedId);
    if (!staff.canViewAllCustomers && upper(customer.assignedStaffId) !== staff.staffId) throw new Error('This customer is assigned to another salesperson.');
    ensureActive(customer);
    return {
      ...contextFromCustomer(customer, { email: staff.email, name: staff.staffName, type: staff.canViewAllCustomers ? 'ADMIN' : 'STAFF' }),
      actorStaffId: staff.staffId,
      actorRole: staff.role
    };
  }
  const memberId = normalize(member._id);
  const email = memberEmail(member);
  let matches = memberId ? (await wixData.query(CUSTOMER_USER_COLLECTION).eq('wixMemberId', memberId).limit(2).find({ suppressAuth: true })).items : [];
  if (!matches.length && email) matches = (await wixData.query(CUSTOMER_USER_COLLECTION).eq('email', email).limit(2).find({ suppressAuth: true })).items;
  if (matches.length !== 1) throw new Error(matches.length > 1 ? 'Duplicate customer login records require admin review.' : 'This member is not linked to a customer account.');
  const user = matches[0];
  if (upper(user.status) !== 'ACTIVE') throw new Error('This customer user is not active.');
  if (!normalize(user.wixMemberId)) await wixData.update(CUSTOMER_USER_COLLECTION, { ...user, wixMemberId: memberId }, { suppressAuth: true });
  const customer = await customerById(user.customerId);
  ensureActive(customer);
  const resolvedUserId = normalize(user.userId || user._id);
  const isPrimary = normalize(customer.primaryUserId) === resolvedUserId || Boolean(user.primaryUser);
  return contextFromCustomer(customer, { email, name: user.title || email, type: 'CUSTOMER_USER', userId: resolvedUserId, primaryUser: isPrimary });
}
async function workspaceItems(customerId) {
  let result = await wixData.query(BUYER_LIST_COLLECTION).eq('customerId', normalize(customerId)).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const records = [...result.items];
  while (result.hasNext()) { result = await result.next(); records.push(...result.items); }
  const rows = records.map(record => ({ record, data: payloadData(record) })).filter(entry => normalize(entry.data.customerId) === normalize(customerId));
  const productIds = [...new Set(rows.map(entry => normalize(entry.data.productId)).filter(Boolean))];
  const barcodes = [...new Set(rows.map(entry => normalize(entry.data.barcode || entry.data.unitBarcode)).filter(Boolean))];
  const products = await productsByIds(productIds);
  const resolvedBarcodes = new Set(products.map(product => normalize(product.barcode)).filter(Boolean));
  const barcodeProducts = await productsByBarcodes(barcodes.filter(barcode => !resolvedBarcodes.has(barcode)));
  products.push(...barcodeProducts);
  const categoryContext = await productCategoryContext(products);
  const byProductId = new Map();
  const byBarcode = new Map();
  products.forEach(product => {
    byProductId.set(normalize(product._id), product);
    const barcode = normalize(product.barcode);
    if (barcode) byBarcode.set(barcode, product);
  });
  return rows.map(({ record, data }) => {
    const safeData = { ...data };
    delete safeData.targetGp;
    delete safeData.quoteActorEmail;
    delete safeData.quoteRequestId;
    // Keep the one-generation quotation snapshot in CMS for a future internal
    // workflow, but never expose historical prices to Buyer Room clients.
    delete safeData.previousQuote;
    const storedBarcode = normalize(data.barcode || data.unitBarcode);
    const product = byProductId.get(normalize(data.productId)) || byBarcode.get(storedBarcode) || {};
    const id = normalize(record._id || data.id || data.itemId);
    const ea = money(data.ea || product.ea || product.price);
    const category = normalize(data.category || data.mainCategory || (categoryContext.foodProductIds.has(normalize(product._id)) ? 'FOOD' : '') || product.mainCategory || referenceIds(product.subCategories).map(id => categoryContext.map.get(id)).find(Boolean));
    return {
      ...safeData, id, itemId: id,
      barcode: normalize(data.barcode || data.unitBarcode || product.barcode),
      itemName: normalize(data.itemName || product.name || product.title),
      // Current selections follow the latest Catalogue packing size. Keep the
      // stored value only when the product is unavailable in Catalogue CMS.
      packingSize: normalize(product.description || data.packingSize),
      brand: normalize(data.brand || product.brandName || product.principle),
      brandName: normalize(product.brandName),
      sortNo: normalize(product.pointBaseSortId),
      category,
      imageUrl: imageUrl(data.imageUrl || data.image || product.image || product.productImage || product.mainImage || product.wixImageUrl),
      ea,
      // Read EA (pieces per carton) from the dedicated Catalogue CMS field.
      // Read it afresh for exports instead of trusting an older selection payload.
      catalogueEa: hasValue(product.ea) ? money(product.ea) : null,
      // Point Base sync writes CBM /CTN to FMCGMALAYSIA.m3Ctn. An older
      // selection payload must not mask a newer CMS value, including zero.
      cbmPerCtn: money(hasValue(product.m3Ctn) ? product.m3Ctn : hasValue(product.cbmPerCtn) ? product.cbmPerCtn : hasValue(product.cbm) ? product.cbm : data.cbmPerCtn),
      normalPriceEa: 0, normalPriceCtn: 0,
      vipPriceEa: money(data.vipPriceEa || data.quotePerPc), vipPriceCtn: money(data.vipPriceCtn || data.quotePerCtn || data.vipPrice),
      // A stored price is not a released quotation. Only the QD sync endpoint is
      // allowed to promote an item to VIEW QUOTE.
      quoteStatus: upper(data.quoteStatus || 'RFQ'),
      quoteActive: upper(data.quoteStatus || 'RFQ') === 'VIEW QUOTE',
      quoteEffectiveAt: data.quoteEffectiveAt || data.quoteSyncedAt || '',
      addedTime: data.addedTime || data.selectedAt || record._createdDate || '',
      selectedByName: normalize(data.selectedByName || data.selectedById),
      lastEditedBy: normalize(data.lastEditedBy || data.selectedByName),
      qtyEditedAt: normalize(data.qtyEditedAt), qtyEditedBy: normalize(data.qtyEditedBy)
    };
  });
}

async function buyerOrderHistory(customerId, cursor = '') {
  const visible = [];
  let scanCursor = normalize(cursor);
  while (visible.length <= ORDER_PAGE_SIZE) {
    let query = wixData.query(BUYER_ORDER_COLLECTION).eq('customerId', normalize(customerId)).eq('isComplete', true);
    if (scanCursor) query = query.lt('orderSortKey', scanCursor);
    const result = await query.descending('orderSortKey').limit(ORDER_PAGE_SIZE + 1).find({ suppressAuth: true, consistentRead: true });
    for (const record of result.items) {
      if (!payloadData(record).receiptOnly) visible.push(record);
      if (visible.length > ORDER_PAGE_SIZE) break;
    }
    if (visible.length > ORDER_PAGE_SIZE || result.items.length <= ORDER_PAGE_SIZE) break;
    scanCursor = normalize(result.items[result.items.length - 1].orderSortKey);
  }
  const page = visible.slice(0, ORDER_PAGE_SIZE);
  return {
    orders: page.map(record => payloadData(record)),
    nextCursor: visible.length > ORDER_PAGE_SIZE ? normalize(page[page.length - 1].orderSortKey) : ''
  };
}

async function customerUserDirectory(customerId = '') {
  const result = await wixData.query(CUSTOMER_USER_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true });
  return result.items.filter(user => !customerId || normalize(user.customerId) === normalize(customerId));
}

function userCountsTowardLimit(user) {
  return ['ACTIVE', 'PENDING'].includes(upper(user?.status));
}

function publicUser(user, primaryUserId = '') {
  const id = normalize(user.userId || user._id);
  return {
    userId: id,
    name: normalize(user.title),
    email: normalizeEmail(user.email),
    mobile: normalize(user.mobileNo),
    status: upper(user.status),
    primary: primaryUserId ? id === primaryUserId : Boolean(user.primaryUser),
    inviteStatus: upper(user.inviteStatus || (normalize(user.wixMemberId) ? 'JOINED' : 'NOT SENT')),
    requestedAt: user.requestedAt || user._createdDate || null,
    requestSource: upper(user.requestSource)
  };
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

async function buyerNotifications(customerId, actorUserId) {
  let result;
  try { result = await wixData.query(ACCOUNT_NOTIFICATION_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true }); }
  catch (_) { return []; }
  return result.items
    .map(record => ({ record, data: payloadData(record) }))
    .filter(({ data }) => normalize(data.customerId) === normalize(customerId) && (!normalize(data.recipientUserId) || normalize(data.recipientUserId) === normalize(actorUserId)))
    .map(({ data }) => ({
      eventId: normalize(data.eventId), type: upper(data.type), heading: normalize(data.heading), message: normalize(data.message),
      targetUserId: normalize(data.targetUserId), createdAt: data.createdAt || null,
      read: Array.isArray(data.readByUserIds) && data.readByUserIds.map(normalize).includes(normalize(actorUserId))
    }))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 50);
}

async function writeBuyerUserAudit(action, customerId, userId, beforeStatus, afterStatus, buyer) {
  const changedAt = new Date().toISOString();
  const auditId = `AUD-${changedAt.replace(/\D/g, '').slice(0, 17)}-01-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  await wixData.insert(USER_AUDIT_COLLECTION, {
    title: auditId, auditId, action: upper(action), customerId: normalize(customerId), entityId: normalize(userId),
    fieldId: 'status', fieldLabel: 'USER ACCESS', beforeValue: normalize(beforeStatus), afterValue: normalize(afterStatus),
    changedAt, changedByStaffId: normalize(buyer.actorStaffId), changedByStaffName: normalize(buyer.actorName),
    changedByEmail: normalizeEmail(buyer.email), changedByRole: buyer.actorType === 'ADMIN' ? normalize(buyer.actorRole) || 'ADMIN' : 'CUSTOMER PRIMARY'
  }, { suppressAuth: true });
}

export const getCurrentBuyerContext = webMethod(Permissions.SiteMember, async (assistCustomerId = '') => {
  try { return { ok: true, buyer: await resolveBuyerContext(assistCustomerId) }; } catch (error) { return { ok: false, reason: normalize(error?.message || error) }; }
});
export const getBuyerWorkspace = webMethod(Permissions.SiteMember, async (assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const [items, orderPage, customer, userResult, notifications] = await Promise.all([
    workspaceItems(buyer.customerId),
    buyerOrderHistory(buyer.customerId),
    customerById(buyer.customerId),
    wixData.query(CUSTOMER_USER_COLLECTION).eq('customerId', buyer.customerId).limit(100).find({ suppressAuth: true }),
    buyerNotifications(buyer.customerId, buyer.actorUserId)
  ]);
  const configuredPrimaryId = normalize(customer.primaryUserId);
  const users = userResult.items.map(user => publicUser(user, configuredPrimaryId));
  const primary = users.find(user => user.primary) || null;
  const account = {
    customerId: buyer.customerId,
    companyName: normalize(customer.title),
    country: normalize(customer.country),
    natureOfBusiness: normalize(customer.natureOfBusiness),
    address: [customer.address1, customer.address2, customer.address3].map(normalize).filter(Boolean).join(', '),
    website: normalize(customer.companyWebsite),
    currency: buyer.currency,
    destinationPorts: [customer.destinationPortName, customer.destinationPortName2, customer.destinationPortName3].map(normalize),
    primary: {
      name: primary?.name || normalize(customer.picName),
      email: primary?.email || normalizeEmail(customer.primaryEmail),
      mobile: primary?.mobile || normalize(customer.mobileNo),
      title: normalize(customer.picTitle)
    },
    users: users.filter(user => !['REJECTED', 'REVOKED'].includes(user.status)),
    canManageUsers: ['CUSTOMER_USER', 'ADMIN'].includes(buyer.actorType),
    userCount: users.filter(user => ['ACTIVE', 'PENDING'].includes(user.status)).length
  };
  const removed = items.filter(item => item.removed).map(item => {
    const { normalPriceEa, normalPriceCtn, vipPriceEa, vipPriceCtn, vipPrice,
      quotePerPc, quotePerCtn, pricePerPc, pricePerCtn, previousQuote,
      targetGp, ...withoutPrices } = item;
    return withoutPrices;
  });
  return { ok: true, context: buyer, account, notifications, myList: items.filter(item => !item.removed), removed, orders: orderPage.orders, ordersNextCursor: orderPage.nextCursor };
});

export const requestBuyerCustomerUser = webMethod(Permissions.SiteMember, async (payload = {}, requestId = '', assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  if (!['CUSTOMER_USER', 'ADMIN'].includes(buyer.actorType)) throw new Error('Only an active customer user or Admin can request another user.');
  const input = payload && typeof payload === 'object' ? payload : {};
  const name = normalize(input.name);
  const email = normalizeEmail(input.email);
  const mobile = normalize(input.mobile);
  const requestKey = normalize(requestId);
  if (!name || name.length > 120) throw new Error('Enter the user name.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid work email.');
  if (!/^\+?[0-9 ()-]{7,24}$/.test(mobile)) throw new Error('Enter a valid international mobile number.');
  if (!requestKey || requestKey.length > 100) throw new Error('A valid request reference is required.');

  const allUsers = await customerUserDirectory();
  const repeated = allUsers.find(user => normalize(user.requestId) === requestKey && normalize(user.customerId) === buyer.customerId);
  if (repeated) return { ok: true, user: publicUser(repeated), duplicateRequest: true };
  const customerUsers = allUsers.filter(user => normalize(user.customerId) === buyer.customerId);
  const emailMatch = allUsers.find(user => normalizeEmail(user.email) === email);
  if (emailMatch && normalize(emailMatch.customerId) !== buyer.customerId) throw new Error('This email is assigned to another customer account. Admin review is required.');
  if (emailMatch && ['ACTIVE', 'PENDING'].includes(upper(emailMatch.status))) throw new Error('This email is already listed for this customer.');
  if (customerUsers.filter(userCountsTowardLimit).length >= 5) throw new Error('This customer already has the maximum of 5 users.');

  const now = new Date();
  const userId = normalize(emailMatch?.userId) || `USR-${buyer.customerId}-${now.getTime().toString(36).toUpperCase()}`;
  const next = {
    ...(emailMatch || {}), title: name, userId, customerId: buyer.customerId, email, mobileNo: mobile,
    primaryUser: false, status: 'PENDING', requestId: requestKey, requestSource: 'BUYER ROOM',
    requestActorType: buyer.actorType,
    requestedAt: now, requestedByUserId: buyer.actorUserId,
    failedLoginCount: Number(emailMatch?.failedLoginCount || 0)
  };
  const saved = emailMatch
    ? await wixData.update(CUSTOMER_USER_COLLECTION, next, { suppressAuth: true })
    : await wixData.insert(CUSTOMER_USER_COLLECTION, next, { suppressAuth: true });
  await Promise.allSettled([
    writeBuyerUserAudit('CUSTOMER_USER_REQUESTED', buyer.customerId, userId, upper(emailMatch?.status), 'PENDING', buyer),
    putAccountNotification({ eventId: `USER-REQUESTED-${requestKey}`, customerId: buyer.customerId, recipientUserId: buyer.actorUserId, type: 'USER REQUEST', heading: 'User request submitted', message: `${name} is pending salesperson approval.`, targetUserId: userId })
  ]);
  return { ok: true, user: publicUser(saved), message: 'User request submitted for salesperson approval.' };
});

export const setBuyerPrimaryUser = webMethod(Permissions.SiteMember, async (targetUserId, requestId = '', assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  if (!['CUSTOMER_USER', 'ADMIN'].includes(buyer.actorType)) throw new Error('Only an active customer user or Admin can transfer Primary access.');
  const targetId = normalize(targetUserId);
  const requestKey = normalize(requestId);
  if (!targetId || !requestKey) throw new Error('Select an active user and try again.');
  const customer = await customerById(buyer.customerId);
  const users = await customerUserDirectory(buyer.customerId);
  const target = users.find(user => normalize(user.userId || user._id) === targetId);
  if (!target || upper(target.status) !== 'ACTIVE') throw new Error('Primary access can only be transferred to an active user.');
  const oldPrimaryId = normalize(customer.primaryUserId) || buyer.actorUserId;
  if (oldPrimaryId === targetId) return { ok: true, unchanged: true };

  await wixData.update(CUSTOMER_COLLECTION, { ...customer, primaryUserId: targetId }, { suppressAuth: true });
  for (const user of users) {
    const id = normalize(user.userId || user._id);
    if (Boolean(user.primaryUser) !== (id === targetId)) await wixData.update(CUSTOMER_USER_COLLECTION, { ...user, primaryUser: id === targetId }, { suppressAuth: true });
  }
  await writeBuyerUserAudit('PRIMARY_USER_CHANGED', buyer.customerId, targetId, oldPrimaryId, targetId, buyer);
  await Promise.all([
    putAccountNotification({ eventId: `PRIMARY-OLD-${requestKey}`, customerId: buyer.customerId, recipientUserId: oldPrimaryId, type: 'PRIMARY USER', heading: 'Primary User changed', message: `${normalize(target.title) || target.email} is now the Primary User.`, targetUserId: targetId }),
    putAccountNotification({ eventId: `PRIMARY-NEW-${requestKey}`, customerId: buyer.customerId, recipientUserId: targetId, type: 'PRIMARY USER', heading: 'You are now the Primary User', message: 'You can manage customer user requests from Account.', targetUserId: targetId })
  ]);
  return { ok: true, customerId: buyer.customerId, primaryUserId: targetId };
});

export const markBuyerAccountNotificationsRead = webMethod(Permissions.SiteMember, async (eventIds = [], assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  if (!buyer.actorUserId) return { ok: true, changed: 0 };
  const wanted = new Set((Array.isArray(eventIds) ? eventIds : []).map(normalize).filter(Boolean).slice(0, 50));
  if (!wanted.size) return { ok: true, changed: 0 };
  const result = await wixData.query(ACCOUNT_NOTIFICATION_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true });
  let changed = 0;
  for (const record of result.items) {
    const data = payloadData(record);
    if (!wanted.has(normalize(data.eventId)) || normalize(data.customerId) !== buyer.customerId) continue;
    if (normalize(data.recipientUserId) && normalize(data.recipientUserId) !== buyer.actorUserId) continue;
    const readBy = new Set(Array.isArray(data.readByUserIds) ? data.readByUserIds.map(normalize) : []);
    if (readBy.has(buyer.actorUserId)) continue;
    readBy.add(buyer.actorUserId);
    await putPayload(ACCOUNT_NOTIFICATION_COLLECTION, data.eventId, { ...data, readByUserIds: [...readBy] });
    changed += 1;
  }
  return { ok: true, changed };
});
export const createBuyerSelectionDownload = webMethod(Permissions.SiteMember, async (assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  return createBuyerSelectionMediaDownload(buyer.customerId, 'https://fmcg999.wixstudio.com/fmcgmalaysia/buyer-room');
});
export const createBuyerOrderDownload = webMethod(Permissions.SiteMember, async (orderId, assistCustomerId = '', buyerRoomUrl = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const id = normalize(orderId);
  const roomUrl = /^https:\/\//i.test(normalize(buyerRoomUrl)) ? normalize(buyerRoomUrl) : 'https://fmcg999.wixstudio.com/fmcgmalaysia/buyer-room';
  let file;
  let lastError;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      file = await buildBuyerOrderDownload(buyer.customerId, id, roomUrl);
      break;
    } catch (error) {
      lastError = error;
      if (!['Order was not found.', 'Order is not ready for download.', 'Order lines are incomplete.'].includes(normalize(error?.message))) throw error;
      if (attempt < 15) await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (!file) throw lastError || new Error('Order Excel could not be created.');
  return { ok: true, orderId: id, fileName: file.fileName, base64: file.bytes.toString('base64') };
});
export const prepareBuyerOrderDownload = webMethod(Permissions.SiteMember, async (requestId = '', assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const submissionId = normalize(requestId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new Error('Please refresh the order form and try again.');
  }
  const orderId = nextOrderId(buyer.customerId, submissionId);
  const issued = createBuyerOrderExportToken(buyer.customerId, orderId, await getSecret(QD_ROUTER_SECRET), 900);
  return { ok: true, orderId, ...issued };
});
export const getBuyerOrderPage = webMethod(Permissions.SiteMember, async (cursor = '', assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  return { ok: true, customerId: buyer.customerId, ...(await buyerOrderHistory(buyer.customerId, cursor)) };
});
export const getBuyerOrderDetail = webMethod(Permissions.SiteMember, async (orderId, assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const result = await wixData.query(BUYER_ORDER_COLLECTION).eq('orderId', normalize(orderId)).eq('customerId', buyer.customerId).limit(2).find({ suppressAuth: true, consistentRead: true });
  if (result.items.length !== 1 || !result.items[0].isComplete) throw new Error('Order was not found.');
  let linesResult = await wixData.query(BUYER_LINE_COLLECTION).eq('customerId', buyer.customerId).eq('orderId', normalize(orderId)).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const lines = [...linesResult.items];
  while (linesResult.hasNext()) { linesResult = await linesResult.next(); lines.push(...linesResult.items); }
  let auditResult = await wixData.query(BUYER_ORDER_AUDIT_COLLECTION).contains('payload', '"orderId":' + JSON.stringify(normalize(orderId))).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const audits = [...auditResult.items];
  while (auditResult.hasNext()) { auditResult = await auditResult.next(); audits.push(...auditResult.items); }
  const editHistory = audits.map(payloadData).filter(audit => normalize(audit.customerId) === buyer.customerId && normalize(audit.orderId) === normalize(orderId) && ['SALES_QTY_UPDATED', 'BUYER_REDUCED_ORDER_LINE', 'BUYER_CANCELLED_ORDER_LINE', 'BUYER_ADDED_ORDER_LINE'].includes(audit.action));
  return { ok: true, customerId: buyer.customerId, order: { ...payloadData(result.items[0]), lines: lines.map(payloadData).filter(line => normalize(line.customerId) === buyer.customerId && !line.addedToOrderId).sort((a, b) => normalize(a.lineId).localeCompare(normalize(b.lineId))), editHistory } };
});
async function findOwnedItem(buyer, itemId) {
  let record = null;
  try { record = await wixData.get(BUYER_LIST_COLLECTION, normalize(itemId), { suppressAuth: true, consistentRead: true }); } catch (_) { /* Not found. */ }
  if (!record || normalize(payloadData(record).customerId) !== buyer.customerId) throw new Error('Buyer list item was not found.');
  return { record, data: payloadData(record) };
}
async function activeBuyerSelectionCount(customerId, limit) {
  let result = await wixData.query(BUYER_LIST_COLLECTION).eq('customerId', normalize(customerId)).eq('removed', false).limit(1000).find({ suppressAuth: true, consistentRead: true });
  let count = 0;
  do {
    count += result.items.filter(record => !payloadData(record).removed).length;
    if (count >= limit) return count;
    if (!result.hasNext()) break;
    result = await result.next();
  } while (true);
  return count;
}
function releasedOrderPrice(data) {
  if (upper(data.quoteStatus) !== 'VIEW QUOTE') return 0;
  return money(data.vipPriceCtn || data.quotePerCtn) || (money(data.vipPriceEa || data.quotePerPc) * money(data.ea));
}
export const saveBuyerQuantity = webMethod(Permissions.SiteMember, async (itemId, quantityCtn, assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const row = await findOwnedItem(buyer, itemId);
  if (row.data.removed) throw new Error('Recover this item before entering an order quantity.');
  const requestedQuantity = quantity(quantityCtn);
  if (requestedQuantity > 0 && !(releasedOrderPrice(row.data) > 0)) throw new Error('Order quantity becomes available after the V.I.P price is released.');
  if (requestedQuantity === quantity(row.data.orderQtyCtn)) return { ok: true, itemId: normalize(itemId), quantityCtn: requestedQuantity, qtyEditedAt: normalize(row.data.qtyEditedAt), qtyEditedBy: normalize(row.data.qtyEditedBy) };
  const now = new Date().toISOString();
  const actor = buyer.actorName || buyer.email;
  const next = { ...row.data, orderQtyCtn: requestedQuantity, qtyEditedAt: now, qtyEditedBy: actor, updatedAt: now, lastEditedBy: actor };
  await putPayload(BUYER_LIST_COLLECTION, row.record.title, next);
  return { ok: true, itemId: normalize(itemId), quantityCtn: next.orderQtyCtn, qtyEditedAt: now, qtyEditedBy: actor };
});
export const reduceBuyerOrderLine = webMethod(Permissions.SiteMember, async (orderId, lineId, newQuantityCtn, requestId = '', assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  throw new Error('Submitted orders are locked. Please contact your salesperson to request changes.');
  const id = normalize(orderId);
  const lineKey = normalize(lineId);
  const reductionId = normalize(requestId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reductionId)) throw new Error('Please refresh Track Orders and try again.');
  const auditTitle = 'BUYER-REDUCTION-' + reductionId;
  const existingAudit = await wixData.query(BUYER_ORDER_AUDIT_COLLECTION).eq('title', auditTitle).limit(2).find({ suppressAuth: true, consistentRead: true });
  if (existingAudit.items.length) {
    const audit = payloadData(existingAudit.items[0]);
    if (normalize(audit.customerId) !== buyer.customerId || normalize(audit.orderId) !== id || normalize(audit.lineId) !== lineKey) throw new Error('Reduction request conflict. Please contact Sales Room.');
    return { ok: true, orderId: id, lineId: lineKey, quantityCtn: quantity(audit.newQuantityCtn), reductionQtyCtn: quantity(audit.reductionQtyCtn), message: 'Reduction request already recorded.' };
  }
  const orderResult = await wixData.query(BUYER_ORDER_COLLECTION).eq('orderId', id).eq('customerId', buyer.customerId).limit(2).find({ suppressAuth: true, consistentRead: true });
  if (orderResult.items.length !== 1) throw new Error('Order was not found.');
  const orderRecord = orderResult.items[0];
  const order = payloadData(orderRecord);
  if (upper(order.status).startsWith('SUBMITTED TO ')) throw new Error('Requested quantity is locked after submission to NCT / GHR.');
  const lineResult = await wixData.query(BUYER_LINE_COLLECTION).eq('orderId', id).eq('customerId', buyer.customerId).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const lineRecord = lineResult.items.find(record => normalize(payloadData(record).lineId) === lineKey);
  if (!lineRecord) throw new Error('Order line was not found.');
  const line = payloadData(lineRecord);
  const currentQty = quantity(hasValue(line.effectiveRequestedQtyCtn) ? line.effectiveRequestedQtyCtn : hasValue(line.requestedQtyCtn) ? line.requestedQtyCtn : line.quantityCtn);
  const nextQty = quantity(newQuantityCtn);
  if (nextQty >= currentQty) throw new Error('Reduction quantity must be below the current requested quantity.');
  const now = new Date().toISOString();
  const actor = buyer.actorName || buyer.email;
  const reductionQty = currentQty - nextQty;
  const nextLine = {
    ...line,
    originalQuantityCtn: hasValue(line.originalQuantityCtn) ? quantity(line.originalQuantityCtn) : quantity(line.quantityCtn),
    effectiveRequestedQtyCtn: nextQty,
    reductionTotalCtn: quantity(line.reductionTotalCtn) + reductionQty,
    effectiveLineAmount: Number((money(line.lockedUnitPrice) * nextQty).toFixed(2)),
    effectiveTotalCbm: Number((money(line.cbmPerCtn) * nextQty).toFixed(4)),
    lastReductionAt: now,
    lastReductionBy: actor,
    updatedAt: now
  };
  await putPayload(BUYER_LINE_COLLECTION, lineRecord.title, nextLine);
  const refreshedOrder = await wixData.query(BUYER_ORDER_COLLECTION).eq('orderId', id).eq('customerId', buyer.customerId).limit(2).find({ suppressAuth: true, consistentRead: true });
  const refreshedStatus = upper(payloadData(refreshedOrder.items[0]).status);
  if (refreshedStatus.startsWith('SUBMITTED TO ')) {
    await putPayload(BUYER_LINE_COLLECTION, lineRecord.title, line);
    throw new Error('The order was submitted to NCT / GHR while this reduction was being processed. Requested quantity remains unchanged.');
  }
  const effectiveLines = lineResult.items.map(record => normalize(payloadData(record).lineId) === lineKey ? nextLine : payloadData(record));
  const nextOrder = {
    ...order,
    originalTotalCartons: hasValue(order.originalTotalCartons) ? quantity(order.originalTotalCartons) : quantity(order.totalCartons),
    effectiveTotalCartons: effectiveLines.reduce((sum, item) => sum + quantity(hasValue(item.effectiveRequestedQtyCtn) ? item.effectiveRequestedQtyCtn : item.quantityCtn), 0),
    effectiveEstimatedTotal: Number(effectiveLines.reduce((sum, item) => sum + money(hasValue(item.effectiveLineAmount) ? item.effectiveLineAmount : item.lineAmount), 0).toFixed(2)),
    effectiveTotalCbm: Number(effectiveLines.reduce((sum, item) => sum + money(hasValue(item.effectiveTotalCbm) ? item.effectiveTotalCbm : item.totalCbm), 0).toFixed(4)),
    lastReductionAt: now,
    lastReductionBy: actor,
    revision: quantity(order.revision) + 1,
    updatedAt: now
  };
  await putPayload(BUYER_ORDER_COLLECTION, orderRecord.title, nextOrder);
  await putPayload(BUYER_ORDER_AUDIT_COLLECTION, auditTitle, { auditId: auditTitle, requestId: reductionId, action: nextQty === 0 ? 'BUYER_CANCELLED_ORDER_LINE' : 'BUYER_REDUCED_ORDER_LINE', orderId: id, lineId: lineKey, customerId: buyer.customerId, originalQuantityCtn: quantity(line.quantityCtn), previousQuantityCtn: currentQty, newQuantityCtn: nextQty, reductionQtyCtn: reductionQty, at: now, actorEmail: buyer.email, actorName: actor, actorType: buyer.actorType });
  return { ok: true, orderId: id, lineId: lineKey, quantityCtn: nextQty, reductionQtyCtn: reductionQty, message: nextQty === 0 ? 'Item cancelled before NCT / GHR submission.' : 'Reduction request recorded.' };
});
export const removeBuyerItem = webMethod(Permissions.SiteMember, async (itemId, assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const row = await findOwnedItem(buyer, itemId);
  const now = new Date().toISOString();
  let next = { ...row.data, removed: true, removedTime: now, orderQtyCtn: 0, quoteStatus: 'REMOVED', quoteActive: false,
    normalPriceEa: 0, normalPriceCtn: 0, vipPriceEa: 0, vipPriceCtn: 0, vipPrice: 0,
    quotePerPc: 0, quotePerCtn: 0, pricePerPc: 0, pricePerCtn: 0, previousQuote: null, targetGp: null,
    qdCleanupStatus: 'PENDING', qdCleanupError: '', updatedAt: now, lastEditedBy: buyer.actorName || buyer.email };
  await putPayload(BUYER_LIST_COLLECTION, row.record.title, next);
  try {
    await routeQdAction('REMOVE_SELECTION', buyer, row);
    next = { ...next, qdSyncStatus: 'REMOVED', qdCleanupStatus: 'READY', qdRow: 0, qdCleanedAt: new Date().toISOString() };
    await putPayload(BUYER_LIST_COLLECTION, row.record.title, next);
    return { ok: true, itemId: normalize(itemId), removed: true, qdCleanupStatus: 'READY' };
  } catch (error) {
    next = { ...next, qdCleanupStatus: 'FAILED', qdCleanupError: normalize(error?.message || error) };
    await putPayload(BUYER_LIST_COLLECTION, row.record.title, next);
    return { ok: true, itemId: normalize(itemId), removed: true, qdCleanupStatus: 'FAILED', warning: 'The item was removed, but Sales Room must review QD cleanup.' };
  }
});
export const recoverBuyerItem = webMethod(Permissions.SiteMember, async (itemId, assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const row = await findOwnedItem(buyer, itemId);
  if (row.data.removed && (await activeBuyerSelectionCount(buyer.customerId, buyer.selectionLimit)) >= buyer.selectionLimit) throw new Error(`My Selection is at its ${buyer.selectionLimit}-product limit. Remove an item before restoring this one.`);
  const now = new Date().toISOString();
  let next = { ...row.data, removed: false, recoveredAt: now, requoteRequestedAt: now, quoteStatus: 'RFQ', quoteActive: false, quotePerPc: 0, quotePerCtn: 0, vipPriceEa: 0, vipPriceCtn: 0, orderQtyCtn: 0, qtyEditedAt: '', qtyEditedBy: '', qdSyncStatus: 'PENDING', qdCleanupStatus: '', qdCleanupError: '', updatedAt: now, lastEditedBy: buyer.actorName || buyer.email };
  await putPayload(BUYER_LIST_COLLECTION, row.record.title, next);
  try {
    const result = await routeQdAction('ADD_SELECTION', buyer, row);
    next = { ...next, qdSyncStatus: 'READY', qdSyncedAt: new Date().toISOString(), qdRow: Number(result.qdRow || 0), lastError: '' };
    await putPayload(BUYER_LIST_COLLECTION, row.record.title, next);
    return { ok: true, itemId: normalize(itemId), removed: false, quoteStatus: 'RFQ' };
  } catch (error) {
    next = { ...next, qdSyncStatus: 'FAILED', lastError: normalize(error?.message || error) };
    await putPayload(BUYER_LIST_COLLECTION, row.record.title, next);
    return { ok: true, itemId: normalize(itemId), removed: false, quoteStatus: 'RFQ', warning: 'Re-quote requested, but Sales Room must review QD routing.' };
  }
});
function nextOrderId(customerId, requestId) { return 'ORD-' + normalize(customerId).replace(/[^A-Z0-9-]/gi, '').toUpperCase() + '-' + requestId.replace(/-/g, '').toUpperCase(); }
export const submitBuyerOrder = webMethod(Permissions.SiteMember, async (requestedLines, assistCustomerId = '', requestId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const submissionId = normalize(requestId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) throw new Error('Please refresh the order form and try again.');
  const requests = Array.isArray(requestedLines) ? requestedLines : [];
  if (!requests.length) throw new Error('Enter at least one order quantity.');
  if (requests.length > buyer.selectionLimit || new Set(requests.map(line => normalize(line.itemId))).size !== requests.length) throw new Error('Order lines are invalid. Please refresh the order form.');
  return withBuyerSubmissionLock(buyer, submissionId, async () => {
  const id = nextOrderId(buyer.customerId, submissionId);
  const requestFingerprint = JSON.stringify(requests.map(line => [normalize(line.itemId), Number(line.quantityCtn)]).sort((a, b) => a[0].localeCompare(b[0])));
  let orderRecord = null;
  try { orderRecord = await wixData.get(BUYER_ORDER_COLLECTION, submissionId, { suppressAuth: true, consistentRead: true }); } catch (_) { /* New submission. */ }
  if (orderRecord) {
    const stored = payloadData(orderRecord);
    if (normalize(stored.customerId) !== buyer.customerId || normalize(stored.orderId) !== id) throw new Error('Order request conflict. Please contact Sales Room.');
    if (stored.requestFingerprint && stored.requestFingerprint !== requestFingerprint) throw new Error('Order request conflict. Please refresh the order form.');
    if (stored.isComplete) { await releaseBuyerAdditionLocks(stored, buyer); return { ok: true, orderId: id, status: stored.status }; }
    if (!Array.isArray(stored.pendingLines) || stored.pendingLines.length !== stored.lineCount) throw new Error('Incomplete order requires Sales Room review.');
    return stored.additionVersion === 1 ? finishBuyerAddition(stored, buyer) : finishBuyerOrder(stored, buyer);
  }
  const list = (await workspaceItems(buyer.customerId)).filter(item => !item.removed);
  const byId = new Map(list.map(item => [normalize(item.id), item]));
  const lines = requests.map((request, index) => {
    const item = byId.get(normalize(request.itemId));
    const qty = quantity(request.quantityCtn);
    if (!item || qty < 1) throw new Error('Invalid order line.');
    const eaPerCtn = money(item.catalogueEa || item.ea);
    const explicitUnitPrice = money(item.vipPriceEa || item.quotePerPc);
    const lockedUnitPrice = money(item.vipPriceCtn || item.quotePerCtn || item.vipPrice) || (explicitUnitPrice * eaPerCtn);
    const lockedUnitPriceEa = explicitUnitPrice || (eaPerCtn > 0 ? Number((lockedUnitPrice / eaPerCtn).toFixed(6)) : 0);
    if (!(lockedUnitPrice > 0) || upper(item.quoteStatus) !== 'VIEW QUOTE') throw new Error('All ordered products must have a released V.I.P price.');
    if (!(eaPerCtn > 0) || !(lockedUnitPriceEa > 0)) throw new Error('All ordered products require EA and unit price data before submission.');
    return { lineId: 'L' + String(index + 1).padStart(3, '0'), itemId: item.id, barcode: item.barcode, itemName: item.itemName, packingSize: item.packingSize, eaPerCtn, lockedUnitPriceEa, cbmPerCtn: money(item.cbmPerCtn), currency: upper(item.vipCurrency || buyer.currency || 'USD'), lockedUnitPrice, quantityCtn: qty, qtyEditedAt: item.qtyEditedAt, qtyEditedBy: item.qtyEditedBy, lineAmount: Number((lockedUnitPrice * qty).toFixed(2)), totalCbm: Number((money(item.cbmPerCtn) * qty).toFixed(4)) };
  });
  const confirmedAt = new Date().toISOString();
  const order = { orderId: id, requestId: submissionId, requestFingerprint, additionVersion: 1, customerId: buyer.customerId, companyName: buyer.companyName, currency: lines[0].currency, status: 'CREATING', isComplete: false, lineCount: lines.length, pendingLines: lines, source: buyer.actorType === 'STAFF' ? 'SALES ASSISTED' : 'BUYER ROOM', confirmedAt, confirmedBy: buyer.actorName || buyer.email, totalCartons: lines.reduce((sum, line) => sum + line.quantityCtn, 0), totalCbm: Number(lines.reduce((sum, line) => sum + line.totalCbm, 0).toFixed(4)), estimatedTotal: Number(lines.reduce((sum, line) => sum + line.lineAmount, 0).toFixed(2)) };
  const savedOrder = await putPayload(BUYER_ORDER_COLLECTION, id, order);
  return finishBuyerAddition(payloadData(savedOrder), buyer);
  });
});
async function finishBuyerOrder(order, buyer) {
  const id = order.orderId;
  for (const line of order.pendingLines) await putPayload(BUYER_LINE_COLLECTION, id + '|' + line.lineId, { ...line, requestId: order.requestId, orderId: id, customerId: buyer.customerId, priceLockedAt: order.confirmedAt });
  const lineResult = await wixData.query(BUYER_LINE_COLLECTION).eq('orderId', id).limit(1000).find({ suppressAuth: true, consistentRead: true });
  if (lineResult.items.length !== order.lineCount) throw new Error('Order is still being saved. Please retry this same submission.');
  const auditId = 'OA-' + order.requestId;
  await putPayload(BUYER_ORDER_AUDIT_COLLECTION, auditId, { auditId, requestId: order.requestId, action: 'BUYER_CONFIRMED_ORDER', orderId: id, customerId: buyer.customerId, at: order.confirmedAt, actorEmail: buyer.email, actorType: buyer.actorType });
  await putPayload(BUYER_ORDER_COLLECTION, id, { ...order, pendingLines: [], ...(order.additionVersion === 1 ? { additionPlan: null } : {}), isComplete: true, status: 'CONFIRMED' });
  let resetFailures = 0;
  for (const line of order.pendingLines) {
    try {
      const row = await findOwnedItem(buyer, line.itemId);
      await putPayload(BUYER_LIST_COLLECTION, row.record.title, {
        ...row.data,
        orderQtyCtn: 0,
        qtyEditedAt: '',
        qtyEditedBy: '',
        lastOrderId: id,
        lastOrderedAt: order.confirmedAt,
        updatedAt: order.confirmedAt,
        lastEditedBy: buyer.actorName || buyer.email
      });
    } catch (error) {
      resetFailures++;
      console.warn('Confirmed order quantity reset failed', { orderId: id, itemId: normalize(line.itemId), error: normalize(error?.message || error) });
    }
  }
  return { ok: true, orderId: id, status: 'CONFIRMED', warning: resetFailures ? 'Order confirmed, but some quantities could not be cleared. Please check Order Form before submitting another order.' : '' };
}

async function buyerCustomerRecords(collection, customerId) {
  let page = await wixData.query(collection).eq('customerId', customerId).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const records = [...page.items];
  while (page.hasNext()) { page = await page.next(); records.push(...page.items); }
  return records;
}
async function withBuyerSubmissionLock(buyer, requestId, action) {
  const lockId = 'BUYER-SUBMIT-LOCK-' + buyer.customerId;
  try { await wixData.insert(BUYER_ORDER_AUDIT_COLLECTION, { _id: lockId, title: lockId, payload: JSON.stringify({ action: 'BUYER_SUBMISSION_LOCK', customerId: buyer.customerId, requestId }) }, { suppressAuth: true }); }
  catch (_) { throw new Error('Another order request is being saved. Retry this same submission shortly.'); }
  try {
    const unfinished = (await buyerCustomerRecords(BUYER_ORDER_COLLECTION, buyer.customerId)).map(payloadData)
      .find(order => !order.isComplete && order.additionVersion === 1 && order.requestId !== requestId);
    if (unfinished) throw new Error('A previous order request is still being saved. Retry that request before sending another.');
    return await action();
  } finally { await wixData.remove(BUYER_ORDER_AUDIT_COLLECTION, lockId, { suppressAuth: true }); }
}
function buyerAdditionEligible(order, line, incoming) {
  if (!order?.isComplete || order.receiptOnly || order.submittedAt || normalize(order.destination) || !['CONFIRMED', 'PROFORMA REQUESTED'].includes(upper(order.status))) return false;
  if (line.addedToOrderId || line.masterSubmittedAt || line.submittedToMasterAt || line.orderConfirmedAt || ['committedQtyCtn', 'committedQty', 'customerOrderQty', 'masterQtyCtn', 'completedQtyCtn'].some(field => hasValue(line[field]))) return false;
  if (quantity(line.effectiveRequestedQtyCtn ?? line.requestedQtyCtn ?? line.quantityCtn) < 1) return false;
  const sameProduct = normalize(line.itemId) ? normalize(line.itemId) === normalize(incoming.itemId) : normalize(line.barcode) === normalize(incoming.barcode);
  return sameProduct && normalize(line.barcode) === normalize(incoming.barcode) && normalize(line.packingSize) === normalize(incoming.packingSize)
    && money(line.eaPerCtn) === money(incoming.eaPerCtn) && upper(line.currency || order.currency) === upper(incoming.currency)
    && money(line.lockedUnitPrice ?? line.lockedPriceCtn) === money(incoming.lockedUnitPrice)
    && money(line.lockedUnitPriceEa) === money(incoming.lockedUnitPriceEa);
}
async function acquireBuyerAdditionLock(orderId, order, buyer) {
  const lockId = 'ORDER-LOCK-' + orderId;
  let existing = null;
  try { existing = await wixData.get(BUYER_ORDER_AUDIT_COLLECTION, lockId, { suppressAuth: true, consistentRead: true }); } catch (_) { /* No lock. */ }
  if (existing) {
    const lock = payloadData(existing);
    if (lock.requestId === order.requestId && lock.customerId === buyer.customerId && lock.source === 'BUYER ADDITION') return;
    throw new Error('This order is being updated. Retry this same submission shortly.');
  }
  await wixData.insert(BUYER_ORDER_AUDIT_COLLECTION, { _id: lockId, title: lockId, payload: JSON.stringify({ action: 'ORDER_MUTATION_LOCK', source: 'BUYER ADDITION', orderId, customerId: buyer.customerId, requestId: order.requestId, at: order.confirmedAt }) }, { suppressAuth: true });
}
async function releaseBuyerAdditionLocks(order, buyer) {
  for (const orderId of order.additionTargetOrderIds || []) {
    const lockId = 'ORDER-LOCK-' + orderId;
    let record = null;
    try { record = await wixData.get(BUYER_ORDER_AUDIT_COLLECTION, lockId, { suppressAuth: true, consistentRead: true }); } catch (_) { /* Already released. */ }
    const lock = payloadData(record);
    if (record && lock.source === 'BUYER ADDITION' && lock.requestId === order.requestId && lock.customerId === buyer.customerId) await wixData.remove(BUYER_ORDER_AUDIT_COLLECTION, lockId, { suppressAuth: true });
  }
}
function buyerEffectiveTotals(lines) {
  const active = lines.filter(line => !line.addedToOrderId);
  return {
    effectiveTotalCartons: active.reduce((sum, line) => sum + quantity(line.effectiveRequestedQtyCtn ?? line.requestedQtyCtn ?? line.quantityCtn), 0),
    effectiveEstimatedTotal: Number(active.reduce((sum, line) => sum + money(line.effectiveLineAmount ?? line.lineAmount), 0).toFixed(2)),
    effectiveTotalCbm: Number(active.reduce((sum, line) => sum + money(line.effectiveLineCbm ?? line.effectiveTotalCbm ?? line.lineCbm ?? line.totalCbm), 0).toFixed(4))
  };
}
async function planBuyerAddition(order, buyer) {
  const orderRecords = await buyerCustomerRecords(BUYER_ORDER_COLLECTION, buyer.customerId);
  const lineRecords = await buyerCustomerRecords(BUYER_LINE_COLLECTION, buyer.customerId);
  const orders = new Map(orderRecords.map(record => [normalize(payloadData(record).orderId), record]));
  const candidates = lineRecords.filter(record => !payloadData(record).addedToOrderId).sort((a, b) => {
    const left = payloadData(orders.get(normalize(payloadData(a).orderId))), right = payloadData(orders.get(normalize(payloadData(b).orderId)));
    return String(left.confirmedAt || '').localeCompare(String(right.confirmedAt || '')) || normalize(a.title).localeCompare(normalize(b.title));
  });
  const matches = order.pendingLines.map(line => candidates.find(record => buyerAdditionEligible(payloadData(orders.get(normalize(payloadData(record).orderId))), payloadData(record), line)) || null);
  const targetIds = [...new Set(matches.filter(Boolean).map(record => normalize(payloadData(record).orderId)))].sort();
  const acquired = [];
  try {
    for (const targetId of targetIds) { await acquireBuyerAdditionLock(targetId, order, buyer); acquired.push(targetId); }
    const freshLines = await buyerCustomerRecords(BUYER_LINE_COLLECTION, buyer.customerId);
    const groups = new Map();
    const pendingLines = [];
    for (let index = 0; index < order.pendingLines.length; index++) {
      const incoming = order.pendingLines[index], match = matches[index];
      if (!match) { pendingLines.push(incoming); continue; }
      const targetId = normalize(payloadData(match).orderId), record = orders.get(targetId);
      if (!groups.has(targetId)) {
        const fresh = await wixData.get(BUYER_ORDER_COLLECTION, record._id, { suppressAuth: true, consistentRead: true });
        groups.set(targetId, { title: fresh.title, recordId: fresh._id, before: payloadData(fresh), lines: [] });
      }
      const group = groups.get(targetId), fresh = freshLines.find(entry => entry._id === match._id), line = payloadData(fresh);
      if (!fresh || !buyerAdditionEligible(group.before, line, incoming)) { pendingLines.push(incoming); continue; }
      const previousQty = quantity(line.effectiveRequestedQtyCtn ?? line.requestedQtyCtn ?? line.quantityCtn), nextQty = previousQty + incoming.quantityCtn;
      const actor = buyer.actorName || buyer.email;
      const after = { ...line, originalQuantityCtn: quantity(line.originalQuantityCtn ?? line.quantityCtn), effectiveRequestedQtyCtn: nextQty,
        effectiveLineAmount: Number((money(line.lockedUnitPrice ?? line.lockedPriceCtn) * nextQty).toFixed(2)), effectiveLineCbm: Number((money(line.cbmPerCtn) * nextQty).toFixed(4)),
        effectiveTotalCbm: Number((money(line.cbmPerCtn) * nextQty).toFixed(4)), lastQuantityEditAt: order.confirmedAt, lastQuantityEditBy: actor, updatedAt: order.confirmedAt };
      const auditId = 'BUYER-ADD-' + order.requestId + '-' + incoming.lineId;
      const audit = { auditId, requestId: order.requestId, receiptOrderId: order.orderId, action: 'BUYER_ADDED_ORDER_LINE', orderId: targetId, customerId: buyer.customerId,
        at: order.confirmedAt, actorEmail: buyer.email, actorName: actor, actorType: buyer.actorType,
        detail: { lineId: line.lineId, barcode: line.barcode, itemName: line.itemName, packingSize: line.packingSize, originalQuantityCtn: after.originalQuantityCtn, previousQuantityCtn: previousQty, newQuantityCtn: nextQty, addedQuantityCtn: incoming.quantityCtn } };
      group.lines.push({ title: fresh.title, recordId: fresh._id, before: line, after, audit });
      pendingLines.push({ ...incoming, addedToOrderId: targetId, addedToLineId: line.lineId });
    }
    const plannedOrders = [...groups.values()].filter(group => group.lines.length).map(group => {
      const effectiveLines = freshLines.filter(record => normalize(payloadData(record).orderId) === normalize(group.before.orderId)).map(record => group.lines.find(line => line.recordId === record._id)?.after || payloadData(record));
      return { ...group, after: { ...group.before, ...buyerEffectiveTotals(effectiveLines), revision: quantity(group.before.revision) + 1, updatedAt: order.confirmedAt } };
    });
    const planned = { ...order, pendingLines, receiptOnly: pendingLines.every(line => Boolean(line.addedToOrderId)), ...buyerEffectiveTotals(pendingLines), additionTargetOrderIds: acquired, additionPlan: { orders: plannedOrders } };
    return payloadData(await putPayload(BUYER_ORDER_COLLECTION, order.orderId, planned));
  } catch (error) {
    await releaseBuyerAdditionLocks({ ...order, additionTargetOrderIds: acquired }, buyer);
    throw error;
  }
}
async function finishBuyerAddition(order, buyer) {
  if (!order.additionPlan) order = await planBuyerAddition(order, buyer);
  for (const targetId of order.additionTargetOrderIds || []) await acquireBuyerAdditionLock(targetId, order, buyer);
  // Keep order locks on failure. Restore unaccepted changes and retry the saved absolute plan.
  try {
  for (const group of order.additionPlan.orders) {
    for (const line of group.lines) {
      const current = payloadData(await wixData.get(BUYER_LINE_COLLECTION, line.recordId, { suppressAuth: true, consistentRead: true }));
      if (JSON.stringify(current) !== JSON.stringify(line.before) && JSON.stringify(current) !== JSON.stringify(line.after)) throw new Error('Order recovery needs Sales Room review. The previous task remains locked.');
      await putPayload(BUYER_LINE_COLLECTION, line.title, line.after);
    }
    const current = payloadData(await wixData.get(BUYER_ORDER_COLLECTION, group.recordId, { suppressAuth: true, consistentRead: true }));
    if (JSON.stringify(current) !== JSON.stringify(group.before) && JSON.stringify(current) !== JSON.stringify(group.after)) throw new Error('Order recovery needs Sales Room review. The previous task remains locked.');
    await putPayload(BUYER_ORDER_COLLECTION, group.title, group.after);
    for (const line of group.lines) {
      let prior = null;
      try { prior = await wixData.get(BUYER_ORDER_AUDIT_COLLECTION, line.audit.auditId, { suppressAuth: true, consistentRead: true }); } catch (_) { /* New immutable audit. */ }
      if (prior) { if (JSON.stringify(payloadData(prior)) !== JSON.stringify(line.audit)) throw new Error('Order addition audit conflict. Sales Room review is required.'); }
      else await wixData.insert(BUYER_ORDER_AUDIT_COLLECTION, { _id: line.audit.auditId, title: line.audit.auditId, payload: JSON.stringify(line.audit) }, { suppressAuth: true });
    }
  }
  const result = await finishBuyerOrder(order, buyer);
  await releaseBuyerAdditionLocks(order, buyer);
  return result;
  } catch (error) {
    const saved = payloadData(await wixData.get(BUYER_ORDER_COLLECTION, order.requestId, { suppressAuth: true, consistentRead: true }));
    if (!saved.isComplete) await rollbackPendingBuyerAddition(order);
    throw error;
  }
}
async function rollbackPendingBuyerAddition(order) {
  // Only this still-incomplete receipt's provisional writes may be reversed.
  for (const group of order.additionPlan.orders) {
    for (const line of group.lines) {
      const current = payloadData(await wixData.get(BUYER_LINE_COLLECTION, line.recordId, { suppressAuth: true, consistentRead: true }));
      if (JSON.stringify(current) !== JSON.stringify(line.before) && JSON.stringify(current) !== JSON.stringify(line.after)) throw new Error('Order recovery needs Sales Room review. The task remains locked.');
    }
    const current = payloadData(await wixData.get(BUYER_ORDER_COLLECTION, group.recordId, { suppressAuth: true, consistentRead: true }));
    if (JSON.stringify(current) !== JSON.stringify(group.before) && JSON.stringify(current) !== JSON.stringify(group.after)) throw new Error('Order recovery needs Sales Room review. The task remains locked.');
  }
  for (const group of order.additionPlan.orders) {
    for (const line of group.lines) await putPayload(BUYER_LINE_COLLECTION, line.title, line.before);
    await putPayload(BUYER_ORDER_COLLECTION, group.title, group.before);
    for (const line of group.lines) {
      let record = null;
      try { record = await wixData.get(BUYER_ORDER_AUDIT_COLLECTION, line.audit.auditId, { suppressAuth: true, consistentRead: true }); } catch (_) { /* No provisional audit. */ }
      if (record && JSON.stringify(payloadData(record)) === JSON.stringify(line.audit)) await wixData.remove(BUYER_ORDER_AUDIT_COLLECTION, line.audit.auditId, { suppressAuth: true });
    }
  }
}

