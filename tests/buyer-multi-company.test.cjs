const assert = require('node:assert/strict');
const { createHash, createHmac, timingSafeEqual, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function load(file, dependencies, names) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(dependencies), source + '\nreturn { ' + names.join(', ') + ' };')(...Object.values(dependencies));
}

function fakeWixData() {
  const collections = new Map();
  const rows = name => {
    if (!collections.has(name)) collections.set(name, []);
    return collections.get(name);
  };
  function page(items, size, offset = 0) {
    return { items: structuredClone(items.slice(offset, offset + size)),
      hasNext: () => offset + size < items.length,
      next: async () => page(items, size, offset + size) };
  }
  return {
    rows,
    query(name) {
      const predicates = [];
      let size = 50, sort;
      const query = {
        eq(key, value) { predicates.push(row => row[key] === value); return query; },
        hasSome(key, values) { predicates.push(row => values.includes(row[key])); return query; },
        startsWith(key, value) { predicates.push(row => String(row[key] || '').startsWith(value)); return query; },
        lt(key, value) { predicates.push(row => row[key] < value); return query; },
        descending(key) { sort = key; return query; },
        limit(count) { size = count; return query; },
        async find() {
          const found = rows(name).filter(row => predicates.every(predicate => predicate(row)));
          if (sort) found.sort((a, b) => String(b[sort]).localeCompare(String(a[sort])));
          return page(found, size);
        }
      };
      return query;
    },
    async get(name, id) {
      const item = rows(name).find(row => row._id === id);
      if (!item) throw new Error('Item was not found.');
      return structuredClone(item);
    },
    async insert(name, item) {
      const saved = { ...structuredClone(item), _id: item._id || randomUUID() };
      if (rows(name).some(row => row._id === saved._id)) throw new Error('Duplicate ID');
      rows(name).push(saved);
      return structuredClone(saved);
    },
    async update(name, item) {
      const index = rows(name).findIndex(row => row._id === item._id);
      if (index < 0) throw new Error('Item was not found.');
      rows(name)[index] = structuredClone(item);
      return structuredClone(item);
    },
    async remove(name, id) {
      const index = rows(name).findIndex(row => row._id === id);
      if (index < 0) throw new Error('Item was not found.');
      rows(name).splice(index, 1);
    }
  };
}

const email = 'buyer.qa@example.test';
const first = { buyerCompanyId: 'CUS-FIXTURE-YYY' };
const second = { buyerCompanyId: 'CUS-FIXTURE-ZZZ' };
const foreign = { buyerCompanyId: 'CUS-FIXTURE-UNRELATED' };

function fixture() {
  const wixData = fakeWixData();
  const ready = { quotationMode: 'WEB', webQuotationStatus: 'READY', lifecycleStatus: 'ACTIVE', accessStatus: 'ACTIVE' };
  wixData.rows('WixCustomers').push(
    { ...ready, _id: 'company-yyy', customerId: first.buyerCompanyId, title: 'Company YYY', preferredCurrency: 'USD', primaryUserId: 'buyer-yyy' },
    { ...ready, _id: 'company-zzz', customerId: second.buyerCompanyId, title: 'Company ZZZ', preferredCurrency: 'SGD' },
    { ...ready, _id: 'company-other', customerId: foreign.buyerCompanyId, title: 'Unrelated Company' });
  wixData.rows('WixCustomerUsers').push({ _id: 'login-buyer', userId: 'buyer-yyy', wixMemberId: 'wix-buyer',
    title: 'Test Buyer', email, customerId: first.buyerCompanyId, status: 'ACTIVE', primaryUser: true });
  wixData.rows('FMCGMALAYSIA').push(
    { _id: 'shared-product', barcode: '9550000000016', name: 'Shared product', ea: 12, pointBaseStatus: 'ACTIVE' },
    { _id: 'only-zzz', barcode: '9550000000023', name: 'Second company product', ea: 12, pointBaseStatus: 'ACTIVE' });
  let member = { _id: 'wix-buyer', loginEmail: email };
  let staffCustomerId = second.buyerCompanyId;
  let confirmInitialGrant = async () => {};
  let buyerMemberStatus = 'APPROVED';
  const prices = new Map();
  const readiness = load('backend/webQuotationCustomer.js', {}, ['isWebQuotationReady', 'isWebQuotationCustomer']);
  const common = {
    ...readiness, createHash, wixData, webMethod: (_permission, fn) => fn, Permissions: { SiteMember: 'SiteMember' },
    currentMember: { getMember: async () => member },
    getCurrentStaffContext: async () => ({ authorized: member?._id === 'wix-staff', staffId: 'STF-QA', memberId: 'wix-staff',
      loginEmail: 'staff.qa@example.test', staffName: 'Test Staff', role: 'SALES' }),
    requireStaffCustomerAccess(_staff, _action, id) {
      if (id !== staffCustomerId) throw new Error('Staff access denied.');
    },
    resolveMasterSalesCreationAssignee: async () => ({ staffId: 'STF-QA', grantRevision: 'a'.repeat(64) }),
    confirmMasterInitialSalesAccess: (...args) => confirmInitialGrant(...args),
    removedSelectionExpired: () => false,
    wixRealtimeBackend: { publish: async () => {} },
    getSecret: async () => 'test-export-secret',
    readMasterWebQuotationData: async ({ customerId, selectionId }) => {
      const customer = wixData.rows('WixCustomers').find(row => row.customerId === customerId);
      const item = wixData.rows('WixBuyerListItems').find(row => row.customerId === customerId && row._id === selectionId);
      return { customer, selection: item && { ...JSON.parse(item.payload), id: item._id } };
    },
    applyWebQuotations: async (customer, selections) => selections.map(selection => {
      const price = prices.get(customer.customerId + '|' + selection.id);
      return price ? { ...selection, quoteStatus: 'VIEW QUOTE', vipPriceEa: price / 12, vipPriceCtn: price,
        vipCurrency: customer.preferredCurrency } : selection;
    })
  };
  const access = load('backend/buyerCompanyAccess.js', common,
    ['companyUserEmail', 'findCompanyLogin', 'linkedAccessId', 'saveLinkedCompanyUser', 'resolveBuyerCompany',
      'getActiveLinkedBuyerCompany', 'listBuyerCompanies', 'checkBuyerDownloadGrant']);
  const provisioning = load('backend/buyerMemberProvisioning.js', {
    ...common, elevate: method => method, members: {
      createMember: async () => assert.fail('Linking an approved account must never create a Wix member'),
      getMember: async id => ({ _id: id, loginEmail: email, status: buyerMemberStatus })
    }
  }, ['hasApprovedBuyerMember', 'prepareActivatedBuyerMember']);
  const registration = load('backend/webQuotationRegistration.js', { ...common, ...access, ...provisioning },
    ['reserveWebQuotationCustomer', 'reserveWebQuotationPrimaryUser', 'reserveLinkedRegistrationPrimary', 'activateWebQuotationCustomer']);
  const tokenBindings = { createHmac, timingSafeEqual };
  const tokens = {
    ...load('backend/buyerSelectionExportToken.js', tokenBindings, ['createBuyerSelectionExportToken', 'verifyBuyerSelectionExportToken']),
    ...load('backend/buyerOrderExportToken.js', tokenBindings, ['createBuyerOrderExportToken', 'verifyBuyerOrderExportToken'])
  };
  const buyer = load('backend/catalogueAuth.web.js', { ...common, ...access, ...tokens },
    ['getBuyerCompanies', 'getCurrentBuyerContext', 'getBuyerWorkspace', 'saveBuyerQuantity', 'submitBuyerOrder',
      'createBuyerSelectionDownload', 'getBuyerOrderDetail']);
  const catalogue = load('backend/catalogueSelection.web.js', { ...common, ...access }, ['getCatalogueSelectionState', 'addCatalogueSelection']);
  const sales = load('sales-room/wix/onboarding.web.js', { ...common, ...access, ...provisioning, ...registration },
    ['createSalesRoomCustomer', 'addSalesRoomCustomerUser', 'reviewSalesRoomCustomerUser']);
  const http = load('backend/http-functions.js', { ...common, ...access, ...tokens, response: result => result,
    buildBuyerSelectionDownload: async (id, url) => ({ fileName: id + '.xlsx', bytes: Buffer.from(url) })
  }, ['get_buyerSelectionExcel', 'findAuthorizedBuyer']);
  return { wixData, buyer, catalogue, sales, http,
    quote: (customerId, selectionId, price) => prices.set(customerId + '|' + selectionId, price),
    setMember: next => { member = next; }, setStaffCustomer: id => { staffCustomerId = id; },
    setGrant: next => { confirmInitialGrant = next; }, setMemberStatus: status => { buyerMemberStatus = status; } };
}

const newCompany = { companyName: 'QA NEW COMPANY', customerShortName: 'QA NEW', country: 'MALAYSIA',
  natureOfBusiness: 'WHOLESALE', picTitle: 'MR', picName: 'QA BUYER', picEmail: email.toUpperCase(),
  picMobile: '+600000000000', whatsapp: 'NO', preferredCurrency: 'SGD', destinationPort: 'QA PORT' };
const operator = { _id: 'wix-staff', loginEmail: 'staff.qa@example.test' };

test('Sales Room links a new company only after staff confirmation and recovers the same pending registration', async () => {
  const f = fixture();
  const buyerMember = { _id: 'wix-buyer', loginEmail: email };
  const confirmed = { ...newCompany, linkExistingLogin: 'yes' };
  await assert.rejects(f.sales.createSalesRoomCustomer(confirmed), /staff/i);
  f.setMember(operator);
  const original = structuredClone(f.wixData.rows('WixCustomerUsers')[0]);
  assert.deepEqual(await f.sales.createSalesRoomCustomer(newCompany), { ok: false, requiresExistingBuyerLogin: true });
  f.setMemberStatus('BLOCKED');
  assert.equal((await f.sales.createSalesRoomCustomer(confirmed)).ok, false);
  assert.equal(f.wixData.rows('WixCustomers').length, 3);
  f.setMemberStatus('APPROVED');
  let grantCalls = 0;
  f.setGrant(async (_staffEmail, _customer, _owner, _revision) => {
    if (++grantCalls === 1) throw Error('Lost MASTER acknowledgement');
  });
  const pending = await f.sales.createSalesRoomCustomer(confirmed);
  assert.equal(pending.retryable, true);
  const id = pending.result.customerId;
  const company = f.wixData.rows('WixCustomers').find(row => row.customerId === id);
  const primary = f.wixData.rows('WixCustomerUsers').find(row => row.customerId === id);
  assert.equal(company.accessStatus, 'PENDING');
  assert.equal(primary.status, 'PENDING');
  assert.equal(primary.userId, company.primaryUserId);
  assert.equal(primary.linkedLoginId, original._id);
  assert.equal(primary.email, undefined);
  assert.equal(primary.wixMemberId, undefined);
  f.setMember(buyerMember);
  assert.deepEqual((await f.buyer.getBuyerCompanies()).companies.map(row => row.customerId), [first.buyerCompanyId]);
  await assert.rejects(f.buyer.getBuyerWorkspace({ buyerCompanyId: id }), /no longer available/);

  f.setMember(operator);
  const completed = await f.sales.createSalesRoomCustomer(confirmed);
  assert.equal(completed.ok, true);
  assert.equal(completed.result.customerId, id);
  assert.equal((await f.sales.createSalesRoomCustomer(confirmed)).result.customerId, id);
  assert.equal(f.wixData.rows('WixCustomers').length, 4);
  assert.equal(f.wixData.rows('WixCustomerUsers').length, 2);
  assert.equal(f.wixData.rows('CustomerAssignmentAudit').length, 1);
  assert.equal(f.wixData.rows('CustomerUserAudit').length, 3);
  assert.deepEqual(f.wixData.rows('WixCustomerUsers')[0], original);
  f.setMember(buyerMember);
  assert.deepEqual((await f.buyer.getBuyerCompanies()).companies.map(row => row.customerId), [first.buyerCompanyId, id]);
  const workspace = await f.buyer.getBuyerWorkspace({ buyerCompanyId: id });
  assert.equal(workspace.account.primary.email, email);
  assert.equal(workspace.account.users[0].primary, true);
  assert.equal((await f.buyer.getBuyerWorkspace(first)).context.currency, 'USD');
});

test('simultaneous linked registrations share a customer, primary authorization and audit', async () => {
  const f = fixture();
  f.setMember(operator);
  const confirmed = { ...newCompany, linkExistingLogin: 'yes' };
  const [first, retry] = await Promise.all([
    f.sales.createSalesRoomCustomer(confirmed), f.sales.createSalesRoomCustomer(confirmed)
  ]);
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(first.result.customerId, retry.result.customerId);
  assert.equal(f.wixData.rows('WixCustomers').length, 4);
  assert.equal(f.wixData.rows('WixCustomerUsers').length, 2);
  assert.equal(f.wixData.rows('CustomerAssignmentAudit').length, 1);
  assert.equal(f.wixData.rows('CustomerUserAudit').length, 3);
});

test('Chrome keeps Sales Room form values and requires an explicit association on every retry', { timeout: 15000 }, async () => {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
  const f = fixture();
  f.setMember(operator);
  let initialGrantCount = 0;
  f.setGrant(async () => {
    if (++initialGrantCount === 1) throw Error('Lost MASTER acknowledgement');
  });
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.exposeBinding('createQaCustomer', async (_, fields) => {
      requests.push(fields);
      return f.sales.createSalesRoomCustomer(fields);
    });
    const html = fs.readFileSync(path.join(__dirname, '..', 'sales-room-20261124-company-switch.html'), 'utf8');
    await page.route('**/*', route => new URL(route.request().url()).pathname === '/sales-qa'
      ? route.fulfill({ contentType: 'text/html; charset=UTF-8', body: html }) : route.abort());
    await page.addInitScript(() => window.addEventListener('message', async ({ data }) => {
      if (data?.type !== 'SALES_ROOM_CREATE_CUSTOMER') return;
      const result = await window.createQaCustomer(data.payload);
      window.postMessage({ type: 'SALES_ROOM_CREATE_RESULT', ...result }, '*');
    }));
    await page.goto('http://fmcg-qa.invalid/sales-qa');
    await page.evaluate(fields => {
      showView('new');
      renderAssignableStaff({ ok: true, canCreate: true, staff: [], quotationMode: 'WEB' });
      for (const [field, value] of Object.entries(fields)) document.getElementById('customerForm').elements[field].value = value;
    }, newCompany);
    await page.locator('#createBtn').click();
    const confirm = page.getByRole('button', { name: 'Link existing login and create customer' });
    await confirm.waitFor();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].linkExistingLogin, undefined);
    assert.equal(f.wixData.rows('WixCustomers').length, 3);
    await confirm.click();
    await page.getByText(/Setup confirmation is pending/).waitFor();
    assert.equal(await page.locator('input[name="picEmail"]').inputValue(), newCompany.picEmail);
    assert.equal(await page.locator('input[name="companyName"]').inputValue(), newCompany.companyName);
    await confirm.click();
    await page.getByText(/Customer Successfully Created/).waitFor();
    assert.equal(requests.length, 3);
    assert.equal(requests[2].linkExistingLogin, 'yes');
    assert.equal(f.wixData.rows('WixCustomers').length, 4);
  } finally {
    await browser.close();
  }
});

test('the entry stays closed while company access is unknown and opens only after an authorized choice', async () => {
  const { loadBuyerCompanyAccess } = load('buyer-room/wix/buyerCompanyNavigation.js', {}, ['loadBuyerCompanyAccess']);
  const unavailable = async () => { throw new Error('Temporary read failure'); };
  assert.deepEqual(await loadBuyerCompanyAccess(unavailable, ''), {
    companies: [], blocked: true, currentId: '', denied: true
  });
  const companies = [
    { customerId: 'CUS-TEST-1', companyName: 'Test Alpha' },
    { customerId: 'CUS-TEST-2', companyName: 'Test Beta' }
  ];
  const lookup = async () => ({ originalCompanyId: 'CUS-TEST-1', companies });
  assert.equal((await loadBuyerCompanyAccess(lookup, '')).blocked, true);
  assert.equal((await loadBuyerCompanyAccess(lookup, 'CUS-UNRELATED')).blocked, true);
  assert.deepEqual(await loadBuyerCompanyAccess(lookup, 'CUS-TEST-2'), {
    companies, blocked: false, currentId: 'CUS-TEST-2', scoped: true
  });
  assert.equal((await loadBuyerCompanyAccess(async () => ({
    originalCompanyId: 'CUS-TEST-1', companies: [companies[0]]
  }), '')).blocked, false);
});

test('one fake login can select and order separately in two companies, then loses only the revoked company', async () => {
  const { wixData, buyer, catalogue, sales, http, quote, setMember, setStaffCustomer } = fixture();
  const member = { _id: 'wix-buyer', loginEmail: email };
  const staff = { _id: 'wix-staff', loginEmail: 'staff.qa@example.test' };
  assert.deepEqual((await buyer.getBuyerCompanies()).companies.map(row => row.customerId), [first.buyerCompanyId]);
  assert.equal((await buyer.getCurrentBuyerContext()).buyer.customerId, first.buyerCompanyId);
  assert.equal((await http.findAuthorizedBuyer(email)).authorized, true);
  const details = { userName: 'Test Buyer', email, mobileNo: '+600000000000', linkExistingLogin: 'yes' };
  await assert.rejects(sales.addSalesRoomCustomerUser(second.buyerCompanyId, details, randomUUID()), /not authorized/);
  setMember(staff);
  await assert.rejects(sales.addSalesRoomCustomerUser(foreign.buyerCompanyId, details, randomUUID()), /Staff access denied/);
  const linkRequest = randomUUID();
  const linked = await sales.addSalesRoomCustomerUser(second.buyerCompanyId, details, linkRequest);
  assert.equal((await sales.addSalesRoomCustomerUser(second.buyerCompanyId, details, linkRequest)).duplicateRequest, true);
  assert.equal(wixData.rows('WixCustomerUsers').filter(row => row.email === email).length, 1);

  setMember(member);
  assert.deepEqual((await buyer.getBuyerCompanies()).companies.map(row => row.customerId), [first.buyerCompanyId, second.buyerCompanyId]);
  const firstCompany = wixData.rows('WixCustomers').find(row => row.customerId === first.buyerCompanyId);
  firstCompany.accessStatus = 'SUSPENDED';
  assert.equal((await http.findAuthorizedBuyer(email)).customer.customerId, second.buyerCompanyId);
  assert.equal((await buyer.getCurrentBuyerContext()).buyer.customerId, second.buyerCompanyId);
  await assert.rejects(buyer.getBuyerWorkspace(first), /no longer available/);
  firstCompany.accessStatus = 'ACTIVE';
  setMember({ _id: 'other-wix-member', loginEmail: email });
  await assert.rejects(buyer.getBuyerWorkspace(second), /not linked/);
  setMember(member);
  await assert.rejects(buyer.getBuyerWorkspace(foreign), /no longer available/);
  await assert.rejects(buyer.getBuyerWorkspace(second.buyerCompanyId), /staff authorization/);
  const [yyy, zzz] = await Promise.all([
    catalogue.addCatalogueSelection('shared-product', first),
    catalogue.addCatalogueSelection('shared-product', second)
  ]);
  await catalogue.addCatalogueSelection('only-zzz', second);
  assert.notEqual(yyy.selection.id, zzz.selection.id);
  assert.deepEqual((await catalogue.getCatalogueSelectionState(first)).activeSelectedProductIds, ['shared-product']);
  assert.deepEqual((await catalogue.getCatalogueSelectionState(second)).activeSelectedProductIds, ['shared-product', 'only-zzz']);
  quote(first.buyerCompanyId, yyy.selection.id, 24);
  quote(second.buyerCompanyId, zzz.selection.id, 36);
  const [workspaceYYY, workspaceZZZ] = await Promise.all([buyer.getBuyerWorkspace(first), buyer.getBuyerWorkspace(second)]);
  assert.equal(workspaceYYY.myList[0].vipPriceCtn, 24);
  assert.equal(workspaceZZZ.myList[0].vipPriceCtn, 36);
  assert.equal(workspaceYYY.context.currency, 'USD');
  assert.equal(workspaceZZZ.context.currency, 'SGD');
  await assert.rejects(buyer.saveBuyerQuantity(zzz.selection.id, 1, first), /item was not found/);
  const [orderYYY, orderZZZ] = await Promise.all([
    buyer.submitBuyerOrder([{ itemId: yyy.selection.id, quantityCtn: 2 }], first, randomUUID(), 'QA-YYY'),
    buyer.submitBuyerOrder([{ itemId: zzz.selection.id, quantityCtn: 3 }], second, randomUUID(), 'QA-ZZZ')
  ]);
  assert.equal(orderYYY.status, 'CONFIRMED');
  assert.equal(orderZZZ.status, 'CONFIRMED');
  assert.notEqual(orderYYY.orderId, orderZZZ.orderId);
  const lines = wixData.rows('WixBuyerOrderLines').map(row => JSON.parse(row.payload)).sort((a, b) => a.customerId.localeCompare(b.customerId));
  assert.deepEqual(lines.map(line => [line.customerId, line.lineAmount, line.currency]), [[first.buyerCompanyId, 48, 'USD'], [second.buyerCompanyId, 108, 'SGD']]);
  await assert.rejects(buyer.getBuyerOrderDetail(orderZZZ.orderId, first), /not found/);

  const download = await buyer.createBuyerSelectionDownload(second);
  const token = new URL(download.url, 'https://example.test').searchParams.get('token');
  const request = { query: { token }, baseUrl: 'https://www.fmcgmalaysia.com/_functions' };
  const initialDownload = await http.get_buyerSelectionExcel(request);
  assert.equal(initialDownload.status, 200);
  assert.equal(initialDownload.body.toString(), 'https://www.fmcgmalaysia.com/buyer-room?company=' + second.buyerCompanyId);

  setMember(staff);
  setStaffCustomer(first.buyerCompanyId);
  await assert.rejects(sales.reviewSalesRoomCustomerUser(second.buyerCompanyId, linked.userId, 'REVOKE', { reason: 'QA' }), /Staff access denied/);
  setStaffCustomer(second.buyerCompanyId);
  await sales.reviewSalesRoomCustomerUser(second.buyerCompanyId, linked.userId, 'REVOKE', { reason: 'QA' });
  setMember(member);
  await assert.rejects(buyer.getBuyerWorkspace(second), /no longer available/);
  await assert.rejects(catalogue.getCatalogueSelectionState(second), /no longer available/);
  await assert.rejects(catalogue.addCatalogueSelection('only-zzz', second), /no longer available/);
  await assert.rejects(buyer.submitBuyerOrder([{ itemId: zzz.selection.id, quantityCtn: 1 }], second, randomUUID()), /no longer available/);
  assert.equal((await http.get_buyerSelectionExcel(request)).status, 403);
  assert.equal((await buyer.getBuyerWorkspace(first)).context.customerId, first.buyerCompanyId);
  assert.equal(wixData.rows('WixBuyerOrders').length, 2);
});

test('Chrome switches both rooms and retains separate companies in two open order forms', { timeout: 45000 }, async () => {
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) { playwright = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
  const { wixData, buyer, catalogue, sales, quote, setMember } = fixture();
  const member = { _id: 'wix-buyer', loginEmail: email };
  const staff = { _id: 'wix-staff', loginEmail: 'staff.qa@example.test' };
  setMember(staff);
  const linked = await sales.addSalesRoomCustomerUser(second.buyerCompanyId,
    { userName: 'Test Buyer', email, mobileNo: '+600000000000', linkExistingLogin: 'yes' }, randomUUID());
  setMember(member);
  const original = await catalogue.addCatalogueSelection('shared-product', first);
  quote(first.buyerCompanyId, original.selection.id, 24);
  const navigation = load('buyer-room/wix/buyerCompanyNavigation.js', {}, ['buyerCompanyPath', 'buyerCompanyChooser']);
  const products = wixData.rows('FMCGMALAYSIA').map(product => ({ ...product, id: product._id, mainCategory: 'FOOD' }));

  function fixtureHost(isCatalogue) {
    const content = isCatalogue ? '/catalogue-frame' : '/buyer-frame';
    return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style>
<iframe src="${content}"></iframe><script>
const buyerCompanyPath = ${navigation.buyerCompanyPath};
const buyerCompanyChooser = ${navigation.buyerCompanyChooser};
const products = ${JSON.stringify(products)};
const company = new URL(location.href).searchParams.get('company') || '';
const inCatalogue = ${isCatalogue};
const child = document.querySelector('iframe').contentWindow;
const post = (type, props) => child.postMessage({type,...props}, '*');
const navigate = (page, id = company) => location.href = buyerCompanyPath(page,id);
let access;
async function refresh(denied = false) {
  access = buyerCompanyChooser(await window.qaRPC('companies'), company);
  if (denied) access = {...access, denied:true, blocked:true, currentId:''};
  post('BUYER_COMPANY_ACCESS',access);
  if (access.blocked) return;
  if (inCatalogue) {
    const state = await window.qaRPC('selection');
    post('catalogueWorkspaceData',{...state,products,selectionTotal:state.total,selectionReady:true,mode:'buyer',buyerRoomUrl:buyerCompanyPath('/buyer-room',company),context:{mode:'buyer'}});
  } else {
    const workspace = await window.qaRPC('workspace');
    post('BUYER_ROOM_DATA',{data:{...workspace,...workspace.context,catalogueUrl:buyerCompanyPath('/catalogue',company),memberName:'Test Buyer'}});
  }
}
window.addEventListener('message', async ({source,data}) => {
  if(source!==child || !data) return;
  try {
    if (['BUYER_ROOM_READY','BUYER_ROOM_REQUEST_DATA','catalogueWorkspaceReady'].includes(data.type)) { await refresh(); return; }
    if(data.type==='BUYER_COMPANY_SWITCH' && access?.companies.some(row=>row.customerId===data.customerId)){navigate(location.pathname,data.customerId);return}
    if (data.type==='BUYER_ROOM_BROWSE_CATALOGUE') {navigate('/catalogue');return}
    if (data.type==='catalogueWorkspaceSelect') {
      await window.qaRPC('add',data.productId);
      post('catalogueWorkspaceSelection',{ok:true,productId:data.productId});
      await refresh();
    }
    if (data.type==='BUYER_ROOM_SAVE_QTY') {
      const result=await window.qaRPC('quantity',data.itemId,data.quantityCtn);
      post('BUYER_ROOM_ACTION_RESULT',{...result,itemId:data.itemId,action:'quantity',ok:true});
    }
    if(data.type==='BUYER_ROOM_SUBMIT_ORDER'){
      const result=await window.qaRPC('order',data.lines,data.requestId,data.customerPoNumber);
      post('BUYER_ROOM_ORDER_RESULT',result);
      await refresh();
    }
  } catch (error) {
    if(/no longer available/.test(error.message)){await refresh(true);return}
    window.qaError = error.message;
  }
});
</script>`;
  }
  const root = path.join(__dirname, '..');
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(6500);
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.exposeBinding('qaRPC', async ({ page }, method, ...args) => {
      const id = new URL(page.url()).searchParams.get('company');
      const scope = id ? { buyerCompanyId: id } : '';
      if (method === 'companies') return buyer.getBuyerCompanies();
      if (method === 'selection') return catalogue.getCatalogueSelectionState(scope);
      if (method === 'workspace') return buyer.getBuyerWorkspace(scope);
      if (method === 'add') return catalogue.addCatalogueSelection(args[0], scope);
      if (method === 'quantity') return buyer.saveBuyerQuantity(args[0], args[1], scope);
      if (method === 'order') return buyer.submitBuyerOrder(args[0], scope, args[1], args[2] || '');
      throw new Error('Unknown fixture operation.');
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'fmcgmalaysia.github.io' && url.pathname.endsWith('/buyer-room/company-switch.js')) {
        return route.fulfill({ path: path.join(root, 'buyer-room/company-switch.js'), contentType: 'application/javascript' });
      }
      if (url.hostname !== 'companies.example.test') return route.abort();
      if (['/buyer-room', '/catalogue'].includes(url.pathname)) {
        return route.fulfill({ body: fixtureHost(url.pathname === '/catalogue'), contentType: 'text/html' });
      }
      const assets = {
        '/buyer-frame': 'buyer-room-20261124-company-switch.html',
        '/catalogue-frame': 'buyer-room/catalogue/wix/catalogue-company-switch.inline.html',
        '/master-shared/shipment-batches.js': 'master-shared/shipment-batches.js',
        '/master-shared/workroom-app-header.js': 'master-shared/workroom-app-header.js'
      };
      return assets[url.pathname] ? route.fulfill({ path: path.join(root, assets[url.pathname]),
        contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/html' }) : route.abort();
    });

    const origin = 'https://companies.example.test';
    const room = await context.newPage();
    const other = await context.newPage();
    const frame = page => page.frameLocator('iframe');
    await room.goto(origin + '/buyer-room');
    try { await frame(room).getByRole('dialog', { name: 'Choose a company' }).getByRole('button', { name: 'Company YYY' }).click(); }
    catch (error) {
      throw new Error(error.message + '\n' + JSON.stringify({ errors, host: await room.evaluate(() => window.qaError || ''),
        child: await frame(room).locator('body').evaluate(body => [...body.querySelectorAll('dialog')].map(item => item.textContent)) }));
    }
    await frame(room).locator('#myRows').getByText('Shared product', { exact: false }).waitFor();
    assert.equal(new URL(room.url()).searchParams.get('company'), first.buyerCompanyId);
    const changeCompany = frame(room).getByRole('button', { name: 'Switch Company' });
    await changeCompany.hover();
    await frame(room).locator('.buyer-company-switch-tip').waitFor({ state: 'visible' });
    assert.equal(await changeCompany.locator('svg').count(), 1);
    assert.equal((await changeCompany.textContent()).trim(), '');
    await changeCompany.click();
    await frame(room).getByRole('dialog', { name: 'Choose a company' }).getByRole('button', { name: 'Company ZZZ' }).click();
    await frame(room).locator('#companyName').filter({ hasText: 'Company ZZZ' }).waitFor();
    await frame(room).getByRole('button', { name: 'Return to your Catalogue' }).click();
    await frame(room).locator('.shell .toolbar').waitFor();
    const catalogueSwitch = frame(room).getByRole('button', { name: 'Switch Company' });
    await catalogueSwitch.waitFor();
    const desktopViewport = room.viewportSize();
    for (const viewport of [desktopViewport, { width: 390, height: 820 }]) {
      await room.setViewportSize(viewport);
      const layout = await frame(room).locator('.shell').evaluate(shell => {
        const toolbar = shell.querySelector('.toolbar');
        const icon = shell.querySelector('[aria-label="Switch Company"]');
        const toolbarBounds = toolbar.getBoundingClientRect();
        const iconBounds = icon.getBoundingClientRect();
        const workspaceBounds = shell.querySelector('.workspace').getBoundingClientRect();
        return {
          iconInToolbar: toolbar.contains(icon) && iconBounds.top >= toolbarBounds.top && iconBounds.bottom <= toolbarBounds.bottom,
          workspaceStartsAfterToolbar: Math.abs(workspaceBounds.top - toolbarBounds.bottom) < 2,
          workspaceHeight: workspaceBounds.height
        };
      });
      assert.ok(layout.iconInToolbar, `Catalogue switch must stay in its toolbar at ${viewport.width}px`);
      assert.ok(layout.workspaceStartsAfterToolbar);
      assert.ok(layout.workspaceHeight > 200);
    }
    await room.setViewportSize(desktopViewport);
    assert.equal(new URL(room.url()).searchParams.get('company'), second.buyerCompanyId);
    await catalogueSwitch.click();
    try { await frame(room).getByRole('dialog', { name: 'Choose a company' }).getByRole('button', { name: 'Company YYY' }).click(); }
    catch (error) {
      throw new Error(error.message + '\n' + JSON.stringify({ errors, host: await room.evaluate(() => window.qaError || ''),
        child: await frame(room).locator('body').evaluate(body => [...body.querySelectorAll('dialog')].map(item => ({ name: item.className, text: item.textContent, open: item.open, display: getComputedStyle(item).display, rect: item.getBoundingClientRect().toJSON() }))) }));
    }
    await frame(room).locator('#selectionCount').filter({ hasText: /^1$/ }).waitFor();
    assert.equal(new URL(room.url()).searchParams.get('company'), first.buyerCompanyId);

    await other.goto(origin + '/catalogue?company=' + second.buyerCompanyId);
    await frame(other).getByRole('button', { name: 'Select for Quote' }).click();
    await frame(other).locator('#selectionCount').filter({ hasText: /^1$/ }).waitFor();
    const [selection] = (await buyer.getBuyerWorkspace(second)).myList;
    quote(second.buyerCompanyId, selection.id, 36);
    await other.goto(origin + '/buyer-room?company=' + second.buyerCompanyId);
    await room.goto(origin + '/buyer-room?company=' + first.buyerCompanyId);
    async function prepare(page, qty) {
      await frame(page).locator('#prepareMobileOrder').click();
      const input = frame(page).locator('#orderRows input[data-qty]').first();
      await input.fill(String(qty));
      await input.press('Tab');
      await frame(page).locator('#submitOrder').click();
      try { await frame(page).locator('#confirmSubmit').waitFor(); }
      catch (error) { throw new Error(error.message + '\n' + JSON.stringify({ errors, host: await page.evaluate(() => window.qaError || '') })); }
    }
    await Promise.all([prepare(room, 2), prepare(other, 3)]);
    await Promise.all([frame(room).locator('#confirmSubmit').click(), frame(other).locator('#confirmSubmit').click()]);
    await Promise.all([frame(room).locator('#orderReceivedBg').waitFor(), frame(other).locator('#orderReceivedBg').waitFor()]);
    assert.deepEqual(wixData.rows('WixBuyerOrders').map(order => order.customerId).sort(), [first.buyerCompanyId, second.buyerCompanyId]);
    assert.equal(await room.evaluate(() => window.qaError || ''), '');
    assert.equal(await other.evaluate(() => window.qaError || ''), '');
    setMember(staff);
    await sales.reviewSalesRoomCustomerUser(second.buyerCompanyId, linked.userId, 'REVOKE', { reason: 'QA' });
    setMember(member);
    // The second tab is still open at the old address and sends the same order form message.
    await frame(other).locator('body').evaluate(body => body.ownerDocument.defaultView.parent.postMessage({
      type: 'BUYER_ROOM_SUBMIT_ORDER', lines: [{ itemId: 'old', quantityCtn: 1 }], requestId: '12345678-1234-4234-8234-123456789000'
    }, '*'));
    await frame(other).getByText('Access to this company has ended. Choose an available company.').waitFor();
    assert.equal(wixData.rows('WixBuyerOrders').length, 2);
    assert.equal(new URL(room.url()).searchParams.get('company'), first.buyerCompanyId);
    await room.goto(origin + '/buyer-room');
    await frame(room).locator('#companyName').filter({ hasText: /^Company YYY$/ }).waitFor();
    assert.equal(await frame(room).getByRole('button', { name: 'Switch Company' }).count(), 0);
  } finally { await browser.close(); }
});
