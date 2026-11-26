// My Selection totals cover the whole company selection, including products
// outside the loaded catalogue page. Only the existing selection authority
// supplies the IDs. Food classification follows the published Catalogue.
const options = { suppressAuth: true, consistentRead: true };
const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();
async function collect(query) {
  let result = await query.limit(1000).find(options);
  const rows = [...result.items];
  while (result.hasNext()) { result = await result.next(); rows.push(...result.items); }
  return rows;
}

export function createCatalogueSelectionScope({ data, getSelectionState, now = Date.now }) {
  let taxonomy, pending, expires = 0;
  const active = () => data.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE');
  async function loadTaxonomy() {
    const categories = await collect(data.query('subCategories').fields('_id', 'mainCategory'));
    const main = new Map(categories.map(row => [row._id, upper(row.mainCategory)]));
    const foodIds = [...main].filter(([, category]) => category.startsWith('FOOD')).map(([id]) => id);
    const food = new Set(), principles = new Set();
    for (let i = 0; i < foodIds.length; i += 100) {
      const rows = await collect(active().hasSome('subCategories', foodIds.slice(i, i + 100)).fields('_id', 'principle'));
      for (const row of rows) {
        food.add(row._id);
        if (text(row.principle)) principles.add(upper(row.principle));
      }
    }
    taxonomy = { main, food, principles };
    expires = now() + 60000;
    return taxonomy;
  }
  function readTaxonomy() {
    if (taxonomy && now() < expires) return taxonomy;
    if (!pending) pending = loadTaxonomy().finally(() => { pending = null; });
    return pending;
  }
  return async (scope, actor) => {
    if (actor.scope === 'staff-preview') return { ids: new Set(), food: new Set() };
    const selection = await getSelectionState(scope.assistCustomerId || { buyerCompanyId: actor.customerId });
    if (selection?.ok !== true || selection.customerId !== actor.customerId || !Array.isArray(selection.activeSelectedProductIds)) {
      throw Error('Company selection unavailable.');
    }
    const ids = new Set(selection.activeSelectedProductIds.filter(id => typeof id === 'string' && id));
    const food = new Set();
    if (!ids.size) return { ids, food };
    const groups = await readTaxonomy(), selected = [...ids];
    for (let i = 0; i < selected.length; i += 100) {
      const rows = await collect(active().hasSome('_id', selected.slice(i, i + 100))
        .fields('_id', 'name', 'title', 'principle', 'subCategories', 'mainCategory'));
      for (const row of rows) {
        if (!text(row.name || row.title)) continue;
        const refs = Array.isArray(row.subCategories) ? row.subCategories : [row.subCategories];
        const main = refs.map(ref => groups.main.get(ref?._id || ref)).find(Boolean) || upper(row.mainCategory);
        if (groups.food.has(row._id) || groups.principles.has(upper(row.principle)) || main.startsWith('FOOD')) food.add(row._id);
      }
    }
    return { ids, food };
  };
}
