import { openBuyerImage, readBuyerPrivateOriginal } from './buyerProductImage.js';
import { mediaManager } from 'wix-media-backend';
import { files } from 'wix-media.v2';
import { elevate } from 'wix-auth';
import { createCataloguePreviewReader, createVerifiedCatalogueMedia } from './catalogueImageAssets.js';
import { createCatalogueLegacyPreview } from './catalogueLegacyPreview.js';
import wixData from 'wix-data';
import { currentMember } from 'wix-members-backend';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';
import { customTrigger } from '@wix/automations';
import { getCurrentStaffContext } from 'backend/staffAuth.web.js';
import { getCatalogueSelectionState } from 'backend/catalogueSelection.web.js';
import { readCatalogueCustomerForStaff } from 'backend/catalogueStaffCustomerAccess.js';
import { resolveBuyerCompany } from 'backend/buyerCompanyAccess.js';
import { createCatalogueReadIdentity } from './catalogueReadIdentity.js';
import { createCatalogueBudgetStore } from './catalogueBudgetStore.js';
import { createCatalogueReadBudget } from './catalogueReadBudget.js';
import { createCatalogueCoverage, readDeliveredCatalogueIds } from './catalogueCoverage.js';
import { createCatalogueRiskAlert, retryCatalogueAlerts } from './catalogueRiskAlert.js';
import { createProtectedCatalogueRead } from './protectedCatalogueRead.js';
import { createCatalogueSelectionScope } from './catalogueSelectionScope.js';
import { createCataloguePageIndex } from './cataloguePageIndex.js';
import { createCatalogueIndexSnapshot } from './catalogueIndexSnapshot.js';

const collection = 'CatalogueProtection';
const indexSnapshot = createCatalogueIndexSnapshot(wixData, collection);
const cataloguePage = createCataloguePageIndex(wixData, Date.now, indexSnapshot.read, indexSnapshot.readOpening);
const verifiedMedia = createVerifiedCatalogueMedia(mediaManager, elevate(files.getFileDescriptor));
const store = createCatalogueBudgetStore({ data: wixData, patch: auth.elevate(items.patch), collection });
const runTrigger = auth.elevate(customTrigger.runTrigger);
const authorize = createCatalogueReadIdentity({
  getMember: () => currentMember.getMember({ fieldsets: ['FULL'] }),
  readStaff: getCurrentStaffContext, resolveBuyerCompany, readStaffCustomer: readCatalogueCustomerForStaff
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
  const originalService = {
    getPrivateAsset: id => wixData.get('CatalogueImageAssets', id, { suppressAuth: true, consistentRead: true }),
    media: verifiedMedia
  };
  const selectionPreviews = async (scope, products, fullSize) => {
    if (!products.length) return [];
    const actor = await authorize(scope);
    if (fullSize && products.length === 1 && actor?.customerId) {
      const entry = products[0];
      const image = await readBuyerPrivateOriginal(entry.id, originalService);
      return [{ selectionId: entry.selectionId, image }];
    }
    if (await reserveRead(actor, 'CATALOGUE_LIST', products.length) !== true ||
        await reserveCoverage(actor, 'CATALOGUE_LIST', products.map(p=>p.id)) !== true) return [];
    const entries = await addPreviews(products);
    return entries.flatMap(entry=>entry.image ? [{ selectionId:entry.selectionId, image:entry.image }] : []);
  };
  cached = { selectionPreviews, read: createProtectedCatalogueRead({
      data: wixData, authorize, reserveRead, reserveCoverage, readSelection, addPreviews,
      deliveredIds: (actor, ids) => readDeliveredCatalogueIds(store, actor, ids, config.coveragePolicy.CATALOGUE_LIST.windowMs),
      readPrivatePreviews: privatePreviews, page: cataloguePage
    }),
    buyerImage: (companyId, selectionId) => openBuyerImage({ companyId, selectionId }, {
      authorize: buyerCompanyId => authorize({ buyerCompanyId }),
      getSelection: id => wixData.get('WixBuyerListItems', id, { suppressAuth: true, consistentRead: true }),
      ...originalService,
      reserveDownload: async (actor, id) => await reserveRead(actor, 'BUYER_IMAGE', 1) &&
        await reserveCoverage(actor, 'BUYER_IMAGE', [id])
    }),
    retry: () => retryCatalogueAlerts(store, deliver) };
  expires = Date.now() + 60000;
  return cached;
}

export async function readOwnedSelectionPreviews(scope, products, fullSize = false) {
  return (await getCatalogueProtection()).selectionPreviews(scope, products, fullSize);
}

export async function processCatalogueSecurityNotifications() {
  const protection = await getCatalogueProtection();
  await protection.retry();
}

export async function prepareCatalogueOpeningSnapshot() {
  return indexSnapshot.refreshOpening();
}

const catalogue927Fields = [
  '_id', 'name', 'title', 'description', 'packingSize', 'ea', 'EA', 'price', 'barcode', 'unitBarcode',
  'innerBoxBarcode', 'cartonBarcode', 'm3Ctn', 'cbmPerCtn', 'cbm', 'principle', 'brandName', 'mainCategory',
  'image', 'countryOrigin', 'shelflife', 'shelfLife', 'pointBaseSortId', 'sortNo', 'sortNO', 'sortNumber',
  'sortOrder', 'subCategories', 'unitPrice', 'pricePerUnit', 'currency'
];

function catalogue927Product(item) {
  const product = {};
  for (const field of catalogue927Fields) {
    const value = item[field];
    if (field === 'subCategories') {
      product.subCategories = (Array.isArray(value) ? value : []).map(category =>
        typeof category === 'string' ? category : category?._id).filter(id => typeof id === 'string');
    } else if (field === 'image') {
      const image = typeof value === 'string' ? value.trim() : '';
      const media = /^wix:image:\/\/v1\/([\w~.-]+)\//i.exec(image)?.[1] ||
        /^https:\/\/static\.wixstatic\.com\/media\/([\w~.-]+)$/i.exec(image)?.[1];
      if (media && /\.(?:png|jpe?g|webp|gif|avif)$/i.test(media)) product.image = 'https://static.wixstatic.com/media/' + media;
    } else if (typeof value === 'string' || Number.isFinite(value)) {
      product[field] = value;
    }
  }
  return product;
}

export async function readCatalogue927Products(scope, mode) {
  if (mode !== 'FIRST' && mode !== 'FULL') throw Error('Invalid Catalogue read.');
  await authorize(scope);
  const options = { suppressAuth: true, consistentRead: true };
  const active = () => wixData.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE');
  if (mode === 'FIRST') {
    const opening = await indexSnapshot.readOpening();
    if (!opening?.ids.length) return [];
    const ids = opening.ids.slice(0, 50);
    const page = await active().hasSome('_id', ids).include('subCategories').limit(ids.length).find(options);
    const products = new Map(page.items.map(item => [item._id, catalogue927Product(item)]));
    return ids.map(id => products.get(id)).filter(Boolean);
  }

  // The browser uses this snapshot for the same local filtering as Catalogue 927.
  // Expose only the established Catalogue fields, including IDs of linked categories.
  const query = () => active().ascending('_id').include('subCategories').limit(1000);
  const first = await query().find(options);
  if (!Number.isSafeInteger(first.totalCount) || first.totalCount > 10000) throw Error('Catalogue snapshot unavailable.');
  const products = new Map(first.items.map(item => [item._id, catalogue927Product(item)]));
  for (let offset = first.items.length; offset < first.totalCount; offset += 3000) {
    const reads = [];
    for (let start = offset; start < Math.min(first.totalCount, offset + 3000); start += 1000) {
      reads.push(query().skip(start).find(options));
    }
    for (const page of await Promise.all(reads)) {
      if (page.totalCount !== first.totalCount || page.partialIncludes) throw Error('Catalogue changed during loading.');
      for (const item of page.items) products.set(item._id, catalogue927Product(item));
    }
  }
  if (first.partialIncludes || products.size !== first.totalCount) throw Error('Catalogue changed during loading.');
  return [...products.values()];
}

export async function refreshCatalogueIndexSnapshot() {
  try {
    const result = await indexSnapshot.refresh();
    console.info('Catalogue index snapshot', result.status, result.count);
  } catch {
    console.warn('Catalogue index snapshot refresh failed. Live reads remain available.');
  }
}
