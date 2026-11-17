const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createQuotationService } = require('./quotation-service.cjs');
const { patchOnce } = require('./web-registration.cjs');
const root = path.resolve(__dirname, '../../..');

function load(file, names, globals = {}, patch = source => source) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n').replace(/^import .+;$/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(patch(source) + '\n({' + names.join(',') + '})', { Buffer, URL, TextEncoder, console, ...globals });
}
const policy = load('integration/backend/staffManagementPolicy.js', ['canEnterDepartment', 'canUseSalesRoomCustomer']);
const { calculateGrossProfitMargin } = load('integration/backend/grossProfitMargin.js', ['calculateGrossProfitMargin']);

function initialState() {
  const customers = [
    { _id: 'QA-A', customerId: 'QA-A', title: 'Harbour Market · QA', preferredCurrency: 'USD', rateToMyr: 4, catalogueAccessStatus: 'ACTIVE', quotationMode: 'WEB', webQuotationStatus: 'READY' },
    { _id: 'QA-B', customerId: 'QA-B', title: 'Cedar Stores · QA', preferredCurrency: 'SGD', rateToMyr: 3, catalogueAccessStatus: 'ACTIVE', quotationMode: 'WEB', webQuotationStatus: 'READY' }
  ];
  const products = [
    ['0999000000007', 'Chocolate Cream Biscuits', '100 g × 12', 12, 36, 'FOOD'],
    ['0999000000008', 'Sparkling Cola', '320 ml × 24', 24, 48, 'FOOD'],
    ['0999000000009', 'Magiclean Kitchen Cleaner (TP) - Ocean and Love Story Limited Edition', '2 L × 6', 6, 54, 'HOUSEHOLD'],
    ['0999000000010', 'Oat & Honey Breakfast Biscuits', '180 g × 12', 12, 60, 'FOOD']
  ].map(([barcode, name, description, ea, cost, mainCategory], index) => ({ _id: 'product-' + (index + 1), barcode, name, description, ea, cost, mainCategory, pointBaseStatus: 'ACTIVE', m3Ctn: 0.025 }));
  return {
    collections: {
      WixCustomers: customers,
      WixCustomerUsers: customers.map(customer => ({ _id: 'user-' + customer._id, customerId: customer._id, wixMemberId: 'member-' + customer._id, email: customer._id.toLowerCase() + '@example.invalid', title: customer.title, status: 'ACTIVE' })),
      FMCGMALAYSIA: products.map(({ cost, ...product }) => product)
    },
    costs: Object.fromEntries(products.map(product => [product.barcode, { netCostCtn: product.cost, at: '2026-11-17T04:00:00.000Z' }])),
    quotes: {}, receipts: {}, delivered: {}, queryCount: 0, costRequests: [], failure: null
  };
}

function createStore(state, save) {
  const rows = name => state.collections[name] ||= [];
  return {
    rows,
    async get(name, id) { return structuredClone(rows(name).find(row => row._id === id)); },
    async insert(name, row) {
      const id = row._id || name + '-' + (rows(name).length + 1);
      if (rows(name).some(item => item._id === id)) throw Error('Duplicate record');
      const item = structuredClone({ ...row, _id: id });
      rows(name).push(item); save(); return structuredClone(item);
    },
    async update(name, row) {
      const index = rows(name).findIndex(item => item._id === row._id);
      assert(index >= 0); rows(name)[index] = structuredClone(row); save(); return structuredClone(row);
    },
    async remove(name, id) { state.collections[name] = rows(name).filter(item => item._id !== id); save(); },
    query(name) {
      const predicates = [];
      let limit = 50, sortKey = '';
      function page(items, offset = 0) {
        return { items: structuredClone(items.slice(offset, offset + limit)), hasNext: () => offset + limit < items.length, next: async () => page(items, offset + limit) };
      }
      return {
        eq(key, value) { predicates.push(row => row[key] === value); return this; },
        ne(key, value) { predicates.push(row => row[key] !== value); return this; },
        lt(key, value) { predicates.push(row => row[key] < value); return this; },
        startsWith(key, value) { predicates.push(row => String(row[key] || '').startsWith(value)); return this; },
        hasSome(key, values) { predicates.push(row => [].concat(row[key] ?? []).some(value => values.includes(value))); return this; },
        descending(key) { sortKey = key; return this; },
        limit(value) { limit = value; return this; },
        async find() {
          state.queryCount++;
          const items = rows(name).filter(row => predicates.every(check => check(row)));
          if (sortKey) items.sort((a, b) => String(b[sortKey] || '').localeCompare(String(a[sortKey] || '')));
          return page(items);
        }
      };
    }
  };
}

function patchCatalogue(source) {
  const replace = (before, after) => { assert.equal(source.split(before).length, 2, before); source = source.replace(before, after); };
  replace("if (upper(customer.qdStatus) !== 'READY' || !normalize(customer.qdFileId))", "if (customer.quotationMode === 'WEB' && customer.webQuotationStatus !== 'READY') throw new Error('This customer registration is not ready.');\n  if (customer.quotationMode !== 'WEB' && (upper(customer.qdStatus) !== 'READY' || !normalize(customer.qdFileId)))");
  replace("customerId: normalize(customer.customerId),\n    qdFileId:", "customerId: normalize(customer.customerId),\n    quotationMode: customer.quotationMode,\n    qdFileId:");
  replace("if (upper(existing.qdSyncStatus) === 'READY' && normalize(item.customerId)", "if ((upper(existing.qdSyncStatus) === 'READY' || (context.quotationMode === 'WEB' && !existing.removed)) && normalize(item.customerId)");
  const queued = "qdSyncStatus: 'PENDING',";
  replace(queued + "\n        qdSyncedAt:", "qdSyncStatus: context.quotationMode === 'WEB' ? '' : 'PENDING',\n        qdSyncedAt:");
  replace("qdSyncStatus: 'PENDING', payload: JSON.stringify(payload)", "qdSyncStatus: payload.qdSyncStatus, payload: JSON.stringify(payload)");
  replace("queued: true, selection: publicSelection_(item)", "queued: context.quotationMode !== 'WEB', selection: publicSelection_(item)");
  return source;
}

function createIsolation({ file, state: provided } = {}) {
  const state = provided || (file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : initialState());
  function save() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(state));
    fs.renameSync(file + '.tmp', file);
  }
  const store = createStore(state, save);
  const sales = { _id: 'QA-SALES', staffStatus: 'ACTIVE', role: 'STAFF', staffAccess: {
    companyIds: ['NCT'], departmentAccess: { 'SALES MANAGEMENT': 'EDIT' }, salesRoom: 'EDIT', salesFunction: 'SALES', customerAccess: { 'QA-A': 'EDIT' }
  } };
  const actors = { sales, admin: { _id: 'QA-ADMIN', staffStatus: 'ACTIVE', role: 'SUPER ADMIN' },
    support: { ...sales, _id: 'QA-SUPPORT', staffAccess: { ...sales.staffAccess, salesFunction: 'SUPPORT' } } };
  const customers = () => store.rows('WixCustomers');
  const selections = customerId => store.rows('WixBuyerListItems').filter(item => item.customerId === customerId && !item.removed).map(item => {
    const data = JSON.parse(item.payload);
    const product = store.rows('FMCGMALAYSIA').find(product => product._id === data.productId);
    return { id: item._id, barcode: data.unitBarcode, name: product.name, packing: product.description, ea: product.ea, sort: product._id };
  });
  async function deliver(packet) {
    // Simulated signed server-to-server call. Costs never appear in this payload.
    assert.deepEqual(Object.keys(packet).sort(), ['customerId', 'selectionId', 'unitBarcode', 'enabled', 'priceEa', 'priceCtn', 'currency', 'version', 'requestId', 'at'].sort());
    if (state.failure === 'BEFORE') { state.failure = null; save(); throw Error('Simulated disconnect before writing'); }
    const record = await store.get('WixBuyerListItems', packet.selectionId);
    if (!record || record.customerId !== packet.customerId || record.removed) throw Error('Selection ownership mismatch');
    const data = JSON.parse(record.payload);
    const customer = customers().find(customer => customer.customerId === packet.customerId);
    if (data.unitBarcode !== packet.unitBarcode || customer.preferredCurrency !== packet.currency) throw Error('Quotation context mismatch');
    const fingerprint = JSON.stringify(packet);
    const prior = state.delivered[packet.requestId];
    if (prior) { if (prior !== fingerprint) throw Error('Publication request conflict'); return; }
    if (packet.version <= (data.webQuoteVersion || 0)) throw Error('Stale publication');
    const next = { ...data, quoteActive: packet.enabled, quoteStatus: packet.enabled ? 'VIEW QUOTE' : 'RFQ',
      quotePerPc: packet.enabled ? packet.priceEa : 0, vipPriceEa: packet.enabled ? packet.priceEa : 0,
      quotePerCtn: packet.enabled ? packet.priceCtn : 0, vipPriceCtn: packet.enabled ? packet.priceCtn : 0,
      vipCurrency: packet.currency, quoteEffectiveAt: packet.at, webQuoteVersion: packet.version };
    // One local atomic checkpoint models the receiver's item + receipt commit.
    const index = store.rows('WixBuyerListItems').findIndex(item => item._id === record._id);
    store.rows('WixBuyerListItems')[index] = { ...record, payload: JSON.stringify(next) };
    state.delivered[packet.requestId] = fingerprint;
    const lostReply = state.failure === 'AFTER'; state.failure = null; save();
    if (lostReply) throw Error('Simulated response lost after writing');
  }
  const service = createQuotationService({ state, save, policy, calculateGrossProfitMargin, selections, customers,
    readCosts: async barcodes => {
      state.costRequests.push(barcodes); save();
      return Object.fromEntries(barcodes.filter(barcode => state.costs[barcode]).map(barcode => {
        const cost = structuredClone(state.costs[barcode]);
        const product = store.rows('FMCGMALAYSIA').find(item => item.barcode === barcode);
        if (cost.netCostCtn > 0 && product) cost.details = {
          lpEa: cost.netCostCtn / product.ea, lpCtn: cost.netCostCtn,
          disc1: 0, disc2: 0, disc3: 0, remark: product._id === 'product-1' ? '100 FOC 10' : ''
        };
        return [barcode, cost];
      }));
    }, deliver });
  function buyerApi(customerId, loginEmail = '') {
    if (!customers().some(customer => customer.customerId === customerId)) throw Error('Unknown QA customer');
    const globals = { wixData: store, webMethod: (_, run) => run, Permissions: { SiteMember: 'member' },
      currentMember: { getMember: async () => ({ _id: 'member-' + customerId, loginEmail }) },
      getCurrentStaffContext: async () => ({ authorized: false }),
      wixRealtimeBackend: { publish: async () => {} },
      httpsRequest() { throw Error('External network access is disabled in this isolated workflow'); } };
    return { ...load('backend/catalogueSelection.web.js', ['addCatalogueSelection', 'getCatalogueSelectionState'], globals, patchCatalogue),
      ...load('backend/catalogueAuth.web.js', ['getBuyerWorkspace', 'submitBuyerOrder'], globals, source => patchOnce(source,
        'function ensureActive(customer) {',
        "function ensureActive(customer) {\n  if (customer.quotationMode === 'WEB' && customer.webQuotationStatus !== 'READY') throw new Error('This customer registration is not ready.');")) };
  }
  const excel = load('backend/buyerSelectionExcel.js', ['buildBuyerSelectionExcel', 'buildBuyerOrderExcel']);
  const downloads = load('backend/buyerSelectionDownload.js', ['buildBuyerSelectionDownload'], { wixData: store, createHash, ...excel });
  return { state, save, store, service, actors, buyerApi, customers, products: () => store.rows('FMCGMALAYSIA'),
    exportExcel: customerId => downloads.buildBuyerSelectionDownload(customerId, 'https://example.invalid/buyer-room'), deliver };
}
module.exports = { createIsolation, initialState, load, patchCatalogue };
