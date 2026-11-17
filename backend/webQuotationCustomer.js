const upper = value => String(value ?? '').trim().toUpperCase();

export function isWebQuotationCustomer(customer) {
  return upper(customer?.quotationMode) === 'WEB';
}

export function isWebQuotationReady(customer) {
  const access = upper(customer?.catalogueAccessStatus || customer?.accessStatus || customer?.customerStatus);
  const lifecycle = upper(customer?.lifecycleStatus || customer?.customerStatus);
  return isWebQuotationCustomer(customer) && upper(customer.webQuotationStatus) === 'READY' &&
    access === 'ACTIVE' && lifecycle !== 'ARCHIVED';
}
