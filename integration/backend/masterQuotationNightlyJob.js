import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { createHash } from 'crypto';
import { createMasterQuotationReader } from 'backend/masterQuoteTransport.js';
import { createMasterQuotationService } from 'backend/masterQuotationService.js';
import { createMasterQuotationWixStore } from 'backend/masterQuotationWixStore.js';
import { captureQuotationCosts, readQuotationCosts } from 'backend/pointbaseCostClient.js';
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
  readCosts: async barcodes => {
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
    const requestKey = createHash('sha256').update(JSON.stringify(['nightly-cost-reference', day, barcodes])).digest('hex');
    const result = await captureQuotationCosts(barcodes, requestKey);
    return result.costs || await readQuotationCosts(barcodes);
  },
  refreshCosts: quotation.refreshScheduledCosts
});

export async function refreshMasterQuotationCostsAtMidnight() {
  const result = await run();
  console.info('MASTER_QUOTATION_NIGHTLY_COSTS', result);
  if (result.failed || result.failedCustomers) throw Error('Scheduled quotation costs were only partially refreshed.');
  return result;
}
