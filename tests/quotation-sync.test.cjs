const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const customer = { _id: 'customer-1', customerId: 'CUS-260927-ABC123', qdFileId: '12345678901234567890', preferredCurrency: 'USD' };
let selection = {
  _id: 'selection-1',
  payload: JSON.stringify({
    customerId: customer.customerId,
    unitBarcode: '95550001',
    quoteStatus: 'VIEW QUOTE',
    quoteActive: true,
    quotePerPc: 10,
    quotePerCtn: 100,
    vipCurrency: 'USD',
    quoteEffectiveAt: '2026-09-01T00:00:00.000Z',
    quoteRequestId: 'old-request'
  })
};
let updateCount = 0;
const wixData = {
  query() {
    return { eq() { return this; }, limit() { return this; }, async find() { return { items: [customer] }; } };
  },
  async get(_collection, id) { return id === selection._id ? { ...selection } : null; },
  async update(_collection, value) { updateCount += 1; selection = { ...value }; return value; }
};

const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'http-functions.js'), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export async function /gm, 'async function ')
  .replace(/^export function /gm, 'function ');
const postQuotationSync = new Function('response', 'fetch', 'getSecret', 'authentication', 'wixData',
  `${source}\nreturn post_quotationSync;`)(
  value => value,
  async () => { throw new Error('Unexpected fetch'); },
  async () => 'quote-token',
  {},
  wixData
);

async function publish(requestId, quotePerPc, quotePerCtn) {
  const response = await postQuotationSync({
    headers: { authorization: 'Bearer quote-token' },
    body: { json: async () => ({
      requestId,
      customerId: customer.customerId,
      quotationDeskFileId: customer.qdFileId,
      actorEmail: 'sales@example.com',
      quotations: [{ wixMyListId: selection._id, unitBarcode: '95550001', quotePerPc, quotePerCtn }]
    }) }
  });
  return JSON.parse(response.body);
}

test('changed quotation keeps exactly one previous version and unchanged retries preserve time', async () => {
  const first = await publish('request-1', 12, 120);
  assert.equal(first.results[0].changed, true);
  assert.equal(updateCount, 1);
  const afterFirst = JSON.parse(selection.payload);
  assert.equal(afterFirst.previousQuote.quotePerPc, 10);
  assert.equal(afterFirst.previousQuote.quoteEffectiveAt, '2026-09-01T00:00:00.000Z');
  assert.equal(afterFirst.previousQuote.expiredAt, afterFirst.quoteEffectiveAt);
  const effectiveAt = afterFirst.quoteEffectiveAt;

  const retry = await publish('request-1', 12, 120);
  assert.equal(retry.results[0].unchanged, true);
  assert.equal(updateCount, 1);
  assert.equal(JSON.parse(selection.payload).quoteEffectiveAt, effectiveAt);

  const sameValueNewRequest = await publish('request-2', 12, 120);
  assert.equal(sameValueNewRequest.results[0].unchanged, true);
  assert.equal(updateCount, 1);
  assert.equal(JSON.parse(selection.payload).previousQuote.quotePerPc, 10);
});

test('one request ID cannot publish two different quote values', async () => {
  const failed = await publish('request-1', 13, 130);
  assert.equal(failed.results[0].ok, false);
  assert.match(failed.results[0].error, /request ID/i);
  assert.equal(updateCount, 1);
  assert.equal(JSON.parse(selection.payload).quotePerPc, 12);
});

test('active Google staff can publish without a per-sheet shared secret', async () => {
  const googleWixData = {
    ...wixData,
    query(collection) {
      const items = collection === 'StaffMaster'
        ? [{ staffEmail: 'sales@example.com', status: 'ACTIVE' }]
        : [customer];
      return { eq() { return this; }, limit() { return this; }, async find() { return { items }; } };
    }
  };
  const googlePostQuotationSync = new Function('response', 'fetch', 'getSecret', 'authentication', 'wixData',
    `${source}\nreturn post_quotationSync;`)(
    value => value,
    async (url) => {
      assert.match(url, /openidconnect\.googleapis\.com\/v1\/userinfo/);
      return { ok: true, async json() { return { email: 'sales@example.com', email_verified: true }; } };
    },
    async () => 'quote-token',
    {},
    googleWixData
  );
  const response = await googlePostQuotationSync({
    headers: { authorization: 'Bearer google-access-token' },
    body: { json: async () => ({
      requestId: 'google-request',
      customerId: customer.customerId,
      quotationDeskFileId: customer.qdFileId,
      actorEmail: 'sales@example.com',
      quotations: [{ wixMyListId: selection._id, unitBarcode: '95550001', quotePerPc: 12, quotePerCtn: 120 }]
    }) }
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).ok, true);
});
