const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const source = read('sales-room/wix/onboarding.web.js');
const counters = source.slice(source.indexOf('async function readWebQuoteCounters('),
  source.indexOf('export const getSalesRoomConfirmedOrders')).replace('export const', 'const');
const money = source.slice(source.indexOf('function money('), source.indexOf('function roundMoney('));
const quoteData = read('backend/masterWebQuotationData.js');
const present = read('backend/masterQuoteProjection.js').split('export function presentMasterQuote')[1];
const project = quoteData.slice(quoteData.indexOf('export async function applyWebQuotations'));
const epoch = quoteData.slice(quoteData.indexOf('export function selectionEpoch'), quoteData.indexOf('function selectionView'));

const barcode = '9550123456789';
const customer = { customerId: 'QA', quotationMode: 'WEB', webQuotationStatus: 'READY', preferredCurrency: 'USD' };
const selection = (id, productId, values = {}) => ({ record: { _id: id }, data: {
  customerId: 'QA', productId, barcode, selectedAt: '2026-11-20T00:00:00.000Z', ...values
} });
const release = (id, values = {}) => ({ customerId: 'QA', selectionId: id, barcode, version: 1, enabled: true,
  currency: 'USD', priceEa: 1, priceCtn: 24, ...values });

function fixture({ selections, products, publications }) {
  const fetched = [];
  function query(records, isProduct = false) {
    let rows = records;
    return {
      eq(field, value) { rows = rows.filter(row => row[field] === value); return this; },
      hasSome(field, values) {
        if (isProduct) fetched.push(...values);
        rows = rows.filter(row => values.includes(row[field]));
        return this;
      },
      descending() { rows = [...rows].sort((a, b) => b.version - a.version); return this; },
      limit() { return this; },
      async find() { return { items: rows, hasNext: () => false }; }
    };
  }
  const wixData = { query: name => name === 'FMCGMALAYSIA' ? query(products, true) : query(publications) };
  const context = vm.createContext({
    wixData, console, webMethod: (_, fn) => fn, Permissions: { SiteMember: 'member' },
    queryQuotes: id => wixData.query('MasterWebQuotePublications').eq('customerId', id), readOptions: {},
    text: value => String(value ?? '').trim(), normalize: value => String(value ?? '').trim(),
    upper: value => String(value ?? '').toUpperCase(), isWebQuotationCustomer: c => c.quotationMode === 'WEB',
    isWebQuotationReady: c => c.webQuotationStatus === 'READY', isCompletedProgressLine: () => false,
    BUYER_LIST_COLLECTION: 'list', BUYER_ORDER_COLLECTION: 'orders', BUYER_LINE_COLLECTION: 'lines',
    readAllPayloadRows: async name => name === 'list' ? selections : [],
    loadSalesRoomCustomers: async () => ({ customers: [customer] })
  });
  const load = vm.runInContext(money + epoch.replace('export ', '') + '\nfunction presentMasterQuote' + present +
    '\n' + project.replace('export ', '') + '\n' + counters + '\ngetSalesRoomCustomersOperational', context);
  return { load, fetched };
}

test('counts published and pending selections when Catalogue stores EA in the legacy price field', async () => {
  const selections = Array.from({ length: 306 }, (_, index) => selection('item-' + index, 'legacy'));
  selections.push(selection('private', 'private', { customerId: 'OTHER' }));
  const publications = selections.slice(0, 294).map(row => release(row.record._id));
  const { load, fetched } = fixture({ selections, publications, products: [{ _id: 'legacy', barcode, price: '24' }] });
  const result = await load();
  assert.equal(result.customers[0].quotedItemCount, 294);
  assert.equal(result.customers[0].rfqItemCount, 12);
  assert.equal(result.summary.unquotedItemCount, 12);
  assert.deepEqual(fetched, ['legacy']);
});

test('matches Buyer Room EA precedence and keeps removed, withdrawn and restored quotations out of Published', async () => {
  const selectionEpoch = '2026-11-23T09:15:00.000Z';
  const selections = [selection('dedicated', 'current', { ea: 12 }), selection('stored', 'fallback', { ea: 24 }),
    selection('withdrawn', 'current'), selection('restored', 'current', { recoveredAt: selectionEpoch }),
    selection('removed', 'current', { removed: true })];
  const products = [{ _id: 'current', barcode, ea: 24, price: 12 }, { _id: 'fallback', barcode, ea: '', price: 12 }];
  const publications = ['dedicated', 'stored', 'withdrawn', 'restored', 'removed'].map(id => release(id));
  publications.push(release('withdrawn', { version: 2, enabled: false }));
  const result = await fixture({ selections, publications, products }).load();
  assert.equal(result.customers[0].selectedItemCount, 4);
  assert.equal(result.customers[0].quotedItemCount, 2);
  assert.equal(result.customers[0].rfqItemCount, 2);
});
