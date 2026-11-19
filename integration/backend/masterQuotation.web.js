import { webMethod, Permissions } from 'wix-web-module';
import wixData from 'wix-data';
import { getSecret } from 'wix-secrets-backend';
import { readManagedStaffIdentity } from 'backend/staffManagementAccess.js';
import { projectFmcgStaffScope } from 'backend/staffManagementPolicy.js';
import { createMasterQuoteSender, createMasterQuotationReader } from 'backend/masterQuoteTransport.js';
import { createMasterQuotationActions } from 'backend/masterQuotationAccess.js';
import { createMasterQuotationService } from 'backend/masterQuotationService.js';
import { createMasterQuotationWixStore } from 'backend/masterQuotationWixStore.js';
import { captureQuotationCosts, readQuotationCosts, readQuotationCostResult } from 'backend/pointbaseCostClient.js';
import { readCurrentAdminFx } from 'backend/adminFxClient.js';
import { createLastInvoicedPrices } from 'backend/masterQuotationLastSale.js';

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
    const scope = projectFmcgStaffScope(record);
    if (!scope) return [];
    const ids = scope.customerActions.VIEW;
    if (scope.allCustomers) return (await read({ action: 'customers', customerIds: null })).customers;
    const customers = [];
    for (let index = 0; index < ids.length; index += 1000) {
      customers.push(...(await read({ action: 'customers', customerIds: ids.slice(index, index + 1000) })).customers);
    }
    return customers;
  },
  async readCustomer(customerId) {
    const { customer } = await read({ action: 'customer', customerId });
    if (!customer) return null;
    const [{ rateToMyr }] = await readCurrentAdminFx([customer.preferredCurrency]);
    return { ...customer, rateToMyr };
  },
  quotation
});

export const runMasterQuotation = webMethod(Permissions.SiteMember, operate);
