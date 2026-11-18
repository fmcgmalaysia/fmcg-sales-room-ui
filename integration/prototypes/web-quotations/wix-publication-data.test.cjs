const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { createStore, initialState, load } = require('./isolation.cjs');

test('an active legacy status cannot override suspension of a web quotation account', () => {
  const { isWebQuotationReady } = load('backend/webQuotationCustomer.js', ['isWebQuotationReady']);
  const ready = { quotationMode: 'WEB', webQuotationStatus: 'READY', accessStatus: 'ACTIVE', catalogueAccessStatus: 'ACTIVE' };
  assert.equal(isWebQuotationReady(ready), true);
  assert.equal(isWebQuotationReady({ ...ready, accessStatus: 'SUSPENDED' }), false);
  assert.equal(isWebQuotationReady({ ...ready, catalogueAccessStatus: 'BLOCKED' }), false);
  assert.equal(isWebQuotationReady({ ...ready, lifecycleStatus: 'ARCHIVED' }), false);
  assert.equal(isWebQuotationReady({ ...ready, catalogueAccessStatus: 'PENDING' }), false);
});

test('normal Catalogue and Buyer handlers share signed web prices with the existing Excel generator and order snapshots', async () => {
  const state = initialState();
  const wixData = createStore(state, () => {});
  const product = await wixData.get('FMCGMALAYSIA', 'product-1');
  await wixData.update('FMCGMALAYSIA', { ...product, ea: undefined, price: 12, pointBaseSortId: 'FO-00002' });
  const ready = load('backend/webQuotationCustomer.js', ['isWebQuotationCustomer', 'isWebQuotationReady']);
  const projection = load('backend/masterQuoteProjection.js', ['createMasterQuoteProjection', 'presentMasterQuote'], { createHash, ...ready });
  const data = load('backend/masterWebQuotationData.js', ['acceptMasterWebQuotation', 'applyWebQuotations', 'readMasterWebQuotationData'], {
    wixData, ...ready, ...projection
  });
  const globals = {
    wixData, ...ready, ...data, webMethod: (_, fn) => fn, Permissions: { SiteMember: 'member' },
    currentMember: { getMember: async () => ({ _id: 'member-QA-A', loginEmail: 'qa-a@example.invalid' }) },
    wixRealtimeBackend: { publish: async () => {} },
    httpsRequest() { throw Error('WEB customers must never contact the Google QD'); }
  };
  const { addCatalogueSelection } = load('backend/catalogueSelection.web.js', ['addCatalogueSelection'], globals);
  const buyer = load('backend/catalogueAuth.web.js', ['getBuyerWorkspace', 'saveBuyerQuantity', 'removeBuyerItem', 'recoverBuyerItem', 'submitBuyerOrder'], globals);
  const excel = load('backend/buyerSelectionExcel.js', ['buildBuyerSelectionExcel']);
  const { buildBuyerSelectionDownload } = load('backend/buyerSelectionDownload.js', ['buildBuyerSelectionDownload'], {
    wixData, ...ready, ...data, createHash, ...excel
  });
  const { selection: { id: selectionId, unitBarcode: barcode } } = await addCatalogueSelection('product-1');
  const read = await data.readMasterWebQuotationData({ action: 'selection', customerId: 'QA-A', selectionId });
  assert.equal(read.selection.ea, 12);
  assert.equal(read.selection.sortId, 'FO-00002');
  const catalogueProduct = await wixData.get('FMCGMALAYSIA', 'product-1');
  await wixData.update('FMCGMALAYSIA', { ...catalogueProduct, price: undefined });
  assert.equal((await data.readMasterWebQuotationData({ action: 'selection', customerId: 'QA-A', selectionId })).selection.ea, 12);
  await wixData.update('FMCGMALAYSIA', catalogueProduct);
  assert.equal((await data.readMasterWebQuotationData({ action: 'selection', customerId: 'QA-B', selectionId })).selection, null);
  const price = { customerId: 'QA-A', selectionId, barcode, requestId: randomUUID(), version: 1,
    currency: 'USD', enabled: true, priceEa: 1.6, priceCtn: 19.2 };
  await assert.rejects(buyer.saveBuyerQuantity(selectionId, 2), /price is released/);
  await assert.rejects(data.acceptMasterWebQuotation({ ...price, customerId: 'QA-B' }), /unavailable/);
  await data.acceptMasterWebQuotation(price);
  await data.acceptMasterWebQuotation(price);
  assert.equal((await addCatalogueSelection('product-1')).duplicate, true);
  assert.equal(wixData.rows('MasterWebQuotePublications').length, 1);
  const published = await data.applyWebQuotations(read.customer, [read.selection]);
  assert.equal(published[0].vipPriceCtn, 19.2);
  const download = await buildBuyerSelectionDownload('QA-A', 'https://example.invalid/buyer-room');
  assert.equal(download.rowCount, 1);
  assert(download.bytes.includes(Buffer.from('<v>1.6</v>')));
  await buyer.saveBuyerQuantity(selectionId, 2);
  const orderId = randomUUID();
  const firstOrder = await buyer.submitBuyerOrder([{ itemId: selectionId, quantityCtn: 2 }], '', orderId);
  await buyer.removeBuyerItem(selectionId);
  await buyer.recoverBuyerItem(selectionId);
  await assert.rejects(buyer.saveBuyerQuantity(selectionId, 2), /price is released/);
  const latestContext = await data.readMasterWebQuotationData({ action: 'selection', customerId: 'QA-A', selectionId });
  const late = { ...price, requestId: randomUUID(), version: 2 };
  assert.equal((await data.acceptMasterWebQuotation(late)).superseded, true);
  assert.equal((await data.acceptMasterWebQuotation(late)).superseded, true);
  await assert.rejects(buyer.saveBuyerQuantity(selectionId, 2), /price is released/);
  await data.acceptMasterWebQuotation({ ...price, requestId: randomUUID(), version: 3,
    selectionEpoch: latestContext.selection.selectionEpoch, priceEa: 2, priceCtn: 24 });
  assert.equal((await buyer.submitBuyerOrder([{ itemId: selectionId, quantityCtn: 2 }], '', orderId)).orderId, firstOrder.orderId);
  assert.equal((await data.applyWebQuotations(latestContext.customer, [latestContext.selection]))[0].vipPriceCtn, 24);
});
