const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { test } = require('node:test');

const root = path.join(__dirname, '../../..');
function moduleUrl(file, imports = {}) {
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [from, to] of Object.entries(imports)) source = source.replace(from, to);
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}

function privateCollection(sortField) {
  const data = new Map();
  return {
    data,
    read: async key => data.get(key) ?? null,
    latest: async (customerId, selectionId) => [...data.values()].filter(row => row.customerId === customerId && row.selectionId === selectionId)
      .sort((a, b) => b[sortField] - a[sortField])[0] ?? null,
    insert: async row => {
      if (data.has(row._id)) throw Error('Duplicate key');
      data.set(row._id, structuredClone(row));
      return row;
    }
  };
}

test('the quotation transport accepts a signed backend request and rejects tampering or an expired signature before writes', async () => {
  const { createFmcgQuoteReceiver, createMasterQuoteSender } = await import(moduleUrl('backend/masterQuoteTransport.js'));
  let now = 1794919800000;
  let savedRequest;
  const commands = [];
  const secret = async () => 'synthetic-local-quotation-transport-key';
  const receiver = createFmcgQuoteReceiver({ getSecret: secret, now: () => now, putQuote: async payload => {
    commands.push(payload);
    const { customerId, selectionId, version, requestId } = payload;
    return { ok: true, customerId, selectionId, version, requestId };
  } });
  const sender = createMasterQuoteSender({ endpoint: 'https://fmcg999.wixstudio.com/my-site-1/_functions/masterWebQuotation', getSecret: secret,
    now: () => now, fetch: async (url, request) => {
      assert.equal(new URL(url).pathname, '/my-site-1/_functions/masterWebQuotation');
      assert.equal(request.redirect, 'error');
      assert(!JSON.stringify(request.headers).includes(await secret()));
      savedRequest = request;
      const result = await receiver({ headers: request.headers, body: { text: async () => request.body } });
      return { ok: result.status === 200, json: async () => JSON.parse(result.body) };
    } });
  const quote = { customerId: 'QA1', selectionId: 'P01', requestId: randomUUID(), barcode: '2000000000015',
    version: 2, currency: 'USD', enabled: true, priceEa: 1.6, priceCtn: 19.2 };
  assert.equal((await sender(quote)).version, 2);
  assert.deepEqual(commands, [quote]);

  const replay = body => receiver({ headers: savedRequest.headers, body: { text: async () => body } });
  assert.equal((await replay(savedRequest.body.replace('19.2', '29.2'))).status, 401);
  now += 61000;
  assert.equal((await replay(savedRequest.body)).status, 401);
  assert.equal(commands.length, 1);
  assert.throws(() => createMasterQuoteSender({ endpoint: 'https://example.invalid/my-site-1/_functions/masterWebQuotation' }), /Invalid quotation destination/);
});

test('the signed read gateway rejects a quote publication proof and exposes only the requested catalogue scope', async () => {
  const { createFmcgQuotationReader, createMasterQuotationReader, createFmcgQuoteReceiver } = await import(moduleUrl('backend/masterQuoteTransport.js'));
  const getSecret = async () => 'synthetic-local-quotation-transport-key';
  let request;
  const calls = [];
  const read = createFmcgQuotationReader({ getSecret, read: async input => { calls.push(input); return { customers: [] }; } });
  const receiver = createFmcgQuoteReceiver({ getSecret, putQuote: () => { throw Error('A read must never write'); } });
  const sender = createMasterQuotationReader({ endpoint: 'https://www.fmcgmalaysia.com/_functions/masterWebQuotationRead', getSecret,
    fetch: async (url, options) => {
      assert.equal(url, 'https://www.fmcgmalaysia.com/_functions/masterWebQuotationRead');
      request = { headers: options.headers, body: { text: async () => options.body } };
      const result = await read(request);
      return { ok: result.status === 200, json: () => JSON.parse(result.body) };
    }
  });
  assert.deepEqual(await sender({ action: 'customers', customerIds: ['QA1'] }), { ok: true, customers: [] });
  assert.deepEqual(calls.map(call => call.customerIds), [['QA1']]);
  assert.equal((await receiver(request)).status, 401);
  await assert.rejects(sender({ action: 'customers' }), /Invalid quotation data request/);
});

test('Wix quotation read selects the latest row for each product and stops paging once the batch is complete', async () => {
  const pathToRevisionStore = 'backend/masterQuotationRevisionStore.js';
  const { createMasterQuotationWixStore } = await import(moduleUrl('integration/backend/masterQuotationWixStore.js', {
    [pathToRevisionStore]: moduleUrl('integration/' + pathToRevisionStore)
  }));
  const page1 = [7, 6, 5].map(revision => ({ customerId: 'QA1', selectionId: 'P01', revision }));
  const page2 = [{ customerId: 'QA1', selectionId: 'P02', revision: 3 }];
  const reads = [];
  const filters = [];
  let additional = 0;
  const fluent = {
    eq: (key, value) => { filters.push([key, value]); return fluent; },
    hasSome: (key, values) => { filters.push([key, values]); return fluent; },
    descending: field => { assert.equal(field, 'revision'); return fluent; },
    limit: size => { assert.equal(size, 1000); return fluent; },
    find: async options => {
      reads.push(options);
      return { items: page1, hasNext: () => true, next: async () => {
        additional++;
        return { items: page2, hasNext: () => true, next: async () => { throw Error('Do not fetch a page after collecting all products'); } };
      } };
    }
  };
  const store = createMasterQuotationWixStore({ query: name => { assert.equal(name, 'PrivateQuotationRevisions'); return fluent; } }, 'PrivateQuotationRevisions');
  const latest = await store.latestFor('QA1', ['P01', 'P02', 'P02']);
  assert.deepEqual(filters, [['customerId', 'QA1'], ['selectionId', ['P01', 'P02']]]);
  assert.deepEqual(reads, [{ suppressAuth: true, consistentRead: true }]);
  assert.equal(additional, 1);
  assert.deepEqual([...latest.values()].map(row => row.revision), [7, 3]);
});

test('persistent MASTER quotation supplies the FMCG buyer price and resumes with the same request after a lost network response', async t => {
  const [{ createMasterQuotationRevisionStore }, { createMasterQuotationService }, { createMasterQuoteProjection, presentMasterQuote }] = await Promise.all([
    import(moduleUrl('integration/backend/masterQuotationRevisionStore.js')),
    import(moduleUrl('integration/backend/masterQuotationService.js', {
      'backend/grossProfitMargin.js': moduleUrl('integration/backend/grossProfitMargin.js')
    })),
    import(moduleUrl('backend/masterQuoteProjection.js', { 'backend/webQuotationCustomer.js': moduleUrl('backend/webQuotationCustomer.js') }))
  ]);
  const customer = { customerId: 'CUS-QA-001', preferredCurrency: 'USD', rateToMyr: 4,
    catalogueAccessStatus: 'ACTIVE', quotationMode: 'WEB', webQuotationStatus: 'READY' };
  const selection = { customerId: customer.customerId, id: 'sel-qa-001', ea: 12, barcode: '2000000000015', name: 'QA Pick', packing: '12 x 1' };
  const receiptStore = privateCollection('version');
  const receive = createMasterQuoteProjection({ ...receiptStore, readContext: async () => ({ customer, selection }) });
  const selectionPayload = { id: selection.id, customerId: customer.customerId, unitBarcode: selection.barcode,
    quoteStatus: 'RFQ', quoteActive: false, quotePerCtn: 12, quotePerPc: 1, vipPrice: 12 };
  const submitted = [];
  const receiverErrors = [];
  let dropReceipt = true;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/receive-master-quote');
      const chunks = [];
      for await (const data of request) chunks.push(data);
      const packet = JSON.parse(Buffer.concat(chunks));
      submitted.push(packet);
      const receipt = await receive(packet);
      if (dropReceipt) { request.socket.destroy(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(receipt));
    } catch (error) { receiverErrors.push(error.message); response.writeHead(400).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const revisions = createMasterQuotationRevisionStore(privateCollection('revision'));
  const createService = () => createMasterQuotationService({ revisions, readSelections: async () => [selection], readSelection: async () => selection,
    readCosts: async () => ({ [selection.barcode]: { costStatus: 'CAPTURED', costCurrency: 'MYR', unitBarcode: selection.barcode,
      capturedAt: '2026-11-17T10:00:00.000Z', lpPc: 3, lpCtn: 36, disc1: 0, disc2: 0, disc3: 0, note: 'Internal cost' } }),
    deliver: async packet => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/receive-master-quote`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet) });
      if (!response.ok) throw Error('FMCG did not confirm');
      return response.json();
    }
  });
  const scope = { staffId: 'STF-QA-001', customer };
  const workroom = createService();
  assert.deepEqual(await workroom.catchCost(scope), { updated: 1, failed: 0 });
  const draft = await workroom.saveDraft(scope, { selectionId: selection.id, revision: 1, requestId: randomUUID(), input: { mode: 'GP', value: 50 } });
  assert.deepEqual(draft, { revision: 2 });
  const command = { selectionId: selection.id, revision: 2, requestId: randomUUID(), enabled: true };
  assert.equal((await workroom.publish(scope, command)).pending, true);
  assert.equal((await workroom.list(scope))[0].published, null);

  const remote = await receiptStore.latest(customer.customerId, selection.id);
  assert.deepEqual(receiverErrors, []);
  assert.equal(submitted.length, 1);
  assert.equal(presentMasterQuote(selectionPayload, remote).vipPriceCtn, 18);
  assert.equal(presentMasterQuote({ ...selectionPayload, removed: true }, remote).quoteActive, false);
  await assert.rejects(receive({ ...submitted[0], requestId: randomUUID() }), /conflicts/);
  await assert.rejects(receive({ ...submitted[0], costMyr: 36 }), /Invalid/);
  await assert.rejects(receive({ ...submitted[0], customerId: 'CUS-QA-002' }), /unavailable/);
  assert.equal(receiptStore.data.size, 1);

  dropReceipt = false;
  const restarted = createService();
  assert.deepEqual(await restarted.publish(scope, command), { revision: 4 });
  assert.deepEqual(await restarted.publish(scope, command), { revision: 4 });
  assert.deepEqual(submitted[0], submitted[1]);
  assert.equal(submitted.length, 2);
  assert.equal(receiptStore.data.size, 1);
  assert.equal((await restarted.list(scope))[0].published.priceCtn, 18);

  const withdraw = { selectionId: selection.id, revision: 4, requestId: randomUUID(), enabled: false };
  assert.deepEqual(await restarted.publish(scope, withdraw), { revision: 6 });
  const current = await receiptStore.latest(customer.customerId, selection.id);
  assert.equal(current.version, 2);
  const withdrawn = presentMasterQuote(selectionPayload, current);
  assert.equal(withdrawn.vipPriceCtn || withdrawn.quotePerCtn || withdrawn.vipPrice, 0);
  assert.equal(withdrawn.vipPriceEa || withdrawn.quotePerPc, 0);
  assert.deepEqual(await restarted.publish(scope, command), { revision: 4 });
  assert.equal((await receiptStore.latest(customer.customerId, selection.id)).version, 2);
});
