import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import https from 'https';

const APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwGTMTCkdVL8voDSZ5PcD-JtFeqzvRjqbmVKAMPV43YqY1rPZcxKzE4UconsoV8gks-/exec';
const SECRET_NAME = 'NCT_ONBOARDING_SHARED_SECRET';
const STAFF_COLLECTION = 'StaffMaster';
const CUSTOMER_COLLECTION = 'WixCustomers';
const CUSTOMER_USER_COLLECTION = 'WixCustomerUsers';
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const SELECTION_COLLECTION = 'WixBuyerListItems';

export const getCatalogueSelectionState = webMethod(
  Permissions.SiteMember,
  async (assistCustomerId = '') => {
    const context = await resolveSelectionContext_(assistCustomerId);
    const items = await selectionItemsForCustomer_(context.customerId);
    // Only a confirmed QD write counts as selected. A PENDING/FAILED CMS row is
    // deliberately left retryable so the catalogue can heal an interrupted sync.
    const readyItems = items.filter((item) => upper(selectionPayload_(item).qdSyncStatus) === 'READY');
    const counts = { food: 0, household: 0, personalCare: 0, general: 0 };
    readyItems.forEach((item) => {
      const payload = selectionPayload_(item);
      counts[categoryBucket_(payload.mainCategory)] += 1;
    });
    return Object.freeze({
      ok: true,
      customerId: context.customerId,
      selectedProductIds: readyItems.map((item) => selectionPayload_(item).productId).filter(Boolean),
      selectedBarcodes: readyItems.map((item) => selectionPayload_(item).unitBarcode).filter(Boolean),
      counts,
      total: readyItems.length
    });
  }
);

export const addCatalogueSelection = webMethod(
  Permissions.SiteMember,
  async (productId, assistCustomerId = '') => {
    const context = await resolveSelectionContext_(assistCustomerId);
    const product = await getActiveProduct_(productId);
    const unitBarcode = normalizeBarcode_(product.barcode);
    if (!unitBarcode) throw new Error('This product is missing its Unit Barcode.');

    const title = context.customerId + '|' + unitBarcode;
    const selectionId = selectionId_(context.customerId, unitBarcode);
    const now = new Date().toISOString();
    let item = await getSelectionById_(selectionId);

    if (item && normalize(item.title) !== title) {
      throw new Error('Selection identity collision. Admin review is required.');
    }

    if (item) {
      const existing = selectionPayload_(item);
      if (upper(existing.qdSyncStatus) === 'READY') {
        return Object.freeze({ ok: true, duplicate: true, selection: publicSelection_(item) });
      }
    } else {
      const payload = {
        version: 1,
        customerId: context.customerId,
        productId: normalize(product._id),
        unitBarcode,
        itemName: normalize(product.name),
        packingSize: normalize(product.description),
        mainCategory: normalize(product.mainCategory),
        quoteStatus: 'RFQ',
        selectedAt: now,
        selectedByType: context.actorType,
        selectedById: context.actorId,
        selectedByName: context.actorName,
        source: context.actorType === 'STAFF' ? 'SALES_ROOM_ASSIST' : 'BUYER_CATALOGUE',
        qdFileId: context.qdFileId,
        qdSyncStatus: 'PENDING',
        qdSyncedAt: '',
        qdRow: 0,
        lastError: ''
      };
      try {
        item = await wixData.insert(
          SELECTION_COLLECTION,
          { _id: selectionId, title, payload: JSON.stringify(payload) },
          { suppressAuth: true }
        );
      } catch (error) {
        item = await getSelectionById_(selectionId);
        if (!item || normalize(item.title) !== title) throw error;
      }
    }

    const current = selectionPayload_(item);
    try {
      const sharedSecret = await getSecret(SECRET_NAME);
      const response = await postJson_(APPS_SCRIPT_ENDPOINT, {
        action: 'ADD_SELECTION',
        sharedSecret,
        customerId: context.customerId,
        assignedStaffId: context.assignedStaffId,
        qdFileId: context.qdFileId,
        wixMyListId: item._id,
        unitBarcode
      });
      if (!response.ok || !response.body?.ok) {
        throw new Error(response.body?.error || 'Quotation Desk selection sync failed.');
      }
      const result = response.body.result || {};
      const ready = {
        ...current,
        quoteStatus: 'RFQ',
        qdSyncStatus: 'READY',
        qdSyncedAt: new Date().toISOString(),
        qdRow: Number(result.qdRow || 0),
        lastError: ''
      };
      item = await wixData.update(
        SELECTION_COLLECTION,
        { ...item, payload: JSON.stringify(ready) },
        { suppressAuth: true }
      );
      return Object.freeze({ ok: true, duplicate: Boolean(result.idempotent), selection: publicSelection_(item) });
    } catch (error) {
      const failed = { ...current, qdSyncStatus: 'FAILED', lastError: normalize(error.message || error) };
      await wixData.update(
        SELECTION_COLLECTION,
        { ...item, payload: JSON.stringify(failed) },
        { suppressAuth: true }
      );
      return Object.freeze({
        ok: false,
        error: failed.lastError || 'Quotation Desk selection sync failed.',
        selection: publicSelection_({ ...item, payload: JSON.stringify(failed) })
      });
    }
  }
);

export const getSalesRoomQuoteSignals = webMethod(
  Permissions.SiteMember,
  async () => {
    const staff = await requireStaff_();
    let customerQuery = wixData.query(CUSTOMER_COLLECTION).limit(1000);
    if (!staff.canViewAllCustomers) customerQuery = customerQuery.eq('assignedStaffId', staff.staffId);
    const customerResult = await customerQuery.find({ suppressAuth: true });
    const allowed = new Set(customerResult.items.map((item) => normalize(item.customerId)));
    const rows = await wixData.query(SELECTION_COLLECTION).limit(1000).find({ suppressAuth: true });
    const byCustomer = Object.create(null);
    customerResult.items.forEach((customer) => {
      const customerId = normalize(customer.customerId);
      if (customerId) byCustomer[customerId] = {
        awaitingQuoteItemCount: 0,
        quotedItemCount: 0,
        failedQuoteItemCount: 0,
        qdFileId: normalize(customer.qdFileId)
      };
    });
    rows.items.forEach((item) => {
      const payload = selectionPayload_(item);
      if (!allowed.has(normalize(payload.customerId))) return;
      const customerId = normalize(payload.customerId);
      if (!byCustomer[customerId]) byCustomer[customerId] = { awaitingQuoteItemCount: 0, quotedItemCount: 0, failedQuoteItemCount: 0, qdFileId: '' };
      const status = upper(payload.quoteStatus || payload.status);
      const syncStatus = upper(payload.qdSyncStatus);
      if (syncStatus === 'READY' && status === 'VIEW QUOTE') byCustomer[customerId].quotedItemCount += 1;
      else if (syncStatus === 'READY' && status === 'RFQ') byCustomer[customerId].awaitingQuoteItemCount += 1;
      if (syncStatus === 'FAILED') byCustomer[customerId].failedQuoteItemCount += 1;
    });
    const summary = Object.values(byCustomer).reduce((total, item) => {
      total.awaitingQuoteItemCount += item.awaitingQuoteItemCount;
      total.quotedItemCount += item.quotedItemCount;
      total.failedQuoteItemCount += item.failedQuoteItemCount;
      return total;
    }, { awaitingQuoteItemCount: 0, quotedItemCount: 0, failedQuoteItemCount: 0 });
    return Object.freeze({ ok: true, byCustomer, summary });
  }
);

async function resolveSelectionContext_(assistCustomerId) {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member) throw new Error('Please sign in before selecting products.');
  const memberId = normalize(member._id);
  const email = memberEmail_(member);
  const requestedCustomerId = normalize(assistCustomerId);
  let actorType;
  let actorId;
  let actorName;
  let customer;

  if (requestedCustomerId) {
    const staff = await requireStaff_(member);
    const result = await wixData.query(CUSTOMER_COLLECTION).eq('customerId', requestedCustomerId).limit(2).find({ suppressAuth: true });
    if (result.items.length !== 1) throw new Error('Customer was not found.');
    customer = result.items[0];
    if (!staff.canViewAllCustomers && upper(customer.assignedStaffId) !== staff.staffId) {
      throw new Error('This customer is assigned to another salesperson.');
    }
    actorType = 'STAFF';
    actorId = staff.staffId;
    actorName = staff.staffName;
  } else {
    const users = await wixData.query(CUSTOMER_USER_COLLECTION).limit(1000).find({ suppressAuth: true });
    let matches = users.items.filter((item) => normalize(item.wixMemberId) === memberId);
    if (!matches.length && email) matches = users.items.filter((item) => normalizeEmail_(item.email) === email);
    if (matches.length !== 1) throw new Error(matches.length > 1 ? 'Duplicate customer login records require admin review.' : 'This member is not linked to a customer account.');
    let user = matches[0];
    if (upper(user.status) !== 'ACTIVE') throw new Error('This customer user is not active.');
    if (!normalize(user.wixMemberId)) {
      user = await wixData.update(CUSTOMER_USER_COLLECTION, { ...user, wixMemberId: memberId }, { suppressAuth: true });
    }
    const result = await wixData.query(CUSTOMER_COLLECTION).eq('customerId', normalize(user.customerId)).limit(2).find({ suppressAuth: true });
    if (result.items.length !== 1) throw new Error('Customer account was not found.');
    customer = result.items[0];
    actorType = 'CUSTOMER_USER';
    actorId = normalize(user.userId || user._id);
    actorName = normalize(user.title || email);
  }

  const lifecycleStatus = upper(customer.lifecycleStatus || customer.customerStatus);
  const accessStatus = upper(customer.catalogueAccessStatus || customer.accessStatus || customer.customerStatus);
  if (lifecycleStatus === 'ARCHIVED' || ['SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(accessStatus)) {
    throw new Error('Catalogue access is suspended for this customer.');
  }
  if (upper(customer.qdStatus) !== 'READY' || !normalize(customer.qdFileId)) throw new Error('This customer Quotation Desk is not ready.');
  return {
    customerId: normalize(customer.customerId),
    qdFileId: normalize(customer.qdFileId),
    assignedStaffId: upper(customer.assignedStaffId),
    actorType,
    actorId,
    actorName
  };
}

async function getActiveProduct_(productId) {
  const id = normalize(productId);
  if (!id) throw new Error('Product ID is required.');
  const product = await wixData.get(PRODUCT_COLLECTION, id, { suppressAuth: true });
  if (!product) throw new Error('Product was not found.');
  if (upper(product.pointBaseStatus) !== 'ACTIVE') throw new Error('This product is no longer active.');
  return product;
}

async function requireStaff_(knownMember) {
  const member = knownMember || await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member) throw new Error('Staff sign-in is required.');
  const memberId = normalize(member._id);
  const email = memberEmail_(member);
  const result = await wixData.query(STAFF_COLLECTION).limit(1000).find({ suppressAuth: true });
  let matches = result.items.filter((item) => normalize(item.wixMemberId) === memberId);
  if (!matches.length && email) matches = result.items.filter((item) => normalizeEmail_(item.staffEmail) === email);
  if (matches.length !== 1 || upper(matches[0].status) !== 'ACTIVE') throw new Error('This member is not authorized in STAFF MASTER.');
  const staff = matches[0];
  return {
    staffId: upper(staff.staffId),
    staffName: normalize(staff.title || staff.staffName || staff.staffId),
    canViewAllCustomers: ['SUPER ADMIN', 'ADMIN'].includes(upper(staff.role))
  };
}

async function selectionItemsForCustomer_(customerId) {
  const result = await wixData.query(SELECTION_COLLECTION).startsWith('title', normalize(customerId) + '|').limit(1000).find({ suppressAuth: true });
  return result.items;
}

async function getSelectionById_(id) {
  try { return await wixData.get(SELECTION_COLLECTION, id, { suppressAuth: true }); } catch (_) { return null; }
}

function publicSelection_(item) {
  const payload = selectionPayload_(item);
  return {
    id: normalize(item._id), productId: normalize(payload.productId), unitBarcode: normalize(payload.unitBarcode),
    itemName: normalize(payload.itemName), quoteStatus: upper(payload.quoteStatus), qdSyncStatus: upper(payload.qdSyncStatus),
    qdRow: Number(payload.qdRow || 0), selectedAt: normalize(payload.selectedAt)
  };
}

function selectionPayload_(item) {
  const raw = item && item.payload;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw || '{}')); } catch (_) { return {}; }
}

function categoryBucket_(value) {
  const category = upper(value);
  if (category.includes('FOOD')) return 'food';
  if (category.includes('HOUSE')) return 'household';
  if (category.includes('PERSONAL') || category.includes('HEALTH')) return 'personalCare';
  return 'general';
}

function selectionId_(customerId, barcode) {
  return 'ml_' + hash_(customerId) + '_' + hash_(barcode);
}

function hash_(value) {
  let hash = 2166136261;
  for (const ch of String(value || '')) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function postJson_(url, payload) {
  const json = JSON.stringify(payload);
  const first = await nodeHttpsRequest_(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json)
    }
  }, json);
  let response = first;
  if ([301, 302, 303, 307, 308].includes(first.status)) {
    const location = Array.isArray(first.headers.location)
      ? first.headers.location[0]
      : first.headers.location;
    if (!location) throw new Error('QD redirect location is missing.');
    response = await nodeHttpsRequest_(new URL(location, url).toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
  }
  const text = response.text;
  let body;
  try { body = JSON.parse(text || '{}'); } catch (_) { body = {}; }
  return { ok: response.status >= 200 && response.status < 300, status: response.status, body, text };
}

function nodeHttpsRequest_(url, options, body = '') {
  return new Promise((resolve, reject) => {
    const request = https.request(url, options, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({
        status: Number(response.statusCode || 0),
        headers: response.headers || {},
        text
      }));
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('QD service request timed out.')));
    if (body) request.write(body);
    request.end();
  });
}

function memberEmail_(member) {
  const loginEmail = member?.loginEmail || member?.contactDetails?.emails?.[0];
  return normalizeEmail_(typeof loginEmail === 'string' ? loginEmail : loginEmail?.email);
}
function normalizeBarcode_(value) { return String(value || '').replace(/\.0$/, '').trim(); }
function normalizeEmail_(value) { return String(value || '').trim().toLowerCase(); }
function normalize(value) { return String(value || '').trim(); }
function upper(value) { return normalize(value).toUpperCase(); }
