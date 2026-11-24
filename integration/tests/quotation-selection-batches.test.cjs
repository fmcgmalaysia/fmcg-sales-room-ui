const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../backend/masterWebQuotationData.js'), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');

test('quotation pack reads overlap within bounded batches and retain ordering, scope and fallbacks', async () => {
  const customerId = 'QA-CUSTOMER';
  const selections = Array.from({ length: 306 }, (_, index) => ({
    _id: 'selection-' + index,
    payload: {
      customerId, unitBarcode: String(9550000000000 + index), productId: 'product-' + index,
      itemName: 'Product ' + index, productReference: { eaPerCtn: 12 }
    }
  }));
  const removed = { _id: 'removed', payload: { ...selections[0].payload, removed: true } };
  const unrelated = { _id: 'unrelated', payload: { ...selections[0].payload, customerId: 'OTHER' } };
  const scheduled = [];
  const wixData = {
    query(collection) {
      return {
        eq() { return this; },
        hasSome(field, ids) { assert.equal(field, '_id'); this.ids = ids; return this; },
        limit(value) { this.pageSize = value; return this; },
        async find(options) {
          assert.equal(options.consistentRead, true);
          if (collection === 'WixCustomers') return { items: [{ customerId, preferredCurrency: 'USD' }] };
          if (collection === 'WixBuyerListItems') {
            return { items: [...selections, removed, unrelated], hasNext: () => false };
          }
          assert.equal(collection, 'FMCGMALAYSIA');
          assert.equal(this.pageSize, 100);
          assert.ok(this.ids.length <= 100);
          return new Promise(resolve => {
            scheduled.push(() => resolve({ items: this.ids.filter(id => id !== 'product-305').map(id => {
              const index = Number(id.split('-')[1]);
              return { _id: id, barcode: selections[index].payload.unitBarcode, ea: 24, m3Ctn: 0.0312, pointBaseSortId: index + 1 };
            }) }));
          });
        }
      };
    }
  };
  const read = vm.runInNewContext(source + '\nreadMasterWebQuotationData', {
    wixData, isWebQuotationReady: () => true, createMasterQuoteProjection: () => () => {}
  });

  const result = read({ action: 'selections', customerId });
  await new Promise(setImmediate);
  assert.equal(scheduled.length, 3);
  scheduled[2]();
  scheduled[0]();
  await new Promise(setImmediate);
  assert.equal(scheduled.length, 3);
  scheduled[1]();
  await new Promise(setImmediate);
  assert.equal(scheduled.length, 4);
  scheduled[3]();

  const { selections: rows } = await result;
  assert.deepEqual(Array.from(rows, row => row.id), selections.map(row => row._id));
  assert.ok(rows.every(row => row.customerId === customerId));
  assert.equal(rows[0].ea, 24);
  assert.equal(rows[0].cbmPerCtn, 0.0312);
  assert.equal(rows[0].sortId, '1');
  assert.equal(rows[305].ea, 12);
  assert.equal(rows[305].sortId, undefined);
});

test('selection totals include only active records for the requested customers and do not look up product data', async () => {
  const active = customerId => ({ customerId, removed: false, payload: { customerId } });
  const fixture = [active('A'), active('A'), active('OTHER'),
    { ...active('A'), removed: true },
    { ...active('A'), payload: { customerId: 'A', removed: true } },
    { ...active('A'), payload: { customerId: 'OTHER' } }];
  const read = vm.runInNewContext(source + '\nreadMasterWebQuotationData', {
    isWebQuotationReady: () => true, createMasterQuoteProjection: () => () => {},
    wixData: {
      query(collection) {
        assert.equal(collection, 'WixBuyerListItems');
        return {
          hasSome(field, ids) { assert.equal(field, 'customerId'); assert.deepEqual(Array.from(ids), ['A', 'B']); return this; },
          limit() { return this; },
          async find() {
            return { items: fixture.slice(0, 2), hasNext: () => true,
              next: async () => ({ items: fixture.slice(2), hasNext: () => false }) };
          }
        };
      }
    }
  });
  const { counts } = await read({ action: 'selection-counts', customerIds: ['A', 'B', 'A'] });
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), [{ customerId: 'A', selectionCount: 2 }, { customerId: 'B', selectionCount: 0 }]);
});
