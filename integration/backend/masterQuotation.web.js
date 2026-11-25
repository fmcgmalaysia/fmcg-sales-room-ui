import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { readManagedStaffIdentity } from 'backend/staffManagementAccess.js';
import { createMasterQuoteSender, createMasterQuotationReader } from 'backend/masterQuoteTransport.js';
import { createMasterQuotationActions } from 'backend/masterQuotationAccess.js';
import { createMasterQuotationService } from 'backend/masterQuotationService.js';
import { createMasterQuotationWixStore } from 'backend/masterQuotationWixStore.js';
import { captureQuotationCosts, readQuotationCosts, readQuotationCostResult } from 'backend/pointbaseCostClient.js';
import { readCurrentAdminFx } from 'backend/adminFxClient.js';
import { createLastInvoicedPrices } from 'backend/masterQuotationLastSale.js';
import { createLastPurchaseCosts } from 'backend/masterQuotationLastPurchase.js';

const source = 'https://www.fmcgmalaysia.com/_functions/';
const getQuotationSecret = () => getSecret('MASTER_WEB_QUOTATION_SHARED_SECRET');
const read = createMasterQuotationReader({ endpoint: source + 'masterWebQuotationRead', getSecret: getQuotationSecret });
const deliver = createMasterQuoteSender({ endpoint: source + 'masterWebQuotation', getSecret: getQuotationSecret });
const revisions = createMasterQuotationWixStore(wixData, 'MasterQuotationRevisions');

const quotation = createMasterQuotationService({
  revisions, deliver,
  readSelections: async customerId => (await read({ action: 'selections', customerId })).selections,
  readSelection: async (customerId, selectionId) => (await read({ action: 'selection', customerId, selectionId })).selection,
  readCosts: captureQuotationCosts, readCurrentCosts: readQuotationCosts, readCostResult: readQuotationCostResult,
  readLastInvoicedPrices: createLastInvoicedPrices(wixData)
});

const operate = createMasterQuotationActions({
  readIdentity: readManagedStaffIdentity,
  async readCustomers(record) {
    // Filter ownership on the server before returning dropdown rows.
    // Customer service grants are independent of internal quotation permission.
    return (await read({ action: 'customers', customerIds: null })).customers;
  },
  async readCustomer(customerId) {
    return (await read({ action: 'customer', customerId })).customer;
  },
  async readQuoteContext(customerId) {
    try { return await read({ action: 'selections', customerId }); }
    catch { return null; }
  },
  async readRate(customer) {
    const [{ rateToMyr }] = await readCurrentAdminFx([customer.preferredCurrency]);
    return rateToMyr;
  },
  async readSelectionCounts(ids) {
    const counts = [];
    for (let index = 0; index < ids.length; index += 1000) {
      const result = await read({ action: 'selection-counts', customerIds: ids.slice(index, index + 1000) });
      counts.push(...result.counts);
    }
    return counts;
  },
  readPurchaseHistory: createLastPurchaseCosts(wixData),
  quotation
});

export const runMasterQuotation = webMethod(Permissions.SiteMember, operate);
