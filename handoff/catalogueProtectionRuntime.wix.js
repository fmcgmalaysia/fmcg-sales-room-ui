import { createHash, randomUUID } from 'crypto';
import https from 'https';
import { mediaManager } from 'wix-media-backend';
import { files } from 'wix-media.v2';
import { elevate } from 'wix-auth';
import wixData from 'wix-data';
import { currentMember } from 'wix-members-backend';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { customTrigger } from '@wix/automations';
import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import { getCatalogueSelectionState } from 'backend/catalogueSelection.web.js';
import { resolveBuyerCompany } from 'backend/buyerCompanyAccess.js';
const { validCatalogueReader, createCatalogueReadIdentity } = (() => {
// Actor names and member IDs come only from Wix and MASTER, never from a form.
function validCatalogueReader(actor) {
  return Boolean(actor?.actorId && (actor.customerId || (actor.scope === 'staff-preview' &&
    ['STAFF', 'ADMIN'].includes(actor.actorType))));
}

function createCatalogueReadIdentity({ getMember, readStaff, resolveBuyerCompany, getSelectionState }) {
  return async scope => {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).length !== 1) {
      throw Error('Choose a catalogue workspace.');
    }
    const member = await getMember();
    if (!member?._id) throw Error('Sign in to view the catalogue.');
    if (Object.hasOwn(scope, 'buyerCompanyId')) {
      const { customer, user } = await resolveBuyerCompany(member, member.loginEmail, scope);
      if (!customer?.customerId || customer.customerId !== scope.buyerCompanyId) throw Error('Company access unavailable.');
      return { actorId: member._id, actorType: 'CUSTOMER_USER', actorName: user.title || '',
        customerId: customer.customerId, companyName: customer.title || '' };
    }
    const preview = scope.staffPreview === true;
    const id = scope.assistCustomerId;
    if (!preview && (typeof id !== 'string' || !id.trim() || id.length > 160)) throw Error('Choose a catalogue workspace.');
    const staff = await readStaff();
    if (staff?.authorized !== true || staff.memberId !== member._id ||
        (staff.customerScope?.pages && !staff.customerScope.pages.includes('CATALOGUE'))) throw Error('Staff catalogue access unavailable.');
    const actor = { actorId: member._id, actorType: staff.canViewAllCustomers ? 'ADMIN' : 'STAFF', actorName: staff.staffName || '' };
    if (preview) return { ...actor, scope: 'staff-preview', customerId: '', companyName: '' };
    // Reuse the current assisted-selection authority, which includes both
    // CATALOGUE_VIEW for this customer and a ready quotation workspace.
    const selection = await getSelectionState(id);
    if (selection?.ok !== true || selection.customerId !== id) throw Error('Company access unavailable.');
    return { ...actor, customerId: selection.customerId, companyName: selection.companyName || '' };
  };
}

return { validCatalogueReader, createCatalogueReadIdentity };
})();
const { createCatalogueBudgetStore } = (() => {

// This collection must have administrator-only CMS permissions.
function createCatalogueBudgetStore({ data, patch, collection }) {
  const readOptions = { suppressAuth: true, consistentRead: true };
  async function read(key) {
    const result = await data.query(collection).eq('_id', key).limit(1).find(readOptions);
    const row = result.items[0];
    if (!row) return null;
    if (!Number.isSafeInteger(row.version) || row.version < 1 || !row.usage || !row.denials) {
      throw Error('Catalogue usage state unavailable.');
    }
    return row;
  }
  return {
    read,
    async dueAlerts(time, limit = 25) {
      const result = await data.query(collection).gt('nextAlertAt', 0).le('nextAlertAt', time)
        .ascending('nextAlertAt').limit(limit).find(readOptions);
      return result.items;
    },
    async replaceIfVersion(key, version, next) {
      const fields = { usage: next.usage, denials: next.denials, version: version + 1, reservationId: randomUUID() };
      const pending = Object.values(next.denials).filter(event => ['PENDING', 'SENDING', 'RETRY'].includes(event.status));
      fields.nextAlertAt = pending.length ? Math.min(...pending.map(event => event.retryAfter || event.at || 1)) : 0;
      if (!version) {
        try {
          await data.insert(collection, { _id: key, ...fields }, { suppressAuth: true });
          return true;
        } catch (error) {
          if (await read(key)) return false;
          throw error;
        }
      }
      const updates = Object.entries(fields).map(([fieldPath, value]) => ({ fieldPath, action: 'SET_FIELD', value }));
      try {
        const saved = await patch(collection, key, updates, { condition: { version: { $eq: version } } });
        return saved?.version === version + 1 && saved.reservationId === fields.reservationId;
      } catch (error) {
        const current = await read(key);
        if (current && current.version !== version) return false;
        throw error;
      }
    }
  };
}

return { createCatalogueBudgetStore };
})();
const { createCatalogueReadBudget } = (() => {

const actions = new Set(['CATALOGUE_LIST', 'CATALOGUE_DETAIL', 'BUYER_IMAGE']);

// One row per authenticated member across all of that member's companies.
// Windows use rolling buckets. Keeping the entire oldest partial bucket
// avoids admitting two full quotas on opposite sides of a window boundary.
function createCatalogueReadBudget({ store, policy, onIncident, now = Date.now }) {
  for (const action of actions) {
    const rule = policy?.[action];
    if (!Number.isSafeInteger(rule?.bucketMs) || rule.bucketMs < 1 ||
        !Number.isSafeInteger(rule.buckets) || rule.buckets < 1 || rule.buckets > 60 ||
        !Number.isSafeInteger(rule.limit) || rule.limit < 1) throw Error('Invalid read budget policy.');
  }
  return async function reserveRead(actor, action, units) {
    if (!validCatalogueReader(actor) || !actions.has(action) || !Number.isSafeInteger(units) || units < 1) return false;
    const key = createHash('sha256').update('catalogue-member:' + actor.actorId).digest('hex').slice(0, 32);
    const rule = policy[action];
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await store.read(key);
      const tick = Math.floor(now() / rule.bucketMs);
      const previous = row?.usage?.[action] ?? [];
      if (!Number.isSafeInteger(tick) || !Array.isArray(previous) || previous.some(entry =>
        !Number.isSafeInteger(entry?.tick) || entry.tick < 0 || entry.tick > tick ||
        !Number.isSafeInteger(entry.units) || entry.units < 1)) return false;
      const usage = previous.filter(entry => entry.tick >= tick - rule.buckets);
      const used = usage.reduce((total, item) => total + item.units, 0);
      const denied = used + units > rule.limit;
      // Persist the first denial with the responsible company before returning.
      // The owner alert can be dispatched independently of the product read.
      const last = row?.denials?.[action];
      if (denied && last && (tick - last.tick <= rule.buckets ||
          ['PENDING', 'SENDING', 'RETRY'].includes(last.status))) return false;
      const next = { usage: { ...row?.usage }, denials: { ...row?.denials } };
      if (denied) {
        next.denials[action] = { tick, companyId: actor.customerId, companyName: actor.companyName || '',
          actorName: actor.actorName || '', actorType: actor.actorType || '', action, used, requested: units,
          at: now(), status: 'PENDING' };
      } else {
        const current = usage.find(entry => entry.tick === tick);
        next.usage[action] = usage.filter(entry => entry.tick !== tick);
        next.usage[action].push({ tick, units: (current?.units ?? 0) + units });
      }
      if (await store.replaceIfVersion(key, row?.version ?? 0, next)) {
        if (denied && onIncident) await onIncident(key, action);
        return !denied;
      }
    }
    return false;
  };
}

return { createCatalogueReadBudget };
})();
const { catalogueCoverageKey, createCatalogueCoverage } = (() => {

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 32);
const catalogueCoverageKey = (actorId, action) => hash('catalogue-coverage:' + action + ':' + actorId);

// Called with the actual product IDs immediately before returning a response.
// A company switch changes incident attribution but retains the member's quota.
function createCatalogueCoverage({ store, policy, onIncident, now = Date.now }) {
  for (const action of ['CATALOGUE_LIST', 'CATALOGUE_DETAIL', 'BUYER_IMAGE']) {
    const rule = policy?.[action];
    if (!Number.isSafeInteger(rule?.windowMs) || rule.windowMs < 1 ||
        !Number.isSafeInteger(rule.warnAt) || rule.warnAt < 1 ||
        !Number.isSafeInteger(rule.limit) || rule.limit < rule.warnAt || rule.limit > 2000) {
      throw Error('Invalid catalogue coverage policy.');
    }
  }
  return async (actor, action, ids) => {
    if (!validCatalogueReader(actor) || !Object.hasOwn(policy, action) ||
        !Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id || id.length > 128)) return false;
    if (!ids.length) return true;
    const rule = policy[action];
    const requested = [...new Set(ids.map(hash))];
    const key = catalogueCoverageKey(actor.actorId, action);
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await store.read(key);
      const time = now();
      const seen = {};
      for (const [id, timestamp] of Object.entries(row?.usage ?? {})) {
        if (!Number.isSafeInteger(timestamp) || timestamp > time) return false;
        if (timestamp > time - rule.windowMs) seen[id] = timestamp;
      }
      const used = Object.keys(seen).length;
      const added = requested.filter(id => !Object.hasOwn(seen, id)).length;
      const denied = used + added > rule.limit;
      const severity = denied ? 'restricted' : used + added >= rule.warnAt ? 'warning' : '';
      const denials = { ...row?.denials };
      const recent = severity && denials[severity]?.at > time - rule.windowMs;
      const outstanding = severity && ['PENDING', 'SENDING', 'RETRY'].includes(denials[severity]?.status);
      const newIncident = severity && !recent && !outstanding;
      if (denied && !newIncident) return false;
      if (newIncident) {
        denials[severity] = {
          at: time, companyId: actor.customerId, companyName: actor.companyName || '',
          actorName: actor.actorName || '', actorType: actor.actorType || '', action,
          deliveredUnique: denied ? used : used + added, attemptedNew: added, status: 'PENDING'
        };
      }
      if (!denied) for (const id of requested) seen[id] = time;
      if (await store.replaceIfVersion(key, row?.version ?? 0, { usage: seen, denials })) {
        if (newIncident && onIncident) await onIncident(key, severity);
        return !denied;
      }
    }
    return false;
  };
}

return { catalogueCoverageKey, createCatalogueCoverage };
})();
const { createCatalogueRiskAlert, retryCatalogueAlerts } = (() => {

const labels = { CATALOGUE_LIST: 'products in the catalogue', CATALOGUE_DETAIL: 'product details', BUYER_IMAGE: 'high-resolution images' };

// Deliver only incidents previously recorded by the read gate. The caller
// supplies the private ledger row identity, never notification text or names.
function createCatalogueRiskAlert({ store, send, now = Date.now }) {
  return async function deliver(key, severity) {
    const burst = Object.hasOwn(labels, severity);
    if (!burst && !['warning', 'restricted'].includes(severity)) return 'ignored';
    const token = randomUUID();
    const row = await store.read(key);
    const event = row?.denials?.[severity];
    if (!event || !Object.hasOwn(labels, event.action) || event.status === 'ACCEPTED' ||
        (event.retryAfter ?? 0) > now()) return 'ignored';
    const attempts = (event.attempts || 0) + 1;
    const claim = { ...event, token, status: 'SENDING', attempts, retryAfter: now() + 300000 };
    const fields = { usage: row.usage, denials: { ...row.denials, [severity]: claim } };
    if (!await store.replaceIfVersion(key, row.version, fields)) return 'busy';
    const name = event.actorType === 'STAFF' || event.actorType === 'ADMIN'
      ? event.actorName || 'Staff member' : event.companyName || event.companyId;
    const status = severity === 'restricted' ? 'Additional access limited' : 'Review activity';
    const message = burst ? 'High read rate · Further requests limited · ' + labels[event.action]
      : status + ' · ' + event.deliveredUnique + ' distinct ' + labels[event.action];
    const notificationText = ((name || 'Catalogue user') + ' · ' + message).slice(0, 200);
    let accepted = false;
    try {
      await send({ notificationText, entryType: 'catalogue-security' });
      accepted = true;
    } catch {
      // Leave failures visible for the scheduled retry. A timeout can be
      // ambiguous: a later retry may duplicate an already-delivered push.
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await store.read(key);
      if (current?.denials?.[severity]?.token !== token) return 'claim-changed';
      const updated = { ...claim, status: accepted ? 'ACCEPTED' : 'RETRY',
        retryAfter: accepted ? 0 : now() + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6)) };
      if (await store.replaceIfVersion(key, current.version, {
        usage: current.usage, denials: { ...current.denials, [severity]: updated }
      })) return updated.status;
    }
    return 'unconfirmed';
  };
}

// Runs independently of whether the account comes back. One scheduled run
// processes a bounded batch; pending items stay eligible on the next run.
async function retryCatalogueAlerts(store, deliver, now = Date.now) {
  const time = now();
  const rows = await store.dueAlerts(time);
  let failures = 0;
  for (const row of rows) {
    for (const [severity, event] of Object.entries(row.denials)) {
      if (!['PENDING', 'RETRY', 'SENDING'].includes(event.status) || event.retryAfter > time) continue;
      try { await deliver(row._id, severity); }
      catch { failures++; }
    }
  }
  if (failures) throw Error('Catalogue alert retry incomplete.');
}

return { createCatalogueRiskAlert, retryCatalogueAlerts };
})();
const { createCataloguePageIndex } = (() => {
// The Wix page previously sorted the full product list inside each browser.
// Keep only search and ordering fields in this server-side index. Recheck the
// current page against the active CMS rows before returning anything.
const options = { suppressAuth: true, consistentRead: true };
const text = value => String(value ?? '').trim();
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const sortKeys = ['pointBaseSortId', 'sortNo', 'sortNO', 'sortNumber', 'sortOrder'];
const listFields = ['_id', 'name', 'title', 'description', 'packingSize', 'barcode', 'unitBarcode', 'brandName', 'principle'];

function listItem(row) {
  return {
    id: row._id, name: text(row.name || row.title), description: text(row.description || row.packingSize),
    barcode: text(row.barcode || row.unitBarcode), brandName: text(row.brandName), principle: text(row.principle)
  };
}

function compare(left, right) {
  const brand = Number(!left.brandName) - Number(!right.brandName) || collator.compare(left.brandName, right.brandName);
  if (brand) return brand;
  const a = left.sortNumber, b = right.sortNumber;
  if (!a || !b) return Number(!a) - Number(!b);
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : collator.compare(a, b);
}

async function collect(query) {
  const rows = [];
  let page = await query.limit(1000).find(options);
  for (;;) {
    rows.push(...page.items);
    if (!page.hasNext()) return rows;
    page = await page.next();
  }
}

function createCataloguePageIndex(data, now = Date.now) {
  const active = () => data.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE');
  let cached, pending, expires = 0;
  async function ordered() {
    if (cached && now() < expires) return cached;
    if (!pending) pending = collect(active().fields(...listFields, ...sortKeys)).then(rows => {
      const seen = new Set();
      cached = rows.map(row => {
        const entry = listItem(row);
        entry.sortNumber = text(sortKeys.map(key => row[key]).find(value => value != null));
        entry.searchText = [entry.name, entry.description, entry.barcode, entry.principle, entry.brandName].join(' ').toLowerCase();
        return entry;
      }).filter(entry => {
        if (!entry.id || !entry.name || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      }).sort(compare);
      expires = now() + 60000;
      return cached;
    }).finally(() => { pending = null; });
    return pending;
  }

  return async function page({ term, principle, subcategories, afterId, anchorId, size, selectedIds }) {
    const matching = () => subcategories.length ? active().hasSome('subCategories', subcategories) : active();
    const [index, categoryRows] = await Promise.all([
      ordered(), subcategories.length ? collect(matching().fields('_id')) : null
    ]);
    const categoryIds = categoryRows && new Set(categoryRows.map(row => row._id));
    const search = term.toLowerCase(), brand = principle.toLowerCase();
    const matches = index.filter(item => (!selectedIds || selectedIds.has(item.id)) && (!categoryIds || categoryIds.has(item.id)) &&
      (!brand || item.principle.toLowerCase() === brand) && (!search || item.searchText.includes(search)));
    const anchor = anchorId ? matches.findIndex(item => item.id === anchorId) : -1;
    const from = afterId ? matches.findIndex(item => item.id === afterId) + 1 : anchor >= 0 ? Math.floor(anchor / size) * size : 0;
    if (afterId && !from) throw Error('Catalogue changed. Refresh the product list.');
    const previousAfterId = from === 0 ? null : from <= size ? '' : matches[from - size - 1].id;
    let position = from;
    const items = [];
    while (items.length <= size && position < matches.length) {
      const ids = matches.slice(position, position + size + 1 - items.length).map(item => item.id);
      position += ids.length;
      const result = await matching().hasSome('_id', ids).fields(...listFields).limit(ids.length).find(options);
      const live = new Map(result.items.map(row => [row._id, listItem(row)]));
      for (const id of ids) {
        const item = live.get(id);
        if (item?.name) items.push(item);
      }
    }
    return { items: items.slice(0, size), previousAfterId, afterId: items.length > size ? items[size - 1].id : null };
  };
}

return { createCataloguePageIndex };
})();
const { createCatalogueSelectionScope } = (() => {
// My Selection totals cover the whole company selection, including products
// outside the loaded catalogue page. Only the existing selection authority
// supplies the IDs. Food classification follows the published Catalogue.
const options = { suppressAuth: true, consistentRead: true };
const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();
async function collect(query) {
  let result = await query.limit(1000).find(options);
  const rows = [...result.items];
  while (result.hasNext()) { result = await result.next(); rows.push(...result.items); }
  return rows;
}

function createCatalogueSelectionScope({ data, getSelectionState, now = Date.now }) {
  let taxonomy, pending, expires = 0;
  const active = () => data.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE');
  async function loadTaxonomy() {
    const categories = await collect(data.query('subCategories').fields('_id', 'mainCategory'));
    const main = new Map(categories.map(row => [row._id, upper(row.mainCategory)]));
    const foodIds = [...main].filter(([, category]) => category.startsWith('FOOD')).map(([id]) => id);
    const food = new Set(), principles = new Set();
    for (let i = 0; i < foodIds.length; i += 100) {
      const rows = await collect(active().hasSome('subCategories', foodIds.slice(i, i + 100)).fields('_id', 'principle'));
      for (const row of rows) {
        food.add(row._id);
        if (text(row.principle)) principles.add(upper(row.principle));
      }
    }
    taxonomy = { main, food, principles };
    expires = now() + 60000;
    return taxonomy;
  }
  function readTaxonomy() {
    if (taxonomy && now() < expires) return taxonomy;
    if (!pending) pending = loadTaxonomy().finally(() => { pending = null; });
    return pending;
  }
  return async (scope, actor) => {
    if (actor.scope === 'staff-preview') return { ids: new Set(), food: new Set() };
    const selection = await getSelectionState(scope.assistCustomerId || { buyerCompanyId: actor.customerId });
    if (selection?.ok !== true || selection.customerId !== actor.customerId || !Array.isArray(selection.activeSelectedProductIds)) {
      throw Error('Company selection unavailable.');
    }
    const ids = new Set(selection.activeSelectedProductIds.filter(id => typeof id === 'string' && id));
    const food = new Set();
    if (!ids.size) return { ids, food };
    const groups = await readTaxonomy(), selected = [...ids];
    for (let i = 0; i < selected.length; i += 100) {
      const rows = await collect(active().hasSome('_id', selected.slice(i, i + 100))
        .fields('_id', 'name', 'title', 'principle', 'subCategories', 'mainCategory'));
      for (const row of rows) {
        if (!text(row.name || row.title)) continue;
        const refs = Array.isArray(row.subCategories) ? row.subCategories : [row.subCategories];
        const main = refs.map(ref => groups.main.get(ref?._id || ref)).find(Boolean) || upper(row.mainCategory);
        if (groups.food.has(row._id) || groups.principles.has(upper(row.principle)) || main.startsWith('FOOD')) food.add(row._id);
      }
    }
    return { ids, food };
  };
}

return { createCatalogueSelectionScope };
})();
const { createVerifiedCatalogueMedia, verifyCatalogueImageAsset, createCataloguePreviewReader } = (() => {
// Only independent, low-resolution private files may be delivered as catalogue previews.
// Asset verification is an internal migration step. It never deletes a source file.
const mediaId = uri => typeof uri === 'string' && /^wix:image:\/\/v1\/([a-zA-Z0-9_.~-]+)\//.exec(uri)?.[1];
const withinPreviewBounds = info => Number.isSafeInteger(info?.width) && Number.isSafeInteger(info?.height)
  && Math.min(info.width, info.height) > 0 && Math.max(info.width, info.height) <= 320;
const readyImage = (info, id) => info?.opStatus === 'READY' && info.mediaType === 'image' && mediaId(info.fileUrl) === id;
// The legacy FileInfo returned by this Wix site omits opStatus, even on ready files.
// Read processing status from the matching v2 descriptor before accepting an image.
function createVerifiedCatalogueMedia(manager, describeFile) {
  return {
    getDownloadUrl: (...args) => manager.getDownloadUrl(...args),
    async getFileInfo(uri) {
      const id = mediaId(uri);
      if (!id) throw Error('Invalid image reference.');
      const [info, descriptor] = await Promise.all([manager.getFileInfo(uri), describeFile(id)]);
      if (descriptor?._id !== id || descriptor.mediaType !== 'IMAGE' || descriptor.private !== info.isPrivate ||
          mediaId(info.fileUrl) !== id) throw Error('Inconsistent image metadata.');
      return { ...info, opStatus: descriptor.operationStatus };
    }
  };
}
async function verifyCatalogueImageAsset({ productId, source, original, preview }, media) {
  const ids = [source, original, preview].map(mediaId);
  if (typeof productId !== 'string' || !productId || ids.some(id => !id) || new Set(ids).size !== 3) throw Error('Three independent image files are required.');
  const [base, hd, small] = await Promise.all([source, original, preview].map(uri => media.getFileInfo(uri)));
  if (!readyImage(base, ids[0]) || !readyImage(hd, ids[1]) || hd.isPrivate !== true ||
      !base.hash || base.hash !== hd.hash || !base.sizeInBytes || base.sizeInBytes !== hd.sizeInBytes ||
      !(base.width > 0 && base.height > 0) || base.width !== hd.width || base.height !== hd.height) {
    throw Error('Private original could not be verified.');
  }
  if (!readyImage(small, ids[2]) || small.isPrivate !== true || !withinPreviewBounds(small) ||
      !small.hash || small.hash === hd.hash || !Number.isSafeInteger(small.sizeInBytes) ||
      small.sizeInBytes < 1 || small.sizeInBytes > 100000) throw Error('Private preview could not be verified.');
  return { _id: productId, status: 'VERIFIED', fileUrl: hd.fileUrl, previewFileUrl: small.fileUrl,
    sourceId: ids[0], originalId: ids[1], previewWidth: small.width, previewHeight: small.height,
    originalHash: hd.hash, previewHash: small.hash };
}

function createCataloguePreviewReader({ data, media, now = Date.now }) {
  const cache = new Map();
  async function sign(row) {
    const uri = row.previewFileUrl, id = mediaId(uri);
    if (row.status !== 'VERIFIED' || !id || !row.sourceId || !row.originalId ||
        row.sourceId === row.originalId || id === row.sourceId || id === row.originalId ||
        !withinPreviewBounds({ width: row.previewWidth, height: row.previewHeight })) return '';
    const hit = cache.get(uri);
    if (hit && hit.until > now()) return hit.url;
    const url = await media.getDownloadUrl(uri, 2, null, null);
    if (typeof url !== 'string' || !url.startsWith('https://')) return '';
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    cache.set(uri, { until: now() + 60000, url });
    return url;
  }
  return async products => {
    if (!products.length) return products;
    if (products.length > 50) throw Error('Too many catalogue previews.');
    let rows;
    try {
      const result = await data.query('CatalogueImageAssets').hasSome('_id', products.map(p => p.id))
        .eq('status', 'VERIFIED').fields('_id', 'status', 'sourceId', 'originalId', 'previewFileUrl', 'previewWidth', 'previewHeight')
        .limit(products.length).find({ suppressAuth: true, consistentRead: true });
      rows = result.items;
    } catch {
      console.warn('Catalogue preview lookup unavailable.');
      return products.map(p => ({ ...p, image: '' }));
    }
    const images = new Map();
    for (let i = 0; i < rows.length; i += 5) {
      await Promise.all(rows.slice(i, i + 5).map(async row => {
        try { images.set(row._id, await sign(row)); }
        catch { /* An unavailable preview must not expose the original. */ }
      }));
    }
    return products.map(p => ({ ...p, image: images.get(p.id) || '' }));
  };
}

return { createVerifiedCatalogueMedia, verifyCatalogueImageAsset, createCataloguePreviewReader };
})();
const { cleanCatalogueJpeg, createCatalogueLegacyPreview } = (() => {

const IMAGE_URL = /^wix:image:\/\/v1\/([\w~-]+\.(?:jpe?g|png|webp))\//i;
const WIX_CDN = /^https:\/\/static\.wixstatic\.com\/media\/([\w~-]+\.(?:jpe?g|png|webp))$/i;
const MAX_BYTES = 24000;
const EDGE = 128;
const OPTIONS = { suppressAuth:true, consistentRead:true };

function previewBytes(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode !== 200 || !/^image\/jpeg\b/i.test(response.headers['content-type'] || '')) {
        response.destroy();
        reject(Error('Preview unavailable.'));
        return;
      }
      let size = 0;
      const chunks = [];
      response.on('error', reject);
      response.on('aborted', () => reject(Error('Preview interrupted.')));
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BYTES) response.destroy(Error('Preview is too large.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks, size)));
    });
    request.setTimeout(1200, () => request.destroy(Error('Preview timed out.')));
    request.on('error', reject);
  });
}

// Return only the JPEG picture data. Application and comment segments can contain original
// metadata or embedded files. Reject unsupported or malformed files instead of returning them.
function cleanCatalogueJpeg(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES || bytes.length < 16 ||
      bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length-2) !== 0xffd9) return '';
  const parts = [bytes.subarray(0,2)];
  let dimensions = false;
  for (let at=2; at+4<bytes.length;) {
    if (bytes[at] !== 0xff) return '';
    const marker = bytes[at+1];
    const length = bytes.readUInt16BE(at+2);
    const end = at+2+length;
    if (length < 2 || end > bytes.length-2) return '';
    if (marker === 0xc0) {
      if (length < 8 || dimensions) return '';
      const height = bytes.readUInt16BE(at+5);
      const width = bytes.readUInt16BE(at+7);
      if (!width || !height || width > EDGE || height > EDGE) return '';
      dimensions = true;
    }
    if (marker === 0xda) {
      if (!dimensions) return '';
      // Accept only one baseline scan. Entropy data can contain stuffed bytes and
      // restart markers. Extra sections, metadata and trailing data are disallowed.
      for (let cursor=end;cursor<bytes.length-2;cursor++) {
        if (bytes[cursor] !== 0xff) continue;
        const tag=bytes[++cursor];
        if (tag !== 0 && !(tag >= 0xd0 && tag <= 0xd7)) return '';
      }
      parts.push(bytes.subarray(at));
      return 'data:image/jpeg;base64,'+Buffer.concat(parts).toString('base64');
    }
    if ([0xc0,0xc4,0xdb,0xdd].includes(marker)) parts.push(bytes.subarray(at,end));
    else if (marker !== 0xfe && !(marker >= 0xe0 && marker <= 0xef)) return '';
    at=end;
  }
  return '';
}

// Only selected page IDs reach this adapter. Deliver the small picture, never the
// source reference. The protected service checks permission and budget before calling.
function createCatalogueLegacyPreview({data, download=previewBytes, now=Date.now}) {
  const cache=new Map();
  const pending=new Map();
  return async products => {
    const missing=products.filter(p=>!p.image);
    if (!missing.length || missing.length > 50) return products;
    let rows;
    try {
      const page=await data.query('FMCGMALAYSIA').eq('pointBaseStatus','ACTIVE')
        .hasSome('_id',missing.map(p=>p.id)).fields('_id','image').limit(missing.length).find(OPTIONS);
      rows=page.items;
    } catch { return products; }
    const ready=new Map();
    let pointer=0;
    async function worker() {
      while (pointer < rows.length) {
        const row=rows[pointer++];
        if (typeof row.image !== 'string') continue;
        const id=(IMAGE_URL.exec(row.image)||WIX_CDN.exec(row.image))?.[1];
        if (!id) continue;
        const hit=cache.get(id);
        if (hit?.until > now()) {
          ready.set(row._id,hit.image);
          continue;
        }
        let task=pending.get(id);
        if (!task) {
          task=download('https://static.wixstatic.com/media/'+id+'/v1/fit/w_128,h_128/file.jpg')
            .then(cleanCatalogueJpeg).catch(()=> '').then(image=>{
              if(cache.size>=500)cache.delete(cache.keys().next().value);
              cache.set(id,{image,until:now()+(image?300000:30000)});
              return image;
            }).finally(()=>pending.delete(id));
          pending.set(id,task);
        }
        ready.set(row._id,await task);
      }
    }
    await Promise.all(Array.from({length:Math.min(rows.length,8)},worker));
    return products.map(p=>p.image||!ready.get(p.id)?p:{...p,image:ready.get(p.id)});
  };
}

return { cleanCatalogueJpeg, createCatalogueLegacyPreview };
})();
const { buyerImageLink, openBuyerImage } = (() => {
const buyerRoom = 'https://www.fmcgmalaysia.com/buyer-room';
const validCompany = value => typeof value === 'string' && /^CUS-[a-z\d-]{1,80}$/i.test(value);
const validItem = value => typeof value === 'string' && /^[a-z\d_-]{1,128}$/i.test(value);

// Persistent workbook links identify a selection. They never grant file access.
function buyerImageLink(companyId, selectionId) {
  if (!validCompany(companyId) || !validItem(selectionId)) return '';
  const url = new URL(buyerRoom);
  url.searchParams.set('company', companyId);
  url.searchParams.set('imageSelection', selectionId);
  return url.toString();
}

async function openBuyerImage({ companyId, selectionId }, services) {
  const unavailable = () => new Error('This product image is unavailable for this account.');
  if (!validCompany(companyId) || !validItem(selectionId)) throw unavailable();
  const buyer = await services.authorize(companyId);
  if (!buyer || buyer.customerId !== companyId) throw unavailable();
  const selection = await services.getSelection(selectionId);
  if (!selection || selection._id !== selectionId || selection.customerId !== companyId || selection.removed) throw unavailable();
  const payload = typeof selection.payload === 'string' ? JSON.parse(selection.payload) : selection.payload;
  if (!payload || payload.customerId !== companyId || payload.removed || !validItem(payload.productId)) throw unavailable();
  if (await services.reserveDownload(buyer, payload.productId) !== true) throw unavailable();
  const asset = await services.getPrivateAsset(payload.productId);
  const originalId = /^wix:image:\/\/v1\/([a-zA-Z0-9_.~-]+)\//.exec(asset?.fileUrl)?.[1];
  if (!asset || asset._id !== payload.productId || asset.status !== 'VERIFIED' || !originalId ||
      originalId !== asset.originalId || !asset.sourceId || asset.sourceId === originalId || !asset.originalHash) throw unavailable();
  const info = await services.media.getFileInfo(asset.fileUrl);
  if (info?.isPrivate !== true || info.fileUrl !== asset.fileUrl || info.hash !== asset.originalHash || info.opStatus !== 'READY') throw unavailable();
  const url = await services.media.getDownloadUrl(info.fileUrl, 1, null, null);
  if (!url || new URL(url).protocol !== 'https:') throw unavailable();
  return { url };
}

return { buyerImageLink, openBuyerImage };
})();
const { createProtectedCatalogueRead } = (() => {

// Internal service. The Wix web method supplies the existing company/employee
// access resolver and the server-side usage control for the current request.
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const OPTIONS = { suppressAuth: true, consistentRead: true };
const LIST_FIELDS = ['_id', 'name', 'title', 'description', 'packingSize', 'barcode', 'unitBarcode', 'brandName', 'principle'];
const DETAIL_FIELDS = [...LIST_FIELDS, 'ea', 'EA', 'price', 'innerBoxBarcode', 'cartonBarcode', 'm3Ctn', 'cbmPerCtn', 'cbm', 'countryOrigin', 'shelflife', 'shelfLife', 'unitPrice', 'pricePerUnit', 'currency'];

function boundedText(value, length) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > length) throw new Error('Invalid catalogue request.');
  return value.trim();
}

function listItem(item) {
  return {
    id: String(item._id), name: String(item.name || item.title || ''),
    description: String(item.description || item.packingSize || ''),
    barcode: String(item.barcode || item.unitBarcode || ''),
    brandName: String(item.brandName || ''), principle: String(item.principle || '')
  };
}

function createProtectedCatalogueRead({ data, authorize, reserveRead, reserveCoverage, readSelection, addPreviews }) {
  const page = createCataloguePageIndex(data);
  function activeProducts() {
    return data.query(PRODUCT_COLLECTION).eq('pointBaseStatus', 'ACTIVE');
  }

  async function allowed(scope, action, units) {
    const actor = await authorize(scope);
    if (!validCatalogueReader(actor)) throw new Error('Catalogue access unavailable.');
    if (await reserveRead(actor, action, units) !== true) throw new Error('Catalogue access temporarily limited.');
    return actor;
  }

  return {
    async list(scope, input = {}) {
      const term = boundedText(input.term, 120);
      const principle = boundedText(input.principle, 150);
      const afterId = boundedText(input.afterId, 128);
      const anchorId = boundedText(input.anchorId, 128);
      if (anchorId && afterId) throw Error('Choose one page position.');
      const subcategories = input.subcategories ?? [];
      if (!Array.isArray(subcategories) || subcategories.length > 100 ||
          subcategories.some(id => !boundedText(id, 128))) throw new Error('Invalid catalogue category.');
      const size = input.size ?? 25;
      if (size !== 25 && size !== 50) throw new Error('Invalid catalogue page size.');
      const view = input.selectionView ?? '';
      if (!['', 'ALL', 'FOOD', 'NON_FOOD'].includes(view)) throw new Error('Invalid selection view.');
      const actor = await allowed(scope, 'CATALOGUE_LIST', size);
      let selectedIds;
      if (view) {
        const { ids, food } = await readSelection(scope, actor);
        selectedIds = view === 'FOOD' ? food : view === 'NON_FOOD' ? new Set([...ids].filter(id => !food.has(id))) : ids;
      }
      const { items, afterId: nextId, previousAfterId } = await page({ term, principle, subcategories, afterId, anchorId, size, selectedIds });
      if (await reserveCoverage(actor, 'CATALOGUE_LIST', items.map(item => item.id)) !== true) throw new Error('Catalogue access temporarily limited.');
      const products = addPreviews ? await addPreviews(items) : items;
      return { items: products, afterId: nextId, previousAfterId };
    },

    async principles(scope, category) {
      const id = boundedText(category, 128);
      if (!id) throw Error('Choose a catalogue category.');
      await allowed(scope, 'CATALOGUE_LIST', 1);
      const result = await activeProducts().hasSome('subCategories', [id]).limit(1000).distinct('principle', OPTIONS);
      return [...new Set(result.items.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];
    },

    async selectionCounts(scope) {
      const actor = await allowed(scope, 'CATALOGUE_LIST', 1);
      const { ids, food } = await readSelection(scope, actor);
      return { total: ids.size, food: food.size, nonFood: ids.size - food.size };
    },

    async detail(scope, productId) {
      const id = boundedText(productId, 128);
      if (!id) throw new Error('Select a product.');
      const actor = await allowed(scope, 'CATALOGUE_DETAIL', 1);
      const result = await activeProducts().eq('_id', id).fields(...DETAIL_FIELDS).limit(1).find(OPTIONS);
      const item = result.items[0];
      if (!item) return null;
      if (await reserveCoverage(actor, 'CATALOGUE_DETAIL', [id]) !== true) throw new Error('Catalogue access temporarily limited.');
      const unitPrice = [item.unitPrice, item.pricePerUnit].map(Number).find(n => Number.isFinite(n) && n > 0);
      return {
        ...listItem(item), ea: item.ea ?? item.EA ?? item.price ?? '',
        innerBoxBarcode: String(item.innerBoxBarcode || ''), cartonBarcode: String(item.cartonBarcode || ''),
        cbmPerCtn: item.m3Ctn ?? item.cbmPerCtn ?? item.cbm ?? '', countryOrigin: String(item.countryOrigin || ''),
        shelfLife: String(item.shelflife || item.shelfLife || ''), unitPrice: unitPrice ?? null,
        currency: String(item.currency || 'USD').toUpperCase()
      };
    }
  };
}

return { createProtectedCatalogueRead };
})();

const collection = 'CatalogueProtection';
const verifiedMedia = createVerifiedCatalogueMedia(mediaManager, elevate(files.getFileDescriptor));
const store = createCatalogueBudgetStore({ data: wixData, patch: auth.elevate(items.patch), collection });
const runTrigger = auth.elevate(customTrigger.runTrigger);
const authorize = createCatalogueReadIdentity({
  getMember: () => currentMember.getMember({ fieldsets: ['FULL'] }),
  readStaff: getCurrentStaffContext, resolveBuyerCompany, getSelectionState: getCatalogueSelectionState
});

let cached, expires = 0, loading;
export async function getCatalogueProtection() {
  if (cached && Date.now() < expires) return cached;
  if (!loading) loading = load().finally(() => { loading = null; });
  return loading;
}

async function load() {
  // The admin-only row supplies the thresholds tested for this Wix site.
  // Other sites' QA triggers and thresholds must never become defaults here.
  const config = await wixData.get(collection, 'read-policy', { suppressAuth: true, consistentRead: true });
  if (!config || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(config.triggerId)) {
    throw Error('Catalogue protection settings unavailable.');
  }
  const deliver = createCatalogueRiskAlert({ store, send: payload => runTrigger({ triggerId: config.triggerId, payload }) });
  async function onIncident(key, severity) {
    // The ledger already owns the incident. Its retry date survives temporary
    // delivery failures or a backend process stopping before the trigger runs.
    try { await deliver(key, severity); }
    catch { console.warn('Catalogue security notice queued for retry.'); }
  }
  const reserveRead = createCatalogueReadBudget({ store, policy: config.readPolicy, onIncident });
  const reserveCoverage = createCatalogueCoverage({ store, policy: config.coveragePolicy, onIncident });
  const readSelection = createCatalogueSelectionScope({ data: wixData, getSelectionState: getCatalogueSelectionState });
  const privatePreviews = createCataloguePreviewReader({ data: wixData, media: mediaManager });
  const transitionalPreviews = createCatalogueLegacyPreview({ data: wixData });
  const addPreviews = async page => transitionalPreviews(await privatePreviews(page));
  cached = { read: createProtectedCatalogueRead({ data: wixData, authorize, reserveRead, reserveCoverage, readSelection, addPreviews }),
    buyerImage: (companyId, selectionId) => openBuyerImage({ companyId, selectionId }, {
      authorize: buyerCompanyId => authorize({ buyerCompanyId }),
      getSelection: id => wixData.get('WixBuyerListItems', id, { suppressAuth: true, consistentRead: true }),
      getPrivateAsset: id => wixData.get('CatalogueImageAssets', id, { suppressAuth: true, consistentRead: true }),
      reserveDownload: async (actor, id) => await reserveRead(actor, 'BUYER_IMAGE', 1) &&
        await reserveCoverage(actor, 'BUYER_IMAGE', [id]),
      media: verifiedMedia
    }),
    retry: () => retryCatalogueAlerts(store, deliver) };
  expires = Date.now() + 60000;
  return cached;
}

export async function processCatalogueSecurityNotifications() {
  const protection = await getCatalogueProtection();
  await protection.retry();
}

