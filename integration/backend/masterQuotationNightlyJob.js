import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { createMasterQuotationReader } from 'backend/masterQuoteTransport.js';
import { createMasterQuotationService } from 'backend/masterQuotationService.js';
import { createMasterQuotationWixStore } from 'backend/masterQuotationWixStore.js';
import { capturePointbaseCosts } from 'backend/pointbaseCostClient.js';
import { createQuotationNightlyCosts } from 'backend/masterQuotationNightlyCosts.js';

const read = createMasterQuotationReader({
  endpoint: 'https://www.fmcgmalaysia.com/_functions/masterWebQuotationRead',
  getSecret: () => getSecret('MASTER_WEB_QUOTATION_SHARED_SECRET')
});
const revisions = createMasterQuotationWixStore(wixData, 'MasterQuotationRevisions');
const quotation = createMasterQuotationService({ revisions });
const run = createQuotationNightlyCosts({
  readCustomers: async () => (await read({ action: 'customers', customerIds: null })).customers,
  readSelections: async customerId => (await read({ action: 'selections', customerId })).selections,
  readCosts: capturePointbaseCosts,
  refreshCosts: quotation.refreshScheduledCosts
});

export async function refreshMasterQuotationCostsAtMidnight() {
  const result = await run();
  console.info('MASTER_QUOTATION_NIGHTLY_COSTS', result);
  if (result.failed || result.failedCustomers) throw Error('Scheduled quotation costs were only partially refreshed.');
  return result;
}
