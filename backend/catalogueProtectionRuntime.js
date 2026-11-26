import { openBuyerImage } from './buyerProductImage.js';
import { mediaManager } from 'wix-media-backend';
import { files } from 'wix-media.v2';
import { elevate } from 'wix-auth';
import { createCataloguePreviewReader, createVerifiedCatalogueMedia } from './catalogueImageAssets.js';
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
  const addPreviews = createCataloguePreviewReader({ data: wixData, media: mediaManager });
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
