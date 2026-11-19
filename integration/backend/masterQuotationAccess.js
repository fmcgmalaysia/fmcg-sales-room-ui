import { canEnterQuotations, canQuoteManagedCustomer } from 'backend/staffManagementPolicy.js';

const ACTION_POLICY = Object.freeze({
  quotes: ['VIEW', 'VIEW'],
  cost: ['EDIT', 'EDIT_QUOTATION'],
  'cost-status': ['EDIT', 'EDIT_QUOTATION'],
  draft: ['EDIT', 'EDIT_QUOTATION'],
  publish: ['EDIT', 'PUBLISH_QUOTATION']
});

function activeWebCustomer(customer) {
  return customer?.quotationMode === 'WEB' && customer.webQuotationStatus === 'READY' &&
    customer.lifecycleStatus !== 'ARCHIVED' &&
    !['SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(customer.catalogueAccessStatus || customer.accessStatus);
}

// These adapters are server-only. Bind readIdentity to the same Wix request
// that called the web method. ReadCustomer/ReadCustomers must come from the
// authoritative customer directory; never pass customer records from Wix UI.
export function createMasterQuotationActions({ readIdentity, readCustomer, readCustomers, quotation }) {
  return async function run(action, customerId, input) {
    if (action !== 'customers' && !Object.prototype.hasOwnProperty.call(ACTION_POLICY, action)) return { accessDenied: true };
    let record;
    try { ({ record } = await readIdentity()); }
    catch { return { accessDenied: true }; }

    if (!record?.title || !canEnterQuotations(record)) return { accessDenied: true };
    const { title: staffId, staffName } = record;
    if (action === 'customers') {
      const customers = (await readCustomers(record))
        .filter(customer => activeWebCustomer(customer) && canQuoteManagedCustomer(record, customer))
        .map(({ customerId, name }) => ({ customerId, name }));
      return { staffId, staffName, customers };
    }

    if (typeof customerId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(customerId)) return { accessDenied: true };
    const customer = await readCustomer(customerId, action);
    if (customer?.customerId !== customerId || !activeWebCustomer(customer) || !canQuoteManagedCustomer(record, customer)) return { accessDenied: true };
    const scope = { staffId, customer };
    if (action === 'quotes') {
      const rows = await quotation.list(scope);
      const { preferredCurrency, rateToMyr, fullName } = customer;
      return { staffId, customer: { customerId, preferredCurrency, rateToMyr, ...(fullName ? { fullName } : {}) }, rows,
        canEdit: true, canPublish: true };
    }
    if (action === 'cost') return quotation.catchCost(scope, input);
    if (action === 'cost-status') return quotation.costResult(scope, input);
    if (action === 'draft') return quotation.saveDraft(scope, input);
    return quotation.publish(scope, input);
  };
}
