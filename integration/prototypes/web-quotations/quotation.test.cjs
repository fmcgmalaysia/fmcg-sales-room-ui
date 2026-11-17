const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createIsolation } = require('./isolation.cjs');

async function selected(qa, customer = 'QA-A', product = 'product-1') {
  return (await qa.buyerApi(customer).addCatalogueSelection(product)).selection.id;
}
function row(qa, id, customer = 'QA-A', actor = qa.actors.sales) {
  return qa.service.list(actor, customer).rows.find(item => item.id === id);
}
async function setPrice(qa, id, input = { mode: 'GP', value: 25 }) {
  return qa.service.saveDraft(qa.actors.sales, 'QA-A', id, input, row(qa, id).revision, randomUUID());
}
async function publish(qa, id, enabled = true, requestId = randomUUID()) {
  return qa.service.publish(qa.actors.sales, 'QA-A', id, enabled, row(qa, id).revision, requestId);
}
async function ready() {
  const qa = createIsolation(); const id = await selected(qa);
  await qa.service.catchCost(qa.actors.sales, 'QA-A'); await setPrice(qa, id);
  return { qa, id };
}

test('selection preserves the customer identity and duplicate selection retains published price', async () => {
  const { qa, id } = await ready();
  await publish(qa, id);
  assert.equal(await selected(qa), id);
  assert.equal(qa.store.rows('WixBuyerListItems').length, 1);
  const [item] = (await qa.buyerApi('QA-A').getBuyerWorkspace()).myList;
  assert.equal(item.vipPriceCtn, 12);
  assert.equal(item.quoteStatus, 'VIEW QUOTE');
});

test('Target GP, unit price and carton price calculate through the existing FX and GP rules', async () => {
  const { qa, id } = await ready();
  assert.equal(row(qa, id).draft.priceEa, 1);
  assert.equal(row(qa, id).draft.priceCtn, 12);
  await setPrice(qa, id, { mode: 'CTN', value: 18 });
  assert.equal(row(qa, id).draft.priceEa, 1.5);
  assert.equal(row(qa, id).draft.gp, 50);
  await setPrice(qa, id, { mode: 'EA', value: 0.5 });
  assert.equal(row(qa, id).draft.gp, -50);
  await assert.rejects(setPrice(qa, id, { mode: 'GP', value: 100 }), /below 100/);
  await assert.rejects(setPrice(qa, id, { mode: 'EA', value: 0 }), /greater than zero/);
});

test('Catch Cost covers the full selection and reports a partial failure without erasing cost', async () => {
  const { qa, id } = await ready();
  await selected(qa, 'QA-A', 'product-2'); await publish(qa, id);
  qa.state.costs['0999000000007'] = { error: 'Point Base unavailable' };
  const result = await qa.service.catchCost(qa.actors.sales, 'QA-A');
  assert.equal(result.failed, 1); assert.equal(result.updated, 1);
  assert.equal(row(qa, id).costMyr, 36);
  assert.equal(row(qa, id).published.priceCtn, 12);
  assert.equal(new Set(qa.state.costRequests.at(-1)).size, 2);
  assert.match(row(qa, id).costError, /unavailable/);
});

test('new cost updates the target suggestion and actual GP while customer price remains published', async () => {
  const { qa, id } = await ready(); await publish(qa, id);
  qa.state.costs['0999000000007'].netCostCtn = 48;
  await qa.service.catchCost(qa.actors.sales, 'QA-A');
  assert(Math.abs(row(qa, id).draft.priceCtn - 16) < 0.00001);
  assert.equal(row(qa, id).published.priceCtn, 12);
  assert.equal(row(qa, id).publishedGp, 0);
  await setPrice(qa, id, { mode: 'EA', value: 2 });
  qa.state.costs['0999000000007'].netCostCtn = 60;
  await qa.service.catchCost(qa.actors.sales, 'QA-A');
  assert.equal(row(qa, id).draft.priceEa, 2);
  assert.equal(row(qa, id).draft.gp, 37.5);
});

test('same request is idempotent and stale edits or stale publications cannot replace newer state', async () => {
  const { qa, id } = await ready();
  const requestId = randomUUID(), revision = row(qa, id).revision;
  const action = () => qa.service.publish(qa.actors.sales, 'QA-A', id, true, revision, requestId);
  const [first, second] = await Promise.all([action(), action()]);
  assert.deepEqual(first, second); assert.equal(Object.keys(qa.state.delivered).length, 1);
  await assert.rejects(qa.service.saveDraft(qa.actors.sales, 'QA-A', id, { mode: 'EA', value: 2 }, revision, randomUUID()), /has changed/);
  await setPrice(qa, id, { mode: 'EA', value: 2 }); await publish(qa, id);
  await action();
  assert.equal(row(qa, id).published.priceCtn, 24);
  await assert.rejects(qa.service.publish(qa.actors.sales, 'QA-A', id, false, revision, requestId), /different contents/);
});

for (const failure of ['BEFORE', 'AFTER']) {
  test(`a ${failure.toLowerCase()}-write disconnect recovers after a process restart`, async () => {
    const file = path.join(os.tmpdir(), 'quotation-qa-' + randomUUID() + '.json');
    try {
      let qa = createIsolation({ file }); const id = await selected(qa);
      await qa.service.catchCost(qa.actors.sales, 'QA-A'); await setPrice(qa, id);
      qa.state.failure = failure;
      assert.equal((await publish(qa, id)).pending, true);
      assert.equal(row(qa, id).pending, true);
      await assert.rejects(setPrice(qa, id), /previous quote/);
      qa = createIsolation({ file });
      assert.equal(await qa.service.recover(), 0);
      assert.equal(row(qa, id).pending, false);
      assert.equal(row(qa, id).published.enabled, true);
      assert.equal(Object.keys(qa.state.delivered).length, 1);
    } finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
  });
}

test('turning off the quote hides prices, rejects a new order, and preserves submitted prices', async () => {
  const { qa, id } = await ready(); await publish(qa, id);
  const buyer = qa.buyerApi('QA-A');
  const orderRequest = randomUUID(); const lines = [{ itemId: id, quantityCtn: 2 }];
  const order = await buyer.submitBuyerOrder(lines, '', orderRequest, 'QA-PO');
  assert.equal((await buyer.submitBuyerOrder(lines, '', orderRequest, 'QA-PO')).orderId, order.orderId);
  await publish(qa, id, false);
  const workspace = await buyer.getBuyerWorkspace();
  assert.equal(workspace.myList.length, 1); assert.equal(workspace.myList[0].vipPriceCtn, 0);
  await assert.rejects(buyer.submitBuyerOrder(lines, '', randomUUID()), /released/);
  const [line] = qa.store.rows('WixBuyerOrderLines').map(record => JSON.parse(record.payload));
  assert.equal(line.lockedUnitPrice, 12); assert.equal(line.lineAmount, 24);
  assert.equal(qa.store.rows('WixBuyerOrders').length, 1);
});

test('the existing Excel builder exports customer prices and pack formulas without internal costs', async () => {
  const { qa, id } = await ready(); await publish(qa, id);
  const file = await qa.exportExcel('QA-A');
  assert.equal(file.rowCount, 1); assert.equal(file.bytes.subarray(0, 2).toString(), 'PK');
  const xml = file.bytes.toString();
  for (const expected of ['Chocolate Cream Biscuits', '0999000000007', 'USD / EA', 'USD / CTN', 'E3*F3']) assert(xml.includes(expected));
  assert(!xml.includes('netCostCtn')); assert(!xml.includes('Target GP'));
});

test('company, customer and Support quote permissions are enforced by existing policy', async () => {
  const { qa, id } = await ready();
  await assert.rejects(qa.service.catchCost(qa.actors.support, 'QA-A'), /access/);
  assert.throws(() => qa.service.list(qa.actors.sales, 'QA-B'), /access/);
  const otherId = await selected(qa, 'QA-B');
  await assert.rejects(qa.service.saveDraft(qa.actors.sales, 'QA-A', otherId, { mode: 'EA', value: 2 }, 0, randomUUID()), /no longer/);
  await publish(qa, id);
  const otherWorkspace = await qa.buyerApi('QA-B').getBuyerWorkspace();
  assert.equal(otherWorkspace.myList.length, 1); assert.equal(otherWorkspace.myList[0].vipPriceCtn, 0);
  assert.doesNotMatch(JSON.stringify(otherWorkspace), /costMyr|rateToMyr|targetGp|commission/);
  await assert.rejects(qa.buyerApi('QA-B').submitBuyerOrder([{ itemId: id, quantityCtn: 1 }], '', randomUUID()), /Invalid order/);
});
