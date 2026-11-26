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
import { resolveBuyerCompany } from 'backend/buyerCompanyAccess.js';
import { createCatalogueReadIdentity } from './catalogueReadIdentity.js';
import { createCatalogueBudgetStore } from './catalogueBudgetStore.js';
import { createCatalogueReadBudget } from './catalogueReadBudget.js';
import { createCatalogueCoverage } from './catalogueCoverage.js';
import { createCatalogueRiskAlert, retryCatalogueAlerts } from './catalogueRiskAlert.js';
import { createProtectedCatalogueRead } from './protectedCatalogueRead.js';
import { createCatalogueSelectionScope } from './catalogueSelectionScope.js';

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
  cached = { selectionPreviews, read: createProtectedCatalogueRead({ data: wixData, authorize, reserveRead, reserveCoverage, readSelection, addPreviews }),
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
