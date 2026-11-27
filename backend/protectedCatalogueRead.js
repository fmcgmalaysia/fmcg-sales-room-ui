import { createCataloguePageIndex } from './cataloguePageIndex.js';
import { validCatalogueReader } from './catalogueReadIdentity.js';

// Internal service. The Wix web method supplies the existing company/employee
// access resolver and the server-side usage control for the current request.
const PRODUCT_COLLECTION = 'FMCGMALAYSIA';
const FIRST_PREVIEW_COUNT = 5;
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

export function createProtectedCatalogueRead({ data, authorize, reserveRead, reserveCoverage, readSelection, readInitialSelection, addPreviews, deliveredIds, readPrivatePreviews, page = createCataloguePageIndex(data) }) {
  function activeProducts() {
    return data.query(PRODUCT_COLLECTION).eq('pointBaseStatus', 'ACTIVE');
  }

  async function checkedActor(scope) {
    const actor = await authorize(scope);
    if (!validCatalogueReader(actor)) throw new Error('Catalogue access unavailable.');
    return actor;
  }

  async function charge(actor, action, units) {
    if (await reserveRead(actor, action, units) !== true) throw new Error('Catalogue access temporarily limited.');
  }

  async function allowed(scope, action, units) {
    const actor = await checkedActor(scope);
    await charge(actor, action, units);
    return actor;
  }

  async function list(scope, input = {}) {
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
      return deliverPage(actor, { term, principle, subcategories, afterId, anchorId, size, selectedIds }, input.deferImages);
  }

  async function deliverPage(actor, input, deferImages) {
      const { items, afterId: nextId, previousAfterId } = await page(input);
      if (await reserveCoverage(actor, 'CATALOGUE_LIST', items.map(item => item.id)) !== true) throw new Error('Catalogue access temporarily limited.');
      let products = items;
      if (deferImages === true) {
        // One signing batch starts the visible list. A slow fallback for a single
        // missing preview must not hold up the initial page.
        const first = await readPrivatePreviews(items.slice(0, FIRST_PREVIEW_COUNT));
        products = [...first, ...items.slice(FIRST_PREVIEW_COUNT)];
      } else if (addPreviews) {
        products = await addPreviews(items);
      }
      return { items: products, afterId: nextId, previousAfterId };
  }

  return {
    list,
    async openAssisted(customerId) {
      const id = boundedText(customerId, 160);
      if (!id) throw Error('Choose a catalogue company.');
      const actor = await checkedActor({ assistCustomerId: id });
      if (!['ADMIN', 'STAFF'].includes(actor.actorType) || !actor.staffId || actor.customerId !== id) {
        throw Error('Staff catalogue access unavailable.');
      }
      const [selection, firstPage] = await Promise.all([
        readInitialSelection(actor),
        charge(actor, 'CATALOGUE_LIST', 25).then(() => deliverPage(actor, {
          term: '', principle: '', subcategories: [], afterId: '', anchorId: '', size: 25
        }, true)).catch(() => null)
      ]);
      if (selection?.ok !== true || selection.customerId !== id) throw Error('Company selection unavailable.');
      return { page: firstPage, selection, staff: { id: actor.staffId, name: actor.actorName, admin: actor.actorType === 'ADMIN' } };
    },

    async thumbnails(scope, ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 10 ||
          ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) return [];
      const actor = await allowed(scope, 'CATALOGUE_LIST', 1);
      // The list request already counted these products. Delivery can repeat without
      // granting new product coverage or consuming the same item units twice.
      const delivered = await deliveredIds(actor, [...new Set(ids)]);
      if (!delivered.length) return [];
      const active = await activeProducts().hasSome('_id', delivered).fields('_id')
        .limit(delivered.length).find(OPTIONS);
      const previews = await addPreviews(active.items.map(item => ({ id: item._id })));
      return previews.filter(item => item.image);
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
