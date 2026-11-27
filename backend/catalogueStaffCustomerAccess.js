import wixData from 'wix-data';
import { requireStaffCustomerAccess } from 'backend/masterStaffAccessClient.js';
import { isWebQuotationReady } from 'backend/webQuotationCustomer.js';

const normalize = value => String(value || '').trim();
const upper = value => normalize(value).toUpperCase();

export async function readCatalogueCustomerForStaff(staff, customerId, action = 'CATALOGUE_VIEW') {
  const id = normalize(customerId);
  const result = await wixData.query('WixCustomers').eq('customerId', id).limit(2).find({ suppressAuth: true });
  if (result.items.length !== 1) throw new Error('Customer was not found.');
  requireStaffCustomerAccess(staff, action, id);
  const customer = result.items[0];
  requireCatalogueCustomerReady(customer);
  return customer;
}

export function requireCatalogueCustomerReady(customer) {
  const lifecycleStatus = upper(customer.lifecycleStatus || customer.customerStatus);
  const accessStatus = upper(customer.catalogueAccessStatus || customer.accessStatus || customer.customerStatus);
  if (lifecycleStatus === 'ARCHIVED' || ['SUSPENDED', 'BLOCKED', 'INACTIVE'].includes(accessStatus)) {
    throw new Error('Catalogue access is suspended for this customer.');
  }
  if (!isWebQuotationReady(customer)) throw new Error('This customer web quotation workspace is not ready.');
}
