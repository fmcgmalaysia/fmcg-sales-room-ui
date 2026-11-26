// The Wix page previously sorted the full product list inside each browser.
// Keep only search and ordering fields in this server-side index. Recheck the
// current page against the active CMS rows before returning anything.
const options = { suppressAuth: true, consistentRead: true };
const text = value => String(value ?? '').trim();
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const sortKeys = ['pointBaseSortId', 'sortNo', 'sortNO', 'sortNumber', 'sortOrder'];
const listFields = ['_id', 'name', 'title', 'description', 'packingSize', 'barcode', 'unitBarcode', 'brandName', 'principle'];

function listItem(row) {
  return {
    id: row._id, name: text(row.name || row.title), description: text(row.description || row.packingSize),
    barcode: text(row.barcode || row.unitBarcode), brandName: text(row.brandName), principle: text(row.principle)
  };
}

function compare(left, right) {
  const brand = Number(!left.brandName) - Number(!right.brandName) || collator.compare(left.brandName, right.brandName);
  if (brand) return brand;
  const a = left.sortNumber, b = right.sortNumber;
  if (!a || !b) return Number(!a) - Number(!b);
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b)) ? Number(a) - Number(b) : collator.compare(a, b);
}

async function collect(query) {
  const rows = [];
  let page = await query.limit(1000).find(options);
  for (;;) {
    rows.push(...page.items);
    if (!page.hasNext()) return rows;
    page = await page.next();
  }
}

export function createCataloguePageIndex(data, now = Date.now) {
  const active = () => data.query('FMCGMALAYSIA').eq('pointBaseStatus', 'ACTIVE');
  let cached, pending, expires = 0;
  async function ordered() {
    if (cached && now() < expires) return cached;
    if (!pending) pending = collect(active().fields(...listFields, ...sortKeys)).then(rows => {
      const seen = new Set();
      cached = rows.map(row => {
        const entry = listItem(row);
        entry.sortNumber = text(sortKeys.map(key => row[key]).find(value => value != null));
        entry.searchText = [entry.name, entry.description, entry.barcode, entry.principle, entry.brandName].join(' ').toLowerCase();
        return entry;
      }).filter(entry => {
        if (!entry.id || !entry.name || seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      }).sort(compare);
      expires = now() + 60000;
      return cached;
    }).finally(() => { pending = null; });
    return pending;
  }

  return async function page({ term, principle, subcategories, afterId, size }) {
    const matching = () => subcategories.length ? active().hasSome('subCategories', subcategories) : active();
    const [index, categoryRows] = await Promise.all([
      ordered(), subcategories.length ? collect(matching().fields('_id')) : null
    ]);
    const categoryIds = categoryRows && new Set(categoryRows.map(row => row._id));
    const search = term.toLowerCase(), brand = principle.toLowerCase();
    const matches = index.filter(item => (!categoryIds || categoryIds.has(item.id)) &&
      (!brand || item.principle.toLowerCase() === brand) && (!search || item.searchText.includes(search)));
    const from = afterId ? matches.findIndex(item => item.id === afterId) + 1 : 0;
    if (afterId && !from) throw Error('Catalogue changed. Refresh the product list.');
    let position = from;
    const items = [];
    while (items.length <= size && position < matches.length) {
      const ids = matches.slice(position, position + size + 1 - items.length).map(item => item.id);
      position += ids.length;
      const result = await matching().hasSome('_id', ids).fields(...listFields).limit(ids.length).find(options);
      const live = new Map(result.items.map(row => [row._id, listItem(row)]));
      for (const id of ids) {
        const item = live.get(id);
        if (item?.name) items.push(item);
      }
    }
    return { items: items.slice(0, size), afterId: items.length > size ? items[size - 1].id : null };
  };
}
