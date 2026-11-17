import wixData from 'wix-data';
import { createMasterQuoteProjection, presentMasterQuote } from 'backend/masterQuoteProjection.js';
import { isWebQuotationCustomer, isWebQuotationReady } from 'backend/webQuotationCustomer.js';

const readOptions = { suppressAuth: true, consistentRead: true };
const writeOptions = { suppressAuth: true };
const revisionCollection = 'MasterWebQuotePublications';
const queryCustomer = () => wixData.query('WixCustomers');
const querySelection = () => wixData.query('WixBuyerListItems');
const queryQuotes = customerId => wixData.query(revisionCollection).eq('customerId', customerId);
const text = value => String(value ?? '').trim();

async function rows(query) {
  const result = [];
  let page = await query.limit(1000).find(readOptions);
  result.push(...page.items);
  while (page.hasNext()) {
    page = await page.next();
    result.push(...page.items);
  }
  return result;
}

async function one(query) {
  const { items } = await query.limit(2).find(readOptions);
  if (items.length > 1) throw Error('Duplicate quotation data requires review.');
  return items[0] ?? null;
}

function payload(record) {
  if (record.payload && typeof record.payload === 'object') return record.payload;
  return JSON.parse(record.payload || '{}');
}

function customerView(customer) {
  if (!isWebQuotationReady(customer)) return null;
  const preferredCurrency = text(customer.preferredCurrency || customer.tradingCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(preferredCurrency)) return null;
  return { customerId: customer.customerId, name: text(customer.customerShortName || customer.title), preferredCurrency,
    quotationMode: 'WEB', webQuotationStatus: 'READY', accessStatus: 'ACTIVE' };
}

export function selectionEpoch(data) {
  return text(data.requoteRequestedAt || data.recoveredAt || data.selectionEpoch);
}

function selectionView(record, customerId) {
  const data = payload(record);
  const barcode = text(data.unitBarcode || data.barcode);
  if (data.customerId !== customerId || record.removed || data.removed || !/^[0-9]{6,22}$/.test(barcode)) return null;
  return { id: record._id, customerId, barcode, name: text(data.itemName), packing: text(data.packingSize),
    imageUrl: text(data.imageUrl), selectionEpoch: selectionEpoch(data), productId: text(data.productId),
    fallbackEa: Number(data.productReference?.eaPerCtn || data.ea) };
}

async function packSelections(selections) {
  const products = new Map();
  const ids = [...new Set(selections.map(row => row.productId).filter(Boolean))];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const { items } = await wixData.query('FMCGMALAYSIA').hasSome('_id', batch).limit(100).find(readOptions);
    for (const item of items) products.set(item._id, item);
  }
  return selections.map(({ productId, fallbackEa, ...row }) => {
    const product = products.get(productId);
    const ea = product && text(product.barcode) === row.barcode ? Number(product.ea) : fallbackEa;
    return { ...row, ea: Number.isSafeInteger(ea) && ea > 0 ? ea : null };
  });
}

async function readContext(customerId, selectionId) {
  const customer = customerView(await one(queryCustomer().eq('customerId', customerId)));
  if (!customer) return {};
  const record = await one(querySelection().eq('customerId', customerId).eq('_id', selectionId));
  const selection = record && selectionView(record, customerId);
  return { customer, selection: selection ? (await packSelections([selection]))[0] : null };
}

export async function readMasterWebQuotationData({ action, customerId, customerIds, selectionId }) {
  if (action === 'customers') {
    if (customerIds?.length === 0) return { customers: [] };
    const active = () => queryCustomer().eq('quotationMode', 'WEB').eq('webQuotationStatus', 'READY');
    const customers = [];
    if (customerIds === null) customers.push(...await rows(active()));
    else for (let index = 0; index < customerIds.length; index += 100) {
      customers.push(...await rows(active().hasSome('customerId', customerIds.slice(index, index + 100))));
    }
    return { customers: customers.map(customerView).filter(Boolean) };
  }
  if (action === 'selection') return readContext(customerId, selectionId);
  const customer = customerView(await one(queryCustomer().eq('customerId', customerId)));
  if (action === 'customer') return { customer };
  if (action !== 'selections' || !customer) throw Error('Quotation data is unavailable.');
  const selections = (await rows(querySelection().eq('customerId', customerId))).map(row => selectionView(row, customerId)).filter(Boolean);
  return { selections: await packSelections(selections) };
}

export const acceptMasterWebQuotation = createMasterQuoteProjection({
  readContext,
  read: id => one(wixData.query(revisionCollection).eq('_id', id)),
  latest: async (customerId, selectionId) => (await queryQuotes(customerId).eq('selectionId', selectionId)
    .descending('version').limit(1).find(readOptions)).items[0] ?? null,
  insert: row => wixData.insert(revisionCollection, row, writeOptions)
});

export async function applyWebQuotations(customer, selections) {
  if (!isWebQuotationCustomer(customer)) return selections;
  if (!isWebQuotationReady(customer)) throw Error('Your web quotation workspace is not ready.');
  const { customerId } = customer;
  const ids = [...new Set(selections.filter(row => !row.removed).map(row => row.id))];
  const quotes = new Map();
  for (let index = 0; index < ids.length; index += 100) {
    const group = ids.slice(index, index + 100);
    const remaining = new Set(group);
    let page = await queryQuotes(customerId).hasSome('selectionId', group).descending('version').limit(1000).find(readOptions);
    while (true) {
      for (const quote of page.items) {
        if (quote.customerId !== customerId) throw Error('Unexpected quotation customer.');
        if (remaining.delete(quote.selectionId)) quotes.set(quote.selectionId, quote);
      }
      if (!remaining.size || !page.hasNext()) break;
      page = await page.next();
    }
  }
  const currency = text(customer.preferredCurrency || customer.tradingCurrency).toUpperCase();
  return selections.map(row => {
    const quote = quotes.get(row.id);
    const base = { ...row, quoteActive: false, quoteStatus: row.removed ? 'REMOVED' : 'RFQ',
      vipPriceEa: 0, vipPriceCtn: 0, vipPrice: 0, quotePerPc: 0, quotePerCtn: 0, vipCurrency: '', quoteEffectiveAt: '' };
    const ea = row.catalogueEa ?? row.ea;
    if (!quote?.enabled || currency !== quote.currency || Number((quote.priceEa * ea).toFixed(6)) !== quote.priceCtn) return base;
    const result = presentMasterQuote({ ...base, selectionEpoch: selectionEpoch(row) }, quote);
    if (!result.quoteActive) return base;
    const { selectionEpoch: _epoch, ...released } = result;
    return { ...released, quoteEffectiveAt: `WEB-${quote.version}` };
  });
}
