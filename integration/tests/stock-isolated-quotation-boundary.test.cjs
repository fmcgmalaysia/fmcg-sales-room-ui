'use strict';
// Actual original QD callback and generated Buyer order code share only the
// retained quotation reference. Synthetic identity is a TEST fixture, not native
// authorization/coverage evidence. No external request or original source edit.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { buildIsolatedCohort } = require('../prototypes/stock-current-state/build-isolated-cohort.cjs');
const root = path.resolve(__dirname, '../..'), packet = buildIsolatedCohort();
const clean = source => source.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
const copy = row => JSON.parse(JSON.stringify(row));

test('retained selection/QD and FX imports do not install the repository-only display or FX alternatives', () => {
  assert.deepEqual(Object.keys(packet.report.collections.FMCGMALAYSIA), ['WixBuyerOrders', 'WixBuyerOrderLines', 'WixOrderAudit']);
  for (const name of ['catalogueSelection.web.js', 'fxRates.web.js']) assert.equal(packet.output.has('FMCGMALAYSIA/r2' + name), false);
  const catalogue = packet.output.get('relays/buyer-room/catalogue/wix/catalogue-page-v3.js');
  assert.match(catalogue, /from 'backend\/catalogueSelection.web.js'/);
  assert.match(packet.output.get('relays/sales-room/wix/sales-room-page.js'), /from 'backend\/fxRates.web.js'/);
  for (const name of ['r2catalogueAuth.web.js', 'r2onboarding.web.js']) {
    const source = packet.output.get('FMCGMALAYSIA/' + name);
    assert.match(source, /BUYER_LIST_COLLECTION = 'WixBuyerListItems'/);
    assert.doesNotMatch(source, /R2WixBuyerListItems/);
  }
});

test('a fresh original QD quotation is visible to the new Buyer and snapshots into only the new order ledger', async () => {
  const db = new Map(), writes = [], reads = []; let sequence = 0;
  const table = name => { if (!db.has(name)) db.set(name, new Map()); return db.get(name); };
  const wixData = {
    query(name) {
      reads.push(name); const predicates = []; let size = 1000;
      const q = { eq: (k, v) => { predicates.push(row => row[k] === v); return q; },
        hasSome: (k, values) => { predicates.push(row => (Array.isArray(row[k]) ? row[k] : [row[k]]).some(v => values.includes(v))); return q; },
        startsWith: (k, value) => { predicates.push(row => String(row[k] || '').startsWith(value)); return q; },
        limit: value => { size = value; return q; },
        find: async () => ({ items: [...table(name).values()].filter(row => predicates.every(p => p(row))).slice(0, size).map(copy), hasNext: () => false }) };
      return q;
    },
    get: async (name, id) => { reads.push(name); if (!table(name).has(id)) throw Error('Not found'); return copy(table(name).get(id)); },
    insert: async (name, row) => { const saved = { ...copy(row), _id: row._id || 'ROW' + ++sequence }; if (table(name).has(saved._id)) throw Error('Duplicate'); table(name).set(saved._id, saved); writes.push(name); return copy(saved); },
    update: async (name, row) => { table(name).set(row._id, copy(row)); writes.push(name); return copy(row); },
    remove: async (name, id) => { table(name).delete(id); writes.push(name); }
  };
  table('WixCustomers').set('C1', { _id: 'C1', customerId: 'C1', qdFileId: 'TEST-QD', preferredCurrency: 'USD' });
  table('FMCGMALAYSIA').set('P1', { _id: 'P1', barcode: '00123', ea: 24, m3Ctn: 0.02, description: '24 x 1', mainCategory: 'FOOD' });
  table('WixBuyerListItems').set('S1', { _id: 'S1', title: 'C1|00123', customerId: 'C1', payload: JSON.stringify({ customerId: 'C1', productId: 'P1', unitBarcode: '00123', quoteStatus: 'RFQ' }) });
  // Same request identity in the legacy order table must not turn a fresh R2
  // request into a replay of a legacy order. Its exact contents stay untouched.
  const requestId = '00000000-0000-4000-8000-000000000901';
  const legacy = { _id: requestId, title: 'OLD', payload: '{"old":true}' };
  table('WixBuyerOrders').set(requestId, copy(legacy));
  const quoteContext = { wixData, response: value => value, getSecret: async () => 'TEST-QUOTE', console };
  const quote = vm.runInNewContext(clean(fs.readFileSync(path.join(root, 'backend/http-functions.js'), 'utf8').replace(/\r\n/g, '\n')) + ';post_quotationSync;', quoteContext);
  const publication = await quote({ headers: { authorization: 'Bearer TEST-QUOTE' }, body: { json: async () => ({ customerId: 'C1', quotationDeskFileId: 'TEST-QD', requestId: 'FRESH-QUOTE', quotations: [{ wixMyListId: 'S1', unitBarcode: '00123', quotePerPc: 2, quotePerCtn: 48 }] }) } });
  assert.equal(JSON.parse(publication.body).summary.changed, 1);
  assert.deepEqual(writes, ['WixBuyerListItems']);
  const buyer = vm.runInNewContext(clean(packet.output.get('FMCGMALAYSIA/r2catalogueAuth.web.js'))
    + ";resolveBuyerContext=async()=>({customerId:'C1',companyName:'TEST',currency:'USD',selectionLimit:100,email:'test@example.test',actorName:'TEST',actorType:'CUSTOMER_USER'});({workspaceItems,submitBuyerOrder});",
    { wixData, webMethod: (_, fn) => fn, Permissions: { SiteMember: 'TEST' }, console });
  assert.equal((await buyer.workspaceItems('C1'))[0].vipPriceCtn, 48);
  const result = await buyer.submitBuyerOrder([{ itemId: 'S1', quantityCtn: 10 }], '', requestId, 'FRESH-PO');
  assert.equal(result.ok, true);
  const lines = [...table('R2WixBuyerOrderLines').values()].map(row => JSON.parse(row.payload));
  assert.equal(lines.length, 1); assert.equal(lines[0].lockedUnitPrice, 48); assert.equal(lines[0].quantityCtn, 10);
  assert.deepEqual(table('WixBuyerOrders').get(requestId), legacy);
  assert.equal(table('R2WixBuyerListItems').size, 0);
  assert.ok(writes.every(name => ['WixBuyerListItems', 'R2WixBuyerOrders', 'R2WixBuyerOrderLines', 'R2WixOrderAudit'].includes(name)));
  const count = lines.length;
  await buyer.submitBuyerOrder([{ itemId: 'S1', quantityCtn: 10 }], '', requestId, 'FRESH-PO');
  assert.equal(table('R2WixBuyerOrderLines').size, count);
  assert.ok(!reads.includes('WixBuyerOrders'));
});
