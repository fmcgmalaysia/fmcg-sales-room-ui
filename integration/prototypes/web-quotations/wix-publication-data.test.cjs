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
  await wixData.update('FMCGMALAYSIA', { ...product, pointBaseSortId: 'FO-00002' });
  const ready = load('backend/webQuotationCustomer.js', ['isWebQuotationCustomer', 'isWebQuotationReady']);
  const retention = load('backend/buyerSelectionRetention.js', ['removedSelectionExpired']);
  const projection = load('backend/masterQuoteProjection.js', ['createMasterQuoteProjection', 'presentMasterQuote'], { createHash, ...ready });
  const data = load('backend/masterWebQuotationData.js', ['acceptMasterWebQuotation', 'applyWebQuotations', 'readMasterWebQuotationData'], {
    wixData, ...ready, ...projection
  });
  const globals = {
    wixData, ...ready, ...data, ...retention, webMethod: (_, fn) => fn, Permissions: { SiteMember: 'member' },
    currentMember: { getMember: async () => ({ _id: 'member-QA-A', loginEmail: 'qa-a@example.invalid' }) },
    wixRealtimeBackend: { publish: async () => {} },
    httpsRequest() { throw Error('WEB customers must never contact the Google QD'); }
  };
  const { addCatalogueSelection, getCatalogueSelectionState } = load('backend/catalogueSelection.web.js', ['addCatalogueSelection', 'getCatalogueSelectionState'], globals);
  const buyer = load('backend/catalogueAuth.web.js', ['getBuyerWorkspace', 'saveBuyerQuantity', 'removeBuyerItem', 'recoverBuyerItem', 'submitBuyerOrder'], globals);
  const excel = load('backend/buyerSelectionExcel.js', ['buildBuyerSelectionExcel']);
  const { buildBuyerSelectionDownload } = load('backend/buyerSelectionDownload.js', ['buildBuyerSelectionDownload'], {
    wixData, ...ready, ...data, createHash, ...excel
  });
  const { selection: { id: selectionId, unitBarcode: barcode } } = await addCatalogueSelection('product-1');
  const read = await data.readMasterWebQuotationData({ action: 'selection', customerId: 'QA-A', selectionId });
  assert.equal(read.selection.ea, 12);
  assert.equal(read.selection.sortId, 'FO-00002');
  assert.equal(read.selection.cbmPerCtn, 0.025);
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

  await buyer.removeBuyerItem(selectionId);
  const selectedAtRemoval = await getCatalogueSelectionState();
  assert.equal(selectedAtRemoval.total, 0);
  assert(selectedAtRemoval.selectedProductIds.includes('product-1'));
  assert.equal((await buyer.getBuyerWorkspace()).removed.length, 1);
  assert.deepEqual(Array.from((await data.readMasterWebQuotationData({ action: 'selections', customerId: 'QA-A' })).selections), []);
  const record = await wixData.get('WixBuyerListItems', selectionId);
  const removed = JSON.parse(record.payload);
  await buyer.removeBuyerItem(selectionId);
  assert.equal(JSON.parse((await wixData.get('WixBuyerListItems', selectionId)).payload).removedTime, removed.removedTime);
  const horizon = Date.parse(removed.removedTime) + 30 * 24 * 60 * 60 * 1000;
  assert.equal(retention.removedSelectionExpired(removed, horizon - 1), false);
  assert.equal(retention.removedSelectionExpired(removed, horizon), true);
  assert.equal(retention.removedSelectionExpired({ ...removed, removedTime: '' }, horizon), false);
  await wixData.update('WixBuyerListItems', { ...record, payload: JSON.stringify({
    ...removed, removedTime: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
  }) });
  assert.equal((await getCatalogueSelectionState()).selectedProductIds.includes('product-1'), false);
  assert.equal((await buyer.getBuyerWorkspace()).removed.length, 0);
  await assert.rejects(buyer.recoverBuyerItem(selectionId), /30 days old/);
  assert.equal((await addCatalogueSelection('product-1')).selection.id, selectionId);
  assert.equal(wixData.rows('WixBuyerListItems').length, 1);
  const restoredContext = await data.readMasterWebQuotationData({ action: 'selection', customerId: 'QA-A', selectionId });
  assert.equal((await data.applyWebQuotations(restoredContext.customer, [restoredContext.selection]))[0].quoteActive, false);
});
