import { createCataloguePageIndex } from './cataloguePageIndex.js';
import { validCatalogueReader } from './catalogueReadIdentity.js';

// Internal service. The Wix web method supplies the existing company/employee
// access resolver and the server-side usage control for the current request.
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const OPTIONS = { suppressAuth: true, consistentRead: true };
const LIST_FIELDS = ['_id', 'name', 'title', 'description', 'packingSize', 'barcode', 'unitBarcode', 'brandName', 'principle'];
const DETAIL_FIELDS = [...LIST_FIELDS, 'ea', 'EA', 'price', 'innerBoxBarcode', 'cartonBarcode', 'm3Ctn', 'cbmPerCtn', 'cbm', 'countryOrigin', 'shelflife', 'shelfLife', 'unitPrice', 'pricePerUnit', 'currency'];

function boundedText(value, length) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > length) throw new Error('Invalid catalogue request.');
  return value.trim();
}

function listItem(item) {
  return {
    id: String(item._id), name: String(item.name || item.title || ''),
    description: String(item.description || item.packingSize || ''),
    barcode: String(item.barcode || item.unitBarcode || ''),
    brandName: String(item.brandName || ''), principle: String(item.principle || '')
  };
}

export function createProtectedCatalogueRead({ data, authorize, reserveRead, reserveCoverage, readSelection, addPreviews }) {
  const page = createCataloguePageIndex(data);
  function activeProducts() {
    return data.query(PRODUCT_COLLECTION).eq('pointBaseStatus', 'ACTIVE');
  }

  async function allowed(scope, action, units) {
    const actor = await authorize(scope);
    if (!validCatalogueReader(actor)) throw new Error('Catalogue access unavailable.');
    if (await reserveRead(actor, action, units) !== true) throw new Error('Catalogue access temporarily limited.');
    return actor;
  }

  return {
    async list(scope, input = {}) {
      const term = boundedText(input.term, 120);
      const principle = boundedText(input.principle, 150);
      const afterId = boundedText(input.afterId, 128);
      const anchorId = boundedText(input.anchorId, 128);
      if (anchorId && afterId) throw Error('Choose one page position.');
      const subcategories = input.subcategories ?? [];
      if (!Array.isArray(subcategories) || subcategories.length > 100 ||
          subcategories.some(id => !boundedText(id, 128))) throw new Error('Invalid catalogue category.');
      const size = input.size ?? 25;
      if (size !== 25 && size !== 50) throw new Error('Invalid catalogue page size.');
      const view = input.selectionView ?? '';
      if (!['', 'ALL', 'FOOD', 'NON_FOOD'].includes(view)) throw new Error('Invalid selection view.');
      const actor = await allowed(scope, 'CATALOGUE_LIST', size);
      let selectedIds;
      if (view) {
        const { ids, food } = await readSelection(scope, actor);
        selectedIds = view === 'FOOD' ? food : view === 'NON_FOOD' ? new Set([...ids].filter(id => !food.has(id))) : ids;
      }
      const { items, afterId: nextId, previousAfterId } = await page({ term, principle, subcategories, afterId, anchorId, size, selectedIds });
      if (await reserveCoverage(actor, 'CATALOGUE_LIST', items.map(item => item.id)) !== true) throw new Error('Catalogue access temporarily limited.');
      const products = addPreviews ? await addPreviews(items) : items;
      return { items: products, afterId: nextId, previousAfterId };
    },

    async principles(scope, category) {
      const id = boundedText(category, 128);
      if (!id) throw Error('Choose a catalogue category.');
      await allowed(scope, 'CATALOGUE_LIST', 1);
      const result = await activeProducts().hasSome('subCategories', [id]).limit(1000).distinct('principle', OPTIONS);
      return [...new Set(result.items.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];
    },

    async selectionCounts(scope) {
      const actor = await allowed(scope, 'CATALOGUE_LIST', 1);
      const { ids, food } = await readSelection(scope, actor);
      return { total: ids.size, food: food.size, nonFood: ids.size - food.size };
    },

    async detail(scope, productId) {
      const id = boundedText(productId, 128);
      if (!id) throw new Error('Select a product.');
      const actor = await allowed(scope, 'CATALOGUE_DETAIL', 1);
      const result = await activeProducts().eq('_id', id).fields(...DETAIL_FIELDS).limit(1).find(OPTIONS);
      const item = result.items[0];
      if (!item) return null;
      if (await reserveCoverage(actor, 'CATALOGUE_DETAIL', [id]) !== true) throw new Error('Catalogue access temporarily limited.');
      const unitPrice = [item.unitPrice, item.pricePerUnit].map(Number).find(n => Number.isFinite(n) && n > 0);
      return {
        ...listItem(item), ea: item.ea ?? item.EA ?? item.price ?? '',
        innerBoxBarcode: String(item.innerBoxBarcode || ''), cartonBarcode: String(item.cartonBarcode || ''),
        cbmPerCtn: item.m3Ctn ?? item.cbmPerCtn ?? item.cbm ?? '', countryOrigin: String(item.countryOrigin || ''),
        shelfLife: String(item.shelflife || item.shelfLife || ''), unitPrice: unitPrice ?? null,
        currency: String(item.currency || 'USD').toUpperCase()
      };
    }
  };
}
