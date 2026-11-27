import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import wixRealtimeBackend from 'wix-realtime-backend';
import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import { readCatalogueCustomerForStaff, requireCatalogueCustomerReady } from 'backend/catalogueStaffCustomerAccess.js';
import { removedSelectionExpired } from 'backend/buyerSelectionRetention.js';
import { resolveBuyerCompany } from 'backend/buyerCompanyAccess.js';

const STAFF_COLLECTION = 'StaffMaster';
const CUSTOMER_COLLECTION = 'WixCustomers';
const CUSTOMER_USER_COLLECTION = 'WixCustomerUsers';
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const SELECTION_COLLECTION = 'WixBuyerListItems';
const DEFAULT_SELECTION_LIMIT = 100;
const SELECTION_LIMITS = new Set([100, 300, 500, 700]);
function selectionProductIds_(items) {
  return [...new Set(items.flatMap(item => {
    const data = selectionPayload_(item);
    return [data.productId, ...(Array.isArray(data.productAliases) ? data.productAliases : [])];
  }).filter(Boolean))];
}
function selectionLimit_(customer) { const value = Number(customer?.selectionLimit); return SELECTION_LIMITS.has(value) ? value : DEFAULT_SELECTION_LIMIT; }

export const getCatalogueSelectionState = webMethod(
  Permissions.SiteMember,
  async (assistCustomerId = '') => {
    const context = await resolveSelectionContext_(assistCustomerId);
    const items = await selectionItemsForCustomer_(context.customerId);
    // Keep recent removals recoverable; the same durable selection can be reused after expiry.
    const now = Date.now();
    const selectedItems = items.filter(item => !removedSelectionExpired(selectionPayload_(item), now));
    const activeItems = selectedItems.filter((item) => !selectionPayload_(item).removed);
    const counts = { food: 0, household: 0, personalCare: 0, general: 0 };
    activeItems.forEach((item) => {
      const payload = selectionPayload_(item);
      counts[categoryBucket_(payload.mainCategory)] += 1;
    });
    return Object.freeze({
      ok: true,
      customerId: context.customerId,
      companyName: context.companyName,
      actorName: context.actorName,
      selectedProductIds: selectionProductIds_(selectedItems),
      removedProductIds: selectionProductIds_(selectedItems.filter(item => selectionPayload_(item).removed)),
      activeSelectedProductIds: activeItems.map((item) => selectionPayload_(item).productId).filter(Boolean),
      selectedBarcodes: [...new Set(selectedItems.flatMap((item) => {
        const data = selectionPayload_(item); return [data.unitBarcode, data.originalUnitBarcode];
      }).filter(Boolean))],
      counts,
      total: activeItems.length,
      selectionLimit: context.selectionLimit
    });
  }
);

export const addCatalogueSelection = webMethod(
  Permissions.SiteMember,
  async (productId, assistCustomerId = '') => {
    const context = await resolveSelectionContext_(assistCustomerId, 'ASSIST_SELECTION');
    const product = await getActiveProduct_(productId);
    const unitBarcode = normalizeBarcode_(product.barcode);
    if (!unitBarcode) throw new Error('This product is missing its Unit Barcode.');

    const title = context.customerId + '|' + unitBarcode;
    const selectionId = selectionId_(context.customerId, unitBarcode);
    const now = new Date().toISOString();
    let customerItems;
    let item = await getSelectionById_(selectionId);
    if (!item) {
      const legacy = await wixData.query(SELECTION_COLLECTION).eq('title', title).limit(2).find({ suppressAuth: true, consistentRead: true });
      if (legacy.items.length > 1) throw new Error('Duplicate selection records require admin review.');
      item = legacy.items[0] || null;
    }
    if (!item) {
      // A source-data correction must not create another selection for the same product.
      customerItems = await selectionItemsForCustomer_(context.customerId);
      const matches = customerItems
        .filter(record => normalize(selectionPayload_(record).productId) === normalize(product._id)
          || (Array.isArray(selectionPayload_(record).productAliases) && selectionPayload_(record).productAliases.includes(normalize(product._id))));
      if (matches.length > 1) throw new Error('Duplicate selection records require admin review.');
      item = matches[0] || null;

    }

    if (item && normalize(item.title) !== title && (normalize(selectionPayload_(item).productId) !== normalize(product._id)
      || normalize(selectionPayload_(item).customerId) !== context.customerId)) {
      throw new Error('Selection identity collision. Admin review is required.');
    }

    if (item) {
      const existing = selectionPayload_(item);
      if (existing.removed && !removedSelectionExpired(existing)) {
        throw new Error('Restore this product from Removed in Buyer Room to request a new quotation.');
      }
      if (existing.removed && (customerItems || await selectionItemsForCustomer_(context.customerId)).filter(record => !selectionPayload_(record).removed).length >= context.selectionLimit) {
        throw new Error(`My Selection is at its ${context.selectionLimit}-product limit. Remove an item before restoring this one.`);
      }
      if (normalize(item.customerId) === context.customerId &&
          item.removed === false && !existing.removed) {
        return Object.freeze({ ok: true, duplicate: true, selection: publicSelection_(item) });
      }
      const queued = {
        ...existing,
        removed: false,
        quoteStatus: 'RFQ',
        quoteActive: false,
        quotePerPc: 0,
        quotePerCtn: 0,
        vipPriceEa: 0,
        vipPriceCtn: 0,
        qdSyncStatus: '',
        recoveredAt: now,
        requoteRequestedAt: now,
        orderQtyCtn: 0
      };
      item = await wixData.update(
        SELECTION_COLLECTION,
        { ...item, customerId: context.customerId, removed: false, qdSyncStatus: upper(queued.qdSyncStatus), payload: JSON.stringify(queued) },
        { suppressAuth: true }
      );
    } else {
      const activeCount = (customerItems || await selectionItemsForCustomer_(context.customerId)).filter(record => !selectionPayload_(record).removed).length;
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
        productReference: productReference_({}, product),
        quoteStatus: 'RFQ',
        selectedAt: now,
        selectedByType: context.actorType,
        selectedById: context.actorId,
        selectedByName: context.actorName,
        source: context.actorType === 'STAFF' ? 'SALES_ROOM_ASSIST' : context.actorType === 'ADMIN' ? 'ADMIN_CATALOGUE' : 'BUYER_CATALOGUE',
        qdSyncStatus: '',
        lastError: ''
      };
      try {
        item = await wixData.insert(
          SELECTION_COLLECTION,
          { _id: selectionId, title, customerId: context.customerId, removed: false, qdSyncStatus: payload.qdSyncStatus, payload: JSON.stringify(payload) },
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
    return Object.freeze({ ok: true, queued: false, selection: publicSelection_(item) });
  }
);

function referenceText_(value) { return normalize(value).replace(/\s+/g, ' ').toUpperCase(); }
function productReference_(data, product = {}) {
  const stored = data.productReference || {};
  return {
    imageUrl: imageUrl_(stored.imageUrl || data.imageUrl || product.image),
    packingSize: normalize(stored.packingSize || data.packingSize || product.description),
    eaPerCtn: Number(stored.eaPerCtn || product.ea || product.price || 0),
    principle: normalize(stored.principle || product.principle)
  };
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

async function resolveSelectionContext_(assistCustomerId, staffAction = 'CATALOGUE_VIEW') {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member) throw new Error('Please sign in before selecting products.');
  const memberId = normalize(member._id);
  const email = memberEmail_(member);
  const scopedCompany = typeof assistCustomerId === 'object';
  const requestedCustomerId = scopedCompany ? '' : normalize(assistCustomerId);
  let actorType;
  let actorId;
  let actorName;
  let customer;

  if (scopedCompany) {
    const selected = await resolveBuyerCompany(member, member.loginEmail, assistCustomerId);
    customer = selected.customer;
    actorType = 'CUSTOMER_USER';
    actorId = normalize(selected.user.userId || selected.user._id);
    actorName = normalize(selected.user.title || email);
  } else if (requestedCustomerId) {
    const staff = await requireStaff_(member);
    customer = await readCatalogueCustomerForStaff(staff, requestedCustomerId, staffAction);
    actorType = staff.canViewAllCustomers ? 'ADMIN' : 'STAFF';
    actorId = staff.staffId;
    actorName = staff.staffName;
  } else {
    let matches = memberId ? (await wixData.query(CUSTOMER_USER_COLLECTION).eq('wixMemberId', memberId).limit(2).find({ suppressAuth: true })).items : [];
    if (!matches.length && email) matches = (await wixData.query(CUSTOMER_USER_COLLECTION).eq('email', email).limit(2).find({ suppressAuth: true })).items;
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

  if (!requestedCustomerId) requireCatalogueCustomerReady(customer);
  return {
    customerId: normalize(customer.customerId),
    companyName: normalize(customer.title),
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
  const staff = await getCurrentStaffContext();
  if (!staff?.authorized || (knownMember && normalize(knownMember._id) !== normalize(staff.memberId))) throw new Error('Staff sign-in is required.');
  return staff;
}

async function selectionItemsForCustomer_(customerId) {
  let result = await wixData.query(SELECTION_COLLECTION).eq('customerId', normalize(customerId)).limit(1000).find({ suppressAuth: true, consistentRead: true });
  const items = [...result.items];
  while (result.hasNext()) { result = await result.next(); items.push(...result.items); }
  return items;
}

async function allQueryItems_(query) {
  let result = await query.find({ suppressAuth: true, consistentRead: true });
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

function memberEmail_(member) {
  const loginEmail = member?.loginEmail || member?.contactDetails?.emails?.[0];
  return normalizeEmail_(typeof loginEmail === 'string' ? loginEmail : loginEmail?.email);
}
function normalizeBarcode_(value) { return String(value || '').replace(/\.0$/, '').trim(); }
function normalizeEmail_(value) { return String(value || '').trim().toLowerCase(); }
function normalize(value) { return String(value || '').trim(); }
function upper(value) { return normalize(value).toUpperCase(); }
