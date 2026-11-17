import { getSecret } from 'wix-secrets-backend';
import { createFmcgQuotationReader, createFmcgQuoteReceiver } from 'backend/masterQuoteTransport.js';
import { acceptMasterWebQuotation, readMasterWebQuotationData } from 'backend/masterWebQuotationData.js';

const getQuotationSecret = () => getSecret('MASTER_WEB_QUOTATION_SHARED_SECRET');

export const receiveMasterWebQuotation = createFmcgQuoteReceiver({
  getSecret: getQuotationSecret,
  putQuote: acceptMasterWebQuotation
});

export const receiveMasterWebQuotationRead = createFmcgQuotationReader({
  getSecret: getQuotationSecret,
  read: readMasterWebQuotationData
});
