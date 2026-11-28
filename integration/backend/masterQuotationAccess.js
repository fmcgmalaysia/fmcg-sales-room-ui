import { canEnterQuotations, canQuoteManagedCustomer, normalizeStaffAccess } from 'backend/staffManagementPolicy.js';

const ACTION_POLICY = Object.freeze({
  quotes: ['VIEW', 'VIEW'],
  'quote-current-costs': ['VIEW', 'VIEW'],
  'purchase-history': ['VIEW', 'VIEW'],
  cost: ['EDIT', 'EDIT_QUOTATION'],
  'cost-status': ['EDIT', 'EDIT_QUOTATION'],
  draft: ['EDIT', 'EDIT_QUOTATION'],
  'save-note': ['EDIT', 'EDIT_QUOTATION'],
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
export function createMasterQuotationActions({ readIdentity, readCustomer, readQuoteContext, readCustomers, readSelectionCounts, readRate, readPurchaseHistory, quotation }) {
  return async function run(action, customerId, input) {
    const directoryAction = action === 'customers' || action === 'selection-counts';
    if (!directoryAction && !Object.prototype.hasOwnProperty.call(ACTION_POLICY, action)) return { accessDenied: true };
    let record;
    try { ({ record } = await readIdentity()); }
    catch { return { accessDenied: true }; }

    if (!record?.title || !canEnterQuotations(record)) return { accessDenied: true };
    const { title: staffId, staffName } = record;
    if (directoryAction) {
      const customers = (await readCustomers(record))
        .filter(customer => activeWebCustomer(customer) && canQuoteManagedCustomer(record, customer))
        .map(({ customerId, name }) => ({ customerId, name }));
      if (action === 'selection-counts') {
        const ids = [...new Set(customers.map(customer => customer.customerId))];
        const permitted = new Set(ids);
        const counts = ids.length ? await readSelectionCounts(ids) : [];
        return { staffId, counts: counts.filter(row => permitted.has(row.customerId) &&
          Number.isSafeInteger(row.selectionCount) && row.selectionCount >= 0) };
      }
      return { staffId, staffName, customers };
    }

    if (typeof customerId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(customerId)) return { accessDenied: true };
    const gridRead = action === 'quotes' || action === 'quote-current-costs';
    const context = gridRead && readQuoteContext ? await readQuoteContext(customerId) : null;
    const customer = context?.customer ?? await readCustomer(customerId, action);
    if (customer?.customerId !== customerId || !activeWebCustomer(customer) || !canQuoteManagedCustomer(record, customer)) return { accessDenied: true };
    const scope = { staffId, customer };
    if (action === 'quote-current-costs') {
      return { staffId, customerId, rows: await quotation.listCurrentCosts(scope, context?.selections) };
    }
    const canEditNotes = String(record.role ?? '').trim().toUpperCase() === 'SUPER ADMIN' ||
      normalizeStaffAccess(record.staffAccess ?? {}).quotationAccess === 'EDIT';
    if (action === 'quotes') {
      const deferCosts = input?.deferCosts === true;
      const [rows, rateToMyr] = await Promise.all([
        quotation.list(scope, context?.selections, { deferCosts }),
        readRate ? readRate(customer) : customer.rateToMyr
      ]);
      const { preferredCurrency, fullName } = customer;
      return { staffId, customer: { customerId, preferredCurrency, rateToMyr, ...(fullName ? { fullName } : {}) }, rows,
        canEdit: true, canPublish: true, canEditNotes, ...(deferCosts && rows.length ? { costsDeferred: true } : {}) };
    }
    if (action === 'purchase-history') {
      const items = await readPurchaseHistory({ record, customerId, products: input?.products ?? [] });
      return { staffId, customerId, items };
    }
    if (action === 'cost') return quotation.catchCost(scope, input);
    if (action === 'cost-status') return quotation.costResult(scope, input);
    if (action === 'save-note') return canEditNotes ? quotation.saveNote(scope, input) : { accessDenied: true };
    if (readRate) scope.customer = { ...customer, rateToMyr: await readRate(customer) };
    if (action === 'draft') return quotation.saveDraft(scope, input);
    return quotation.publish(scope, input);
  };
}
