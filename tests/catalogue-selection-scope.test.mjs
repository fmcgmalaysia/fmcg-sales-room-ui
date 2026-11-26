import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueSelectionScope } from '../backend/catalogueSelectionScope.js';

const rows = Array.from({ length: 301 }, (_, ix) => ({
  _id: String(ix), title: 'Test ' + ix, principle: ix === 300 ? ' B ' : 'A',
  mainCategory: 'HOUSEHOLD', subCategories: [], pointBaseStatus: 'ACTIVE'
}));
rows[0] = { ...rows[0], subCategories: ['food'], principle: 'b' };
rows[160] = { ...rows[160], subCategories: ['house'], mainCategory: 'FOOD' };
rows[200] = { ...rows[200], mainCategory: 'FOOD & BEVERAGES' };
const selections = { Alpha: [...rows.map(row => row._id), 'missing'], Beta: ['160'] };
function fixture() {
  const result = createCatalogueSelectionScope({
    getSelectionState: async scope => ({ ok: true, customerId: scope.buyerCompanyId, activeSelectedProductIds: selections[scope.buyerCompanyId] }),
    data: { query(name) {
      let items = name === 'subCategories' ? [{ _id: 'food', mainCategory: 'Food' }, { _id: 'house', mainCategory: 'Household' }] : rows;
      return {
        eq(k, v) { items = items.filter(row => row[k] === v); return this; },
        hasSome(k, values) { assert.ok(values.length <= 100); items = items.filter(row => [row[k]].flat().some(v => values.includes(v))); return this; },
        fields() { return this; }, limit() { return this; },
        async find() { return { items, hasNext: () => false }; }
      };
    } }
  });
  return customerId => result({ buyerCompanyId: customerId }, { customerId });
}
test('selection totals use the entire company selection and preserve inherited food classification', async () => {
  const read = fixture();
  const a = await read('Alpha'), b = await read('Beta');
  assert.equal(a.ids.size, 302);
  assert.deepEqual([...a.food].sort(), ['0', '200', '300']);
  assert.deepEqual([...b.ids], ['160']);
  assert.equal(b.food.size, 0);
});
test('different company from selection authority is rejected before any product lookup', async () => {
  const read = createCatalogueSelectionScope({ data: {}, getSelectionState: async () => ({ ok: true, customerId: 'wrong', activeSelectedProductIds: [] }) });
  await assert.rejects(read({ buyerCompanyId: 'Alpha' }, { customerId: 'Alpha' }), /unavailable/);
  assert.equal((await read({}, { scope: 'staff-preview' })).ids.size, 0);
});
