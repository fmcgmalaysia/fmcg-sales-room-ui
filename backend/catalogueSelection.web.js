import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import wixRealtimeBackend from 'wix-realtime-backend';
import { request as httpsRequest } from 'https';

const APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzpMXT1ap2sOXRUkCAXx3BomPQK0E-0oTp6g3tna3Rs7cGHGRU0W2qRtwnU9YcC94qv/exec';
const SECRET_NAME = 'FMCG_QD_ROUTER_TOKEN';
const STAFF_COLLECTION = 'StaffMaster';
const CUSTOMER_COLLECTION = 'WixCustomers';
const CUSTOMER_USER_COLLECTION = 'WixCustomerUsers';
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const SELECTION_COLLECTION = 'WixBuyerListItems';
const DEFAULT_SELECTION_LIMIT = 100;
const SELECTION_LIMITS = new Set([100, 300, 500, 700]);
function selectionLimit_(customer) { const value = Number(customer?.selectionLimit); return SELECTION_LIMITS.has(value) ? value : DEFAULT_SELECTION_LIMIT; }

export const getCatalogueSelectionState = webMethod(
  Permissions.SiteMember,
  async (assistCustomerId = '') => {
    const context = await resolveSelectionContext_(assistCustomerId);
    const items = await selectionItemsForCustomer_(context.customerId);
    // A removed item stays visually Selected in Catalogue so the buyer always
    // returns to the same Buyer Room record instead of creating a duplicate.
    // CMS persistence defines selection; QD routing is a downstream state.
    // Selection is durable as soon as it reaches Wix CMS. QD routing is a
    // downstream Sales Room task and must never make the Catalogue button
    // revert to "TRY AGAIN" or let the buyer create duplicate selections.
    const selectedItems = items;
    const activeItems = selectedItems.filter((item) => !selectionPayload_(item).removed);
    const counts = { food: 0, household: 0, personalCare: 0, general: 0 };
    activeItems.forEach((item) => {
      const payload = selectionPayload_(item);
      counts[categoryBucket_(payload.mainCategory)] += 1;
    });
    return Object.freeze({
      ok: true,
      customerId: context.customerId,
      selectedProductIds: selectedItems.map((item) => selectionPayload_(item).productId).filter(Boolean),
      selectedBarcodes: selectedItems.map((item) => selectionPayload_(item).unitBarcode).filter(Boolean),
      counts,
      total: activeItems.length,
      selectionLimit: context.selectionLimit
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
      if (existing.removed && (await selectionItemsForCustomer_(context.customerId)).filter(record => !selectionPayload_(record).removed).length >= context.selectionLimit) {
        throw new Error(`My Selection is at its ${context.selectionLimit}-product limit. Remove an item before restoring this one.`);
      }
      if (upper(existing.qdSyncStatus) === 'READY') {
        return Object.freeze({ ok: true, duplicate: true, selection: publicSelection_(item) });
      }
      const queued = {
        ...existing,
        removed: false,
        quoteStatus: 'RFQ',
        qdSyncStatus: upper(existing.qdSyncStatus) || 'PENDING'
      };
      item = await wixData.update(
        SELECTION_COLLECTION,
        { ...item, payload: JSON.stringify(queued) },
        { suppressAuth: true }
      );
    } else {
      const activeCount = (await selectionItemsForCustomer_(context.customerId)).filter(record => !selectionPayload_(record).removed).length;
      if (activeCount >= context.selectionLimit) throw new Error(`My Selection is at its ${context.selectionLimit}-product limit. Remove an item before adding another.`);
      const payload = {
        version: 1,
        customerId: context.customerId,
        productId: normalize(product._id),
        unitBarcode,
        itemName: normalize(product.name),
        packingSize: normalize(product.description),
        mainCategory: normalize(product.mainCategory),
        imageUrl: imageUrl_(product.image),
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

    await notifySalesRoomSelectionChanged_();
    // Return immediately after CMS persistence and realtime notification.
    // QD routing runs as a separate request and cannot delay buyer feedback.
    return Object.freeze({ ok: true, queued: true, selection: publicSelection_(item) });
  }
);

export const getSalesRoomQuoteSignals = webMethod(
  Permissions.SiteMember,
  async () => {
    const staff = await requireStaff_();
    let customerQuery = wixData.query(CUSTOMER_COLLECTION).limit(1000);
    if (!staff.canViewAllCustomers) customerQuery = customerQuery.eq('assignedStaffId', staff.staffId);
    const customerResult = await customerQuery.find({ suppressAuth: true, consistentRead: true });
    const allowed = new Set(customerResult.items.map((item) => normalize(item.customerId)));
    const rows = await wixData.query(SELECTION_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true });
    const byCustomer = Object.create(null);
    customerResult.items.forEach((customer) => {
      const customerId = normalize(customer.customerId);
      if (customerId) byCustomer[customerId] = {
        awaitingQuoteItemCount: 0,
        quotedItemCount: 0,
        failedQuoteItemCount: 0,
        failedRouteItemCount: 0,
        pendingRouteItemCount: 0,
        routingItemCount: 0,
        readyRouteItemCount: 0,
        routeStatus: 'READY',
        routeError: '',
        qdFileId: normalize(customer.qdFileId)
      };
    });
    rows.items.forEach((item) => {
      const payload = selectionPayload_(item);
      if (!allowed.has(normalize(payload.customerId))) return;
      const customerId = normalize(payload.customerId);
      if (!byCustomer[customerId]) byCustomer[customerId] = {
        awaitingQuoteItemCount: 0, quotedItemCount: 0, failedQuoteItemCount: 0, failedRouteItemCount: 0,
        pendingRouteItemCount: 0, routingItemCount: 0, readyRouteItemCount: 0,
        routeStatus: 'READY', routeError: '', qdFileId: ''
      };
      const status = upper(payload.quoteStatus || payload.status);
      const syncStatus = upper(payload.qdSyncStatus);
      const cleanupStatus = upper(payload.qdCleanupStatus);
      if (payload.removed) {
        if (cleanupStatus === 'FAILED') byCustomer[customerId].failedQuoteItemCount += 1;
        return;
      }
      if (syncStatus === 'READY' && status === 'VIEW QUOTE') byCustomer[customerId].quotedItemCount += 1;
      else if (['PENDING', 'ROUTING', 'READY', 'FAILED'].includes(syncStatus) && status === 'RFQ') byCustomer[customerId].awaitingQuoteItemCount += 1;
      if (syncStatus === 'FAILED') {
        byCustomer[customerId].failedQuoteItemCount += 1;
        byCustomer[customerId].failedRouteItemCount += 1;
      }
      if (syncStatus === 'PENDING') byCustomer[customerId].pendingRouteItemCount += 1;
      if (syncStatus === 'ROUTING') byCustomer[customerId].routingItemCount += 1;
      if (syncStatus === 'READY') byCustomer[customerId].readyRouteItemCount += 1;
      if (syncStatus === 'FAILED' && !byCustomer[customerId].routeError) byCustomer[customerId].routeError = normalize(payload.lastError);
    });
    Object.values(byCustomer).forEach((item) => {
      item.routeStatus = item.failedRouteItemCount > 0 ? 'FAILED'
        : item.routingItemCount > 0 ? 'ROUTING'
          : item.pendingRouteItemCount > 0 ? 'PENDING' : 'READY';
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

export const routeCatalogueSelection = webMethod(
  Permissions.SiteMember,
  async (selectionId, assistCustomerId = '') => {
    const context = await resolveSelectionContext_(assistCustomerId);
    const item = await getSelectionById_(normalize(selectionId));
    if (!item) throw new Error('Selection was not found.');
    const payload = selectionPayload_(item);
    if (normalize(payload.customerId) !== context.customerId) throw new Error('Selection does not belong to this customer.');
    return routeOneSelection_(item, {
      customerId: context.customerId,
      qdFileId: context.qdFileId,
      assignedStaffId: context.assignedStaffId
    });
  }
);

export const processSalesRoomSelectionQueue = webMethod(
  Permissions.SiteMember,
  async () => {
    const staff = await requireStaff_();
    let customerQuery = wixData.query(CUSTOMER_COLLECTION).limit(1000);
    if (!staff.canViewAllCustomers) customerQuery = customerQuery.eq('assignedStaffId', staff.staffId);
    const customerResult = await customerQuery.find({ suppressAuth: true, consistentRead: true });
    const allowed = new Set(customerResult.items.map((item) => normalize(item.customerId)));
    const rows = await wixData.query(SELECTION_COLLECTION).limit(1000).find({ suppressAuth: true, consistentRead: true });
    return routeQueuedSelections_(rows.items, customerResult.items, allowed);
  }
);

// The red Sales Room bubble is also a manual "route now" control. This keeps
// automatic routing, while giving staff an immediate, customer-specific retry.
export const routeSalesRoomCustomerSelections = webMethod(
  Permissions.SiteMember,
  async (customerId) => {
    const staff = await requireStaff_();
    const normalizedCustomerId = normalize(customerId);
    if (!normalizedCustomerId) throw new Error('Customer ID is required.');
    const customerResult = await wixData.query(CUSTOMER_COLLECTION)
      .eq('customerId', normalizedCustomerId)
      .limit(2)
      .find({ suppressAuth: true, consistentRead: true });
    if (customerResult.items.length !== 1) throw new Error('Customer was not found.');
    const customer = customerResult.items[0];
    if (!staff.canViewAllCustomers && upper(customer.assignedStaffId) !== staff.staffId) {
      throw new Error('This customer is not assigned to you.');
    }
    const rows = await wixData.query(SELECTION_COLLECTION)
      .startsWith('title', normalizedCustomerId + '|')
      .limit(1000)
      .find({ suppressAuth: true, consistentRead: true });
    const queue = rows.items.filter((item) => {
      const payload = selectionPayload_(item);
      const status = upper(payload.qdSyncStatus);
      const routingStartedAt = Date.parse(payload.qdLastAttemptAt || '') || 0;
      return !payload.removed
        && (['PENDING', 'FAILED'].includes(status) || (status === 'ROUTING' && routingStartedAt < Date.now() - 60000));
    }).slice(0, 5);
    const routing = rows.items.filter((item) => {
      const payload = selectionPayload_(item);
      return !payload.removed && upper(payload.qdSyncStatus) === 'ROUTING'
        && (Date.parse(payload.qdLastAttemptAt || '') || 0) >= Date.now() - 60000;
    }).length;
    const results = [];
    for (const item of queue) {
      const result = await routeOneSelection_(item, customer);
      results.push(result);
      if (!result.ok) break;
    }
    if (results.length) await notifySalesRoomSelectionChanged_();
    return Object.freeze({
      ok: results.every((result) => result.ok),
      processed: results.length,
      ready: results.filter((result) => result.ok && !result.routing).length,
      failed: results.filter((result) => !result.ok).length,
      routing,
      results
    });
  }
);

async function routeQueuedSelections_(items, customers, allowedCustomerIds) {
  const now = Date.now();
  const customerById = new Map(customers.map((customer) => [normalize(customer.customerId), customer]));
  const queue = items.filter((item) => {
    const payload = selectionPayload_(item);
    const status = upper(payload.qdSyncStatus);
    const retryAt = Date.parse(payload.qdNextRetryAt || '') || 0;
    const routingStartedAt = Date.parse(payload.qdLastAttemptAt || '') || 0;
    return allowedCustomerIds.has(normalize(payload.customerId))
      && !payload.removed
      && (['PENDING', 'FAILED'].includes(status) || (status === 'ROUTING' && routingStartedAt < now - 60000))
      && retryAt <= now;
  }).slice(0, 5);

  const results = [];
  for (const item of queue) {
    const payload = selectionPayload_(item);
    const customer = customerById.get(normalize(payload.customerId));
    if (!customer || !normalize(customer.qdFileId)) continue;
    const result = await routeOneSelection_(item, customer);
    results.push(result);
    if (!result.ok) break;
  }
  if (results.length) await notifySalesRoomSelectionChanged_();
  return Object.freeze({ ok: true, processed: results.length, results });
}

async function routeOneSelection_(item, customer) {
  const payload = selectionPayload_(item);
  const status = upper(payload.qdSyncStatus);
  if (status === 'READY') return Object.freeze({ ok: true, idempotent: true, selectionId: normalize(item._id) });
  const lastAttemptAt = Date.parse(payload.qdLastAttemptAt || '') || 0;
  if (status === 'ROUTING' && lastAttemptAt >= Date.now() - 60000) {
    return Object.freeze({ ok: true, routing: true, selectionId: normalize(item._id) });
  }
  const routing = {
    ...payload,
    qdSyncStatus: 'ROUTING',
    qdRouteAttempts: Number(payload.qdRouteAttempts || 0) + 1,
    qdLastAttemptAt: new Date().toISOString()
  };
  let current = await wixData.update(
    SELECTION_COLLECTION,
    { ...item, payload: JSON.stringify(routing) },
    { suppressAuth: true }
  );
  try {
    const sharedSecret = await getSecret(SECRET_NAME);
    const response = await postJson_(APPS_SCRIPT_ENDPOINT, {
      action: 'ADD_SELECTION',
      sharedSecret,
      customerId: normalize(payload.customerId),
      assignedStaffId: upper(customer.assignedStaffId),
      qdFileId: normalize(customer.qdFileId),
      wixMyListId: normalize(item._id),
      unitBarcode: normalizeBarcode_(payload.unitBarcode)
    });
    if (!response.ok || !response.body?.ok) {
      throw new Error(response.body?.error || 'Quotation Desk selection sync failed.');
    }
    const result = response.body.result || {};
    const ready = {
      ...routing,
      qdSyncStatus: 'READY',
      qdSyncedAt: new Date().toISOString(),
      qdNextRetryAt: '',
      qdRow: Number(result.qdRow || 0),
      lastError: ''
    };
    current = await wixData.update(
      SELECTION_COLLECTION,
      { ...current, payload: JSON.stringify(ready) },
      { suppressAuth: true }
    );
    return Object.freeze({ ok: true, idempotent: Boolean(result.idempotent), selectionId: normalize(item._id), qdRow: ready.qdRow });
  } catch (error) {
    const failed = {
      ...routing,
      qdSyncStatus: 'FAILED',
      qdNextRetryAt: new Date(Date.now() + 30000).toISOString(),
      lastError: normalize(error?.message || error)
    };
    await wixData.update(
      SELECTION_COLLECTION,
      { ...current, payload: JSON.stringify(failed) },
      { suppressAuth: true }
    );
    return Object.freeze({ ok: false, selectionId: normalize(item._id), error: failed.lastError });
  }
}

async function notifySalesRoomSelectionChanged_() {
  try {
    await wixRealtimeBackend.publish(
      { name: 'sales-room-signals' },
      { type: 'SELECTION_CHANGED', at: new Date().toISOString() }
    );
  } catch (error) {
    // CMS persistence is authoritative. The existing refresh is retained only
    // as a recovery fallback if the realtime channel is temporarily unavailable.
    console.warn('Sales Room realtime notification failed', error);
  }
}

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
    actorName,
    selectionLimit: selectionLimit_(customer)
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
  let result = await wixData.query(SELECTION_COLLECTION).startsWith('title', normalize(customerId) + '|').limit(1000).find({ suppressAuth: true, consistentRead: true });
  const items = [...result.items];
  while (result.hasNext()) { result = await result.next(); items.push(...result.items); }
  return items;
}

async function getSelectionById_(id) {
  try { return await wixData.get(SELECTION_COLLECTION, id, { suppressAuth: true, consistentRead: true }); } catch (_) { return null; }
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

function imageUrl_(value, depth = 0) {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'object') {
    const candidates = [value.url, value.id, value.src, value.image, value.imageInfo?.url, value.imageInfo?.id, value.media?.url, value.media?.id];
    for (const candidate of candidates) {
      const resolved = imageUrl_(candidate, depth + 1);
      if (resolved) return resolved;
    }
    return '';
  }
  const raw = normalize(value);
  if (!raw) return '';
  if (raw.startsWith('{')) {
    try { return imageUrl_(JSON.parse(raw), depth + 1); } catch (_) { /* Continue with string parsing. */ }
  }
  const wixImage = /^(?:wix:)?image:\/\/v1\/([^/#?]+)/i.exec(raw);
  if (wixImage) return `https://static.wixstatic.com/media/${encodeURIComponent(decodeURIComponent(wixImage[1]))}`;
  const wixCdn = /^https?:\/\/static\.wixstatic\.com\/media\/([^/#?]+)/i.exec(raw);
  if (wixCdn) return `https://static.wixstatic.com/media/${encodeURIComponent(decodeURIComponent(wixCdn[1]))}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[A-Za-z0-9_.~-]+\.(?:avif|bmp|gif|heic|jpeg|jpg|png|svg|tif|tiff|webp)$/i.test(raw)) return `https://static.wixstatic.com/media/${encodeURIComponent(raw)}`;
  return '';
}

function nodeHttpsRequest_(url, options, body = '') {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, options, (response) => {
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
    request.setTimeout(15000, () => request.destroy(new Error('QD service request timed out.')));
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
