import { canEnterDepartment, canUseSalesRoomCustomer } from 'backend/staffManagementPolicy.js';

const ACTION_POLICY = Object.freeze({
  quotes: ['VIEW', 'VIEW'],
  cost: ['EDIT', 'EDIT_QUOTATION'],
  draft: ['EDIT', 'EDIT_QUOTATION'],
  publish: ['EDIT', 'PUBLISH_QUOTATION']
});

function departmentAccess(record, level) {
  // Sales Management department rights still apply. Neither company scopes
  // these quotations, and the browser does not choose a company here.
  return ['NCT', 'GHR'].some(company => canEnterDepartment(record, 'SALES MANAGEMENT', level, company));
}

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
    if (action !== 'customers' && !Object.hasOwn(ACTION_POLICY, action)) return { accessDenied: true };
    let record;
    try { ({ record } = await readIdentity()); }
    catch { return { accessDenied: true }; }

    if (!record?.title || !departmentAccess(record, 'VIEW')) return { accessDenied: true };
    const { title: staffId, staffName } = record;
    const can = (level, customerAction, id) => departmentAccess(record, level) && canUseSalesRoomCustomer(record, customerAction, id);
    if (action === 'customers') {
      const customers = (await readCustomers(record))
        .filter(customer => activeWebCustomer(customer) && can('VIEW', 'VIEW', customer.customerId))
        .map(({ customerId, name }) => ({ customerId, name }));
      return { staffId, staffName, customers };
    }

    if (typeof customerId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(customerId) ||
        !can(...ACTION_POLICY[action], customerId)) return { accessDenied: true };
    const customer = await readCustomer(customerId);
    if (customer?.customerId !== customerId || !activeWebCustomer(customer)) return { accessDenied: true };
    const scope = { staffId, customer };
    if (action === 'quotes') {
      const rows = await quotation.list(scope);
      const { preferredCurrency, rateToMyr } = customer;
      return { staffId, customer: { customerId, preferredCurrency, rateToMyr }, rows,
        canEdit: can('EDIT', 'EDIT_QUOTATION', customerId), canPublish: can('EDIT', 'PUBLISH_QUOTATION', customerId) };
    }
    if (action === 'cost') return quotation.catchCost(scope);
    if (action === 'draft') return quotation.saveDraft(scope, input);
    return quotation.publish(scope, input);
  };
}
