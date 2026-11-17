const upper = value => String(value ?? '').trim().toUpperCase();

export function isWebQuotationCustomer(customer) {
  return upper(customer?.quotationMode) === 'WEB';
}

export function isWebQuotationReady(customer) {
  const accountAccess = upper(customer?.accessStatus);
  const catalogueAccess = upper(customer?.catalogueAccessStatus);
  const access = accountAccess || catalogueAccess || upper(customer?.customerStatus);
  const lifecycle = upper(customer?.lifecycleStatus || customer?.customerStatus);
  return isWebQuotationCustomer(customer) && upper(customer.webQuotationStatus) === 'READY' &&
    access === 'ACTIVE' && (!catalogueAccess || catalogueAccess === 'ACTIVE') &&
    !['ARCHIVED', 'SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(lifecycle);
}
