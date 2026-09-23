import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { request as httpsRequest } from 'https';
import { mediaManager } from 'wix-media-backend';

const CUSTOMER_COLLECTION = 'WixCustomers';
const CUSTOMER_USER_COLLECTION = 'WixCustomerUsers';
const STAFF_COLLECTION = 'StaffMaster';
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const BUYER_LIST_COLLECTION = 'WixBuyerListItems';
const DEFAULT_SELECTION_LIMIT = 100;
const SELECTION_LIMITS = new Set([100, 300, 500, 700]);
function selectionLimit(customer) { const value = Number(customer?.selectionLimit); return SELECTION_LIMITS.has(value) ? value : DEFAULT_SELECTION_LIMIT; }
const BUYER_ORDER_COLLECTION = 'WixBuyerOrders';
const BUYER_LINE_COLLECTION = 'WixBuyerOrderLines';
const BUYER_ORDER_AUDIT_COLLECTION = 'WixOrderAudit';
const ORDER_PAGE_SIZE = 20;
const QD_ROUTER_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzpMXT1ap2sOXRUkCAXx3BomPQK0E-0oTp6g3tna3Rs7cGHGRU0W2qRtwnU9YcC94qv/exec';
const QD_ROUTER_SECRET = 'FMCG_QD_ROUTER_TOKEN';

function normalize(value) { return String(value ?? '').trim(); }
function upper(value) { return normalize(value).toUpperCase(); }
function normalizeEmail(value) { return normalize(value).toLowerCase(); }
function quantity(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
function money(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function hasValue(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
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
  return { staffId: upper(staff.staffId), staffName: normalize(staff.title || staff.staffName || staff.staffId), email, canViewAllCustomers: ['ADMIN', 'SUPER ADMIN'].includes(upper(staff.role)) };
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
  return { customerId: normalize(customer.customerId || customer._id), companyName: normalize(customer.title), email: normalizeEmail(actor.email), actorName: normalize(actor.name || actor.email), actorType: actor.type, currency: upper(customer.preferredCurrency || customer.tradingCurrency || 'USD'), selectionLimit: selectionLimit(customer), status: 'ACTIVE', qdFileId: normalize(customer.qdFileId), assignedStaffId: upper(customer.assignedStaffId) };
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
    return contextFromCustomer(customer, { email: staff.email, name: staff.staffName, type: 'STAFF' });
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
  return contextFromCustomer(customer, { email, name: user.title || email, type: 'CUSTOMER_USER' });
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
  const byProductId = new Map();
  const byBarcode = new Map();
  products.forEach(product => {
    byProductId.set(normalize(product._id), product);
    const barcode = normalize(product.barcode);
    if (barcode) byBarcode.set(barcode, product);
  });
  return rows.map(({ record, data }) => {
    const storedBarcode = normalize(data.barcode || data.unitBarcode);
    const product = byProductId.get(normalize(data.productId)) || byBarcode.get(storedBarcode) || {};
    const id = normalize(record._id || data.id || data.itemId);
    return {
      ...data, id, itemId: id,
      barcode: normalize(data.barcode || data.unitBarcode || product.barcode),
      itemName: normalize(data.itemName || product.name || product.title),
      // Current selections follow the latest Catalogue packing size. Keep the
      // stored value only when the product is unavailable in Catalogue CMS.
      packingSize: normalize(product.description || data.packingSize),
      brand: normalize(data.brand || product.brandName || product.principle),
      category: normalize(data.category || data.mainCategory || product.mainCategory),
      imageUrl: imageUrl(data.imageUrl || data.image || product.image || product.productImage || product.mainImage || product.wixImageUrl),
      ea: money(data.ea || product.ea),
      // Read EA (pieces per carton) from the dedicated Catalogue CMS field.
      // Read it afresh for exports instead of trusting an older selection payload.
      catalogueEa: hasValue(product.ea) ? money(product.ea) : null,
      // Point Base sync writes CBM /CTN to FMCGMALAYSIA.m3Ctn. An older
      // selection payload must not mask a newer CMS value, including zero.
      cbmPerCtn: money(hasValue(product.m3Ctn) ? product.m3Ctn : hasValue(product.cbmPerCtn) ? product.cbmPerCtn : hasValue(product.cbm) ? product.cbm : data.cbmPerCtn),
      normalPriceEa: money(data.normalPriceEa || product.pricePerPc || product.price), normalPriceCtn: money(data.normalPriceCtn || product.pricePerCtn),
      vipPriceEa: money(data.vipPriceEa || data.quotePerPc), vipPriceCtn: money(data.vipPriceCtn || data.quotePerCtn || data.vipPrice),
      // A stored price is not a released quotation. Only the QD sync endpoint is
      // allowed to promote an item to VIEW QUOTE.
      quoteStatus: upper(data.quoteStatus || 'RFQ'),
      quoteActive: upper(data.quoteStatus || 'RFQ') === 'VIEW QUOTE',
      addedTime: data.addedTime || data.selectedAt || record._createdDate || '',
      selectedByName: normalize(data.selectedByName || data.selectedById),
      lastEditedBy: normalize(data.lastEditedBy || data.selectedByName),
      qtyEditedAt: normalize(data.qtyEditedAt), qtyEditedBy: normalize(data.qtyEditedBy)
    };
  });
}

async function buyerOrderHistory(customerId, cursor = '') {
  let query = wixData.query(BUYER_ORDER_COLLECTION).eq('customerId', normalize(customerId)).eq('isComplete', true);
  if (cursor) query = query.lt('orderSortKey', normalize(cursor));
  const result = await query.descending('orderSortKey').limit(ORDER_PAGE_SIZE + 1).find({ suppressAuth: true, consistentRead: true });
  const page = result.items.slice(0, ORDER_PAGE_SIZE);
  return {
    orders: page.map(record => payloadData(record)),
    nextCursor: result.items.length > ORDER_PAGE_SIZE ? normalize(page[page.length - 1].orderSortKey) : ''
  };
}

export const getCurrentBuyerContext = webMethod(Permissions.SiteMember, async (assistCustomerId = '') => {
  try { return { ok: true, buyer: await resolveBuyerContext(assistCustomerId) }; } catch (error) { return { ok: false, reason: normalize(error?.message || error) }; }
});
export const getBuyerWorkspace = webMethod(Permissions.SiteMember, async (assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const [items, orderPage, customer, userResult] = await Promise.all([
    workspaceItems(buyer.customerId),
    buyerOrderHistory(buyer.customerId),
    customerById(buyer.customerId),
    wixData.query(CUSTOMER_USER_COLLECTION).eq('customerId', buyer.customerId).limit(100).find({ suppressAuth: true })
  ]);
  const users = userResult.items.map(user => ({
      userId: normalize(user.userId),
      name: normalize(user.title),
      email: normalizeEmail(user.email),
      mobile: normalize(user.mobileNo),
      status: upper(user.status),
      primary: Boolean(user.primaryUser)
    }));
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
    users: users.filter(user => !user.primary)
  };
  const removed = items.filter(item => item.removed).map(item => {
    const { normalPriceEa, normalPriceCtn, vipPriceEa, vipPriceCtn, vipPrice,
      quotePerPc, quotePerCtn, pricePerPc, pricePerCtn, previousQuote,
      targetGp, ...withoutPrices } = item;
    return withoutPrices;
  });
  return { ok: true, context: buyer, account, myList: items.filter(item => !item.removed), removed, orders: orderPage.orders, ordersNextCursor: orderPage.nextCursor };
});
export const getBuyerSelectionExport = webMethod(Permissions.SiteMember, async (assistCustomerId = '') => {
  const buyer = await resolveBuyerContext(assistCustomerId);
  const items = (await workspaceItems(buyer.customerId)).filter(item => !item.removed);
  const rows = items.map(item => {
    if (!Number.isInteger(item.catalogueEa) || item.catalogueEa <= 0) {
      throw new Error(`Catalogue EA is missing for ${item.barcode || item.itemName}.`);
    }
    const quoted = item.quoteStatus === 'VIEW QUOTE' && item.quoteActive;
    if (quoted && item.vipCurrency && upper(item.vipCurrency) !== buyer.currency) {
      throw new Error(`Quotation currency needs review for ${item.barcode || item.itemName}.`);
    }
    return {
      unitBarcode: item.barcode,
      itemName: item.itemName,
      packingSize: item.packingSize,
      ea: item.catalogueEa,
      pricePerPc: quoted && money(item.vipPriceEa) > 0 ? money(item.vipPriceEa) : null,
      pricePerCtn: quoted && money(item.vipPriceCtn) > 0 ? money(item.vipPriceCtn) : null,
      cbmPerCtn: money(item.cbmPerCtn)
    };
  });
  return { ok: true, customerId: buyer.customerId, companyName: buyer.companyName, currency: buyer.currency, rows };
});
export const uploadBuyerSelectionExcel = webMethod(Permissions.SiteMember, async (customerId, base64, assistCustomerId = '') => {
  let stage = 'BUYER_CONTEXT';
  try {
    const buyer = await resolveBuyerContext(assistCustomerId);
    stage = 'VALIDATE_FILE';
    if (normalize(customerId) !== buyer.customerId) throw new Error('Buyer account changed. Please try again.');
    const encoded = normalize(base64);
    if (!encoded || encoded.length > 3000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Excel file is too large or invalid.');
    const file = Buffer.from(encoded, 'base64');
    if (file.length < 1000 || file.length > 2250000 || file.subarray(0, 4).toString('hex') !== '504b0304') throw new Error('Excel file is invalid.');
    const fileName = `fmcgmalaysia.com-My-Selection-${new Date().toISOString().slice(0, 10)}.xlsx`;

    stage = 'MEDIA_UPLOAD';
    const uploaded = await mediaManager.upload('/buyer-room-exports', file, fileName, {
      mediaOptions: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', mediaType: 'document' },
      metadataOptions: { isPrivate: true, isVisitorUpload: false }
    });
    if (!uploaded?.fileUrl) throw new Error('Wix Media did not return a file URL.');

    stage = 'DOWNLOAD_URL';
    let downloadUrl = '';
    let lastDownloadError;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        downloadUrl = await mediaManager.getDownloadUrl(uploaded.fileUrl, 60, fileName);
        if (/^https:\/\//i.test(downloadUrl || '')) break;
        throw new Error('Wix Media returned an invalid download URL.');
      } catch (error) {
        lastDownloadError = error;
        if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
    if (!downloadUrl) throw lastDownloadError || new Error('Wix Media download URL is unavailable.');
    return { ok: true, customerId: buyer.customerId, downloadUrl, fileName, fileUrl: uploaded.fileUrl };
  } catch (error) {
    const diagnostic = {
      stage,
      name: normalize(error?.name) || 'Error',
      code: normalize(error?.code || error?.details?.applicationError?.code),
      message: normalize(error?.message) || 'Unknown Wix Media error.'
    };
    console.error('Buyer Room Excel export failed', diagnostic);
    return { ok: false, ...diagnostic };
  }
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
  return { ok: true, customerId: buyer.customerId, order: { ...payloadData(result.items[0]), lines: lines.map(payloadData).filter(line => normalize(line.customerId) === buyer.customerId).sort((a, b) => normalize(a.lineId).localeCompare(normalize(b.lineId))) } };
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
  const id = nextOrderId(buyer.customerId, submissionId);
  let orderRecord = null;
  try { orderRecord = await wixData.get(BUYER_ORDER_COLLECTION, submissionId, { suppressAuth: true, consistentRead: true }); } catch (_) { /* New submission. */ }
  if (orderRecord) {
    const stored = payloadData(orderRecord);
    if (normalize(stored.customerId) !== buyer.customerId || normalize(stored.orderId) !== id) throw new Error('Order request conflict. Please contact Sales Room.');
    if (stored.isComplete) return { ok: true, orderId: id, status: stored.status };
    if (!Array.isArray(stored.pendingLines) || stored.pendingLines.length !== stored.lineCount) throw new Error('Incomplete order requires Sales Room review.');
    return finishBuyerOrder(stored, buyer);
  }
  const list = (await workspaceItems(buyer.customerId)).filter(item => !item.removed);
  const byId = new Map(list.map(item => [normalize(item.id), item]));
  const lines = requests.map((request, index) => {
    const item = byId.get(normalize(request.itemId));
    const qty = quantity(request.quantityCtn);
    if (!item || qty < 1) throw new Error('Invalid order line.');
    const lockedUnitPrice = money(item.vipPriceCtn || item.vipPrice) || (money(item.vipPriceEa) * money(item.ea));
    if (!(lockedUnitPrice > 0) || upper(item.quoteStatus) !== 'VIEW QUOTE') throw new Error('All ordered products must have a released V.I.P price.');
    return { lineId: 'L' + String(index + 1).padStart(3, '0'), itemId: item.id, barcode: item.barcode, itemName: item.itemName, packingSize: item.packingSize, cbmPerCtn: money(item.cbmPerCtn), currency: upper(item.vipCurrency || buyer.currency || 'USD'), lockedUnitPrice, quantityCtn: qty, qtyEditedAt: item.qtyEditedAt, qtyEditedBy: item.qtyEditedBy, lineAmount: Number((lockedUnitPrice * qty).toFixed(2)) };
  });
  const confirmedAt = new Date().toISOString();
  const order = { orderId: id, requestId: submissionId, customerId: buyer.customerId, companyName: buyer.companyName, currency: lines[0].currency, status: 'CREATING', isComplete: false, lineCount: lines.length, pendingLines: lines, source: buyer.actorType === 'STAFF' ? 'SALES ASSISTED' : 'BUYER ROOM', confirmedAt, confirmedBy: buyer.actorName || buyer.email, totalCartons: lines.reduce((sum, line) => sum + line.quantityCtn, 0), estimatedTotal: Number(lines.reduce((sum, line) => sum + line.lineAmount, 0).toFixed(2)) };
  const savedOrder = await putPayload(BUYER_ORDER_COLLECTION, id, order);
  return finishBuyerOrder(payloadData(savedOrder), buyer);
});
async function finishBuyerOrder(order, buyer) {
  const id = order.orderId;
  for (const line of order.pendingLines) await putPayload(BUYER_LINE_COLLECTION, id + '|' + line.lineId, { ...line, requestId: order.requestId, orderId: id, customerId: buyer.customerId, priceLockedAt: order.confirmedAt });
  const lineResult = await wixData.query(BUYER_LINE_COLLECTION).eq('orderId', id).limit(1000).find({ suppressAuth: true, consistentRead: true });
  if (lineResult.items.length !== order.lineCount) throw new Error('Order is still being saved. Please retry this same submission.');
  const auditId = 'OA-' + order.requestId;
  await putPayload(BUYER_ORDER_AUDIT_COLLECTION, auditId, { auditId, requestId: order.requestId, action: 'BUYER_CONFIRMED_ORDER', orderId: id, customerId: buyer.customerId, at: order.confirmedAt, actorEmail: buyer.email, actorType: buyer.actorType });
  await putPayload(BUYER_ORDER_COLLECTION, id, { ...order, pendingLines: [], isComplete: true, status: 'CONFIRMED' });
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

