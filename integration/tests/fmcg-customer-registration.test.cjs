const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, timingSafeEqual, randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const policy = require('./load-master-module.cjs')('staffManagementPolicy.js');
const { patchOnce } = require('../prototypes/web-quotations/web-registration.cjs');
const { createIsolation, initialState } = require('../prototypes/web-quotations/isolation.cjs');
const { qaSites, qaRoute } = require('../prototypes/web-quotations/wix-qa-site-pair.cjs');

function routeToQa(name) {
  return qaRoute(name, qaSites.fmcg.siteId, qaSites.ltpos.siteId, qaSites.ltpos.base);
}

function evaluate(file, exports, globals, patch = source => source) {
  const source = readFileSync(join(__dirname, '../..', file), 'utf8')
    .replace(/\r\n/g, '\n').replace(/^import .+;$/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(patch(source) + '\n({' + exports.join(',') + '})', globals);
}

function wixStore(initial, writes) {
  const containers = new Map(Object.entries(initial).map(([name, rows]) => [name, new Map(rows.map(row => [row._id, structuredClone(row)]))]));
  const getRows = name => {
    if (!containers.has(name)) containers.set(name, new Map());
    return containers.get(name);
  };
  return {
    query(name) {
      const checks = [];
      let limit = 1000;
      const query = {
        eq(field, value) { checks.push(row => row[field] === value); return query; },
        limit(value) { limit = value; return query; },
        async find() {
          const rows = [...getRows(name).values()].filter(row => checks.every(check => check(row)));
          return { items: structuredClone(rows.slice(0, limit)), hasNext: () => rows.length > limit };
        }
      };
      return query;
    },
    async get(name, id) { return structuredClone(getRows(name).get(id)); },
    async insert(name, row) {
      const rows = getRows(name);
      const id = row._id ?? `${name}-${rows.size + 1}`;
      if (rows.has(id)) throw Error('Duplicate record');
      rows.set(id, structuredClone({ ...row, _id: id }));
      writes.push({ name, id, row });
      return structuredClone(rows.get(id));
    },
    async update(name, row) {
      assert(getRows(name).has(row._id));
      getRows(name).set(row._id, structuredClone({ ...row, _updatedDate: `revision-${writes.length}` }));
      writes.push({ name, id: row._id, row });
      return structuredClone(getRows(name).get(row._id));
    },
    async remove(name, id) { getRows(name).delete(id); },
    rows(name) { return [...getRows(name).values()]; }
  };
}

const salesperson = {
  _id: 'sales-one', title: 'STF-SALES1', staffEmail: 'sales@example.invalid', staffName: 'Sales One', role: 'STAFF',
  staffStatus: 'ACTIVE', description: 'master-member', staffAccess: { salesFunction: 'SALES', salesRoom: 'EDIT', customerAccess: {} }
};
const payload = {
  companyName: 'Fixture Trading', customerShortName: 'FIXTURE', country: 'Malaysia', natureOfBusiness: 'Retail',
  picTitle: 'Mr', picName: 'Fixture Buyer', picEmail: 'buyer@example.invalid', picMobile: '+60123456789',
  whatsapp: 'YES', preferredCurrency: 'USD', destinationPort: 'PORT KLANG'
};

function qdFixture() {
  const directory = 'integration/apps-script/verified-central-v16';
  const script = name => readFileSync(join(__dirname, '../..', directory, name), 'utf8');
  const files = new Map();
  const valueList = 'VALUE_IN_LIST';
  function sheet(id) {
    const values = new Map();
    return {
      values,
      getRange: cell => ({
        setValue(value) { values.set(cell, value); return this; }, setNumberFormat() {},
        getDisplayValue: () => values.get(cell),
        getDataValidation: () => ({
          getCriteriaType: () => valueList, getCriteriaValues: () => [['RFQ', 'VIEW QUOTE', 'FAILED']],
          getAllowInvalid: () => true
        })
      }),
      getSheetId: () => id, getMaxRows: () => 20, getMaxColumns: () => 10,
      getFrozenRows: () => 5, getFrozenColumns: () => 3, getConditionalFormatRules: () => [],
      getProtections: () => [], getDataRange: () => ({ getFormulas: () => [[]], getDataValidations: () => [[]] }),
      showSheet() {}, hideSheet() {}
    };
  }
  function book() {
    const metadata = new Map();
    const sheets = { 'WIX QUOTATION': sheet(1), 'DRAFT 草稿区': sheet(2), 'QD SETUP': sheet(3) };
    return {
      metadata, getSheetByName: name => sheets[name], setActiveSheet() {},
      addDeveloperMetadata: (key, value) => metadata.set(key, value),
      getDeveloperMetadata: () => Array.from(metadata, ([key, value]) => ({
        getKey: () => key, getValue: () => value, remove: () => metadata.delete(key)
      }))
    };
  }
  const templateBook = book();
  const template = { makeCopy(name, folder) {
    const id = `isolated-test-file-${files.size + 1}`;
    const worksheet = book();
    const file = { getId: () => id, getName: () => name, setDescription() {}, worksheet };
    assert.equal(folder, destination);
    files.set(id, file);
    return file;
  } };
  const destination = { getFilesByType() {
    const contents = [...files.values()];
    return { hasNext: () => contents.length > 0, next: () => contents.shift() };
  } };
  const properties = { WIX_ONBOARDING_SHARED_SECRET: 'fixture-qd', WIX_QD_FX_RATES_JSON: '{"USD":4.25}' };
  const router = vm.runInNewContext(script('Code.gs') + '\n' + script('WIX_QD_ROUTER.gs') + '\ndoPost', {
    DriveApp: { getFileById: id => files.get(id) || template, getFolderById: () => destination },
    SpreadsheetApp: {
      openById: id => files.get(id)?.worksheet || templateBook, flush() {},
      DataValidationCriteria: { VALUE_IN_LIST: valueList }, ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => properties[name] }) },
    ContentService: { createTextOutput: text => ({ setMimeType: () => text }), MimeType: { JSON: 'JSON' } },
    MimeType: { GOOGLE_SHEETS: 'SHEET' }
  });
  return { files, respond: input => router({ postData: { contents: JSON.stringify(input) } }) };
}

function registration({ actor = salesperson, additionalOwners = [], loseFirstQdResponse = false,
  failFirstAccessInsert = false, webRegistrationEnabled = false, interruptGrant = '', failReadySave = false } = {}) {
  const masterWrites = [], fmcgWrites = [], qdRequests = [];
  const qd = qdFixture();
  const employees = actor === salesperson ? [actor] : [actor, salesperson];
  const master = wixStore({ StaffMasterAccess: [...employees, ...additionalOwners] }, masterWrites);
  const fmcg = wixStore({}, fmcgWrites);
  if (failReadySave) {
    const update = fmcg.update;
    let rejected = false;
    fmcg.update = async (name, row) => {
      if (!rejected && name === 'WixCustomers' && row.webQuotationStatus === 'READY') {
        rejected = true;
        throw Error('Fixture final customer write unavailable');
      }
      return update(name, row);
    };
  }
  if (failFirstAccessInsert) {
    const insert = fmcg.insert;
    let rejected = false;
    fmcg.insert = async (name, row) => {
      if (name === 'WixCustomerUsers' && !rejected) {
        rejected = true;
        throw Error('Fixture access insert unavailable');
      }
      return insert(name, row);
    };
  }
  const writer = evaluate('integration/backend/staffManagementWrite.js', ['writeStaffManagement'], { wixData: master });
  const gateway = evaluate('integration/backend/staffAccessGateway.js', ['checkFmcgStaffAccess'], {
    wixData: master, getSecret: async () => 'fixture-access', ...writer, ...policy, Buffer, createHash, timingSafeEqual
  });
  let interrupted = false;
  const client = evaluate('backend/masterStaffAccessClient.js', [
    'getMasterStaffScope', 'getMasterSalesCreationAssignees', 'resolveMasterSalesCreationAssignee',
    'confirmMasterInitialSalesAccess', 'requireStaffCustomerAccess'
  ], {
    getSecret: async () => 'fixture-access',
    fetch: async (url, options) => {
      if (webRegistrationEnabled) assert.equal(url, routeToQa('staffAccess'));
      const isGrant = Boolean(JSON.parse(options.body).grantRevision);
      if (isGrant && !interrupted && interruptGrant === 'BEFORE') {
        interrupted = true;
        throw Error('LTPOS unavailable');
      }
      const result = await gateway.checkFmcgStaffAccess({ headers: options.headers, body: { text: async () => options.body } });
      if (isGrant && !interrupted && interruptGrant === 'AFTER') {
        interrupted = true;
        throw Error('Lost LTPOS acknowledgement');
      }
      return { ok: result.status === 200, status: result.status, json: async () => result.body };
    }
  }, webRegistrationEnabled ? source => patchOnce(source,
    "'https://fmcg999.wixstudio.com/master/_functions/staffAccess'",
    JSON.stringify(routeToQa('staffAccess'))) : undefined);
  const readStaff = async () => {
    const scope = await client.getMasterStaffScope(actor.staffEmail, true);
    return scope && { authorized: true, ...scope, canViewAllCustomers: scope.customerScope.allCustomers, loginEmail: actor.staffEmail };
  };
  function httpsRequest(_, options, respond) {
    assert.equal(options.method, 'post');
    const request = new EventEmitter();
    let input;
    request.write = body => { input = JSON.parse(body); };
    request.end = () => {
      qdRequests.push(input);
      assert.equal(master.rows('StaffMasterAccess').find(row => row.title === input.assignedStaffId).staffAccess.customerAccess[input.customerId], 'EDIT');
      const body = qd.respond(input);
      if (loseFirstQdResponse && qdRequests.length === 1) {
        request.emit('error', new Error('Lost QD acknowledgement'));
        return;
      }
      const result = new EventEmitter();
      result.statusCode = 200;
      result.setEncoding = () => {};
      respond(result);
      result.emit('data', body);
      result.emit('end');
    };
    return request;
  }
  const webCustomer = evaluate('backend/webQuotationCustomer.js', ['isWebQuotationCustomer', 'isWebQuotationReady'], {});
  const webRegistration = evaluate('backend/webQuotationRegistration.js', ['webQuotationRegistrationEnabled', 'reserveWebQuotationCustomer',
    'reserveWebQuotationPrimaryUser', 'activateWebQuotationCustomer'], {
    ...webCustomer, ...client, wixData: fmcg, createHash, getSecret: async () => webRegistrationEnabled ? 'ENABLED' : ''
  });
  const api = evaluate('sales-room/wix/onboarding.web.js', ['createSalesRoomCustomer', 'verifySalesRoomCustomerQd'], {
    ...client, wixData: fmcg, webMethod: (_, handler) => handler, Permissions: { SiteMember: 'member' },
    getCurrentStaffContext: readStaff, getSecret: async () => 'fixture-qd', httpsRequest,
    ...webCustomer, ...webRegistration
  });
  return { api, master, fmcg, fmcgWrites, masterWrites, qdRequests, files: qd.files, readStaff, client };
}

function registeredQuotationFixture(flow) {
  const state = initialState();
  state.collections.WixCustomers = flow.fmcg.rows('WixCustomers')
    .map(customer => ({ ...customer, rateToMyr: 4 }));
  state.collections.WixCustomerUsers = flow.fmcg.rows('WixCustomerUsers');
  const staff = flow.master.rows('StaffMasterAccess').find(record => record.title === salesperson.title);
  const actor = { ...staff, staffAccess: { ...staff.staffAccess, companyIds: ['NCT', 'GHR'],
    departmentAccess: { 'SALES MANAGEMENT': 'EDIT' } } };
  return { qa: createIsolation({ state }), actor };
}

for (const failure of ['BEFORE', 'AFTER', 'READY_WRITE']) {
  test(`web registration recovers the same customer after ${failure} and blocks premature access`, async () => {
    const flow = registration({ webRegistrationEnabled: true, interruptGrant: failure, failReadySave: failure === 'READY_WRITE' });
    const first = await flow.api.createSalesRoomCustomer(payload);
    assert.equal(first.ok, false);
    assert.equal(first.retryable, true);
    assert.equal(first.result.webQuotationStatus, 'PENDING');
    const { customerId } = first.result;
    assert.ok(customerId);
    const pending = registeredQuotationFixture(flow);
    await assert.rejects(pending.qa.buyerApi(customerId, payload.picEmail).addCatalogueSelection('product-1'), /not active|not ready/);
    await assert.rejects(pending.qa.buyerApi(customerId, payload.picEmail).getBuyerWorkspace(), /not active|not ready/);
    assert.throws(() => pending.qa.service.list(pending.actor, customerId), /access|not ready/);

    const next = await flow.api.createSalesRoomCustomer(payload);
    assert.equal(next.ok, true);
    assert.equal(next.result.customerId, customerId);
    assert.equal(next.result.webQuotationStatus, 'READY');
    assert.equal((await flow.api.createSalesRoomCustomer(payload)).result.customerId, customerId);
    assert.equal(flow.fmcg.rows('WixCustomers').length, 1);
    assert.equal(flow.fmcg.rows('WixCustomerUsers').length, 1);
    assert.equal(flow.qdRequests.length, 0);
    assert.equal(flow.masterWrites.filter(write => write.id === salesperson._id).length, 1);
    assert.equal(flow.fmcg.rows('WixCustomers')[0].company, undefined);
  });
}

test('one newly registered customer selects, receives a quote, downloads and routes orders without a QD', async () => {
  const flow = registration({ webRegistrationEnabled: true });
  const { result: { customerId } } = await flow.api.createSalesRoomCustomer(payload);
  const { qa, actor } = registeredQuotationFixture(flow);
  const buyer = qa.buyerApi(customerId, payload.picEmail);
  await assert.rejects(qa.buyerApi(customerId, 'other@example.invalid').getBuyerWorkspace(), /not linked/);
  const selection = await buyer.addCatalogueSelection('product-1');
  assert.equal(selection.queued, false);
  const [row] = qa.service.list(actor, customerId).rows;
  await qa.service.catchCost(actor, customerId);
  const revision = qa.service.list(actor, customerId).rows[0].revision;
  const draft = await qa.service.saveDraft(actor, customerId, row.id, { mode: 'EA', value: 1.5 }, revision, 'web-registered-draft');
  await qa.service.publish(actor, customerId, row.id, true, draft.revision, 'web-registered-publish');
  assert.equal((await buyer.addCatalogueSelection('product-1')).duplicate, true);
  assert.equal((await buyer.getBuyerWorkspace()).myList[0].vipPriceCtn, 18);
  const workbook = await qa.exportExcel(customerId);
  assert.equal(workbook.rowCount, 1);
  assert.equal(workbook.bytes.subarray(0, 2).toString(), 'PK');
  const requestId = randomUUID();
  const order = await buyer.submitBuyerOrder([{ itemId: row.id, quantityCtn: 2 }], '', requestId);
  assert.ok(order.orderId);
  assert.equal((await buyer.submitBuyerOrder([{ itemId: row.id, quantityCtn: 2 }], '', requestId)).orderId, order.orderId);
  assert.equal(qa.store.rows('WixBuyerOrders').length, 1);
  assert.equal(JSON.parse(qa.store.rows('WixBuyerOrders')[0].payload).destination, undefined);
  const [orderLine] = qa.store.rows('WixBuyerOrderLines');
  assert.equal(JSON.parse(orderLine.payload).lineAmount, 36);
  assert.equal(flow.fmcg.rows('WixCustomers')[0].qdFileId, '');
  assert.equal(flow.qdRequests.length, 0);

  const masterRows = new Map();
  const masterStore = {
    async read(collection, id) { return masterRows.get(collection + '/' + id) ?? null; },
    async insert(collection, record) {
      const key = collection + '/' + record._id;
      if (masterRows.has(key)) throw Error('Duplicate record');
      masterRows.set(key, structuredClone(record));
      return record;
    }
  };
  const originalFmcgId = "'5292b63a-30e5-4c0e-8762-a1b127bbc651'";
  const qaFmcgId = JSON.stringify(qaSites.fmcg.siteId);
  const { createNctIntake } = evaluate('integration/backend/nctIntake.js', ['createNctIntake'], { createHash },
    source => patchOnce(source, originalFmcgId, qaFmcgId));
  const receive = createNctIntake({ store: masterStore, captureCosts: async () => ({}) });
  const payloadBuilder = evaluate('backend/nctSubmissionPayload.js', ['buildNctSubmission'], {},
    source => patchOnce(source, originalFmcgId, qaFmcgId));
  const delivery = evaluate('backend/nctSubmissionDelivery.js', ['createNctSubmissionDelivery'], payloadBuilder);
  const intake = evaluate('backend/nctSalesIntake.js', ['submitNctSalesOrder'], {
    ...delivery, wixData: qa.store, createHash, URL, getSecret: async () => 'qa-only',
    fetch: async (url, options) => {
      assert.equal(url, routeToQa('nctIntake'));
      const response = await receive(JSON.parse(options.body));
      return { ok: true, json: async () => response };
    }
  }, source => patchOnce(source, "'https://fmcg999.wixstudio.com/master/_functions/nctIntake'",
    JSON.stringify(routeToQa('nctIntake'))));
  await qa.store.insert('WixFxRates', { currency: 'USD', rateToMyr: 4, active: true });
  const salesRoom = evaluate('sales-room/wix/onboarding.web.js', ['submitSalesRoomOrder'], {
    ...intake, wixData: qa.store, getCurrentStaffContext: flow.readStaff,
    requireStaffCustomerAccess: flow.client.requireStaffCustomerAccess,
    webMethod: (_, handler) => handler, Permissions: { SiteMember: 'member' }
  });
  await assert.rejects(salesRoom.submitSalesRoomOrder(order.orderId, ''), /receiving company/);
  const ghr = await salesRoom.submitSalesRoomOrder(order.orderId, 'GHR');
  assert.equal(ghr.destination, 'GHR');
  assert.equal((await salesRoom.submitSalesRoomOrder(order.orderId, 'GHR')).receiptId, ghr.receiptId);
  await assert.rejects(salesRoom.submitSalesRoomOrder(order.orderId, 'NCT'), /receipt identity conflict/);
  assert.equal((await buyer.getBuyerWorkspace()).myList[0].vipPriceCtn, 18);
  const nextOrder = await buyer.submitBuyerOrder([{ itemId: row.id, quantityCtn: 2 }], '', randomUUID());
  const nct = await salesRoom.submitSalesRoomOrder(nextOrder.orderId, 'NCT');
  assert.equal(nct.destination, 'NCT');
  assert.equal([...masterRows.keys()].filter(key => key.startsWith('NCTOrders/')).length, 1);
  assert.equal([...masterRows.keys()].filter(key => key.startsWith('NCTOrders1/')).length, 1);
  const quote = qa.service.list(actor, customerId).rows[0];
  assert.deepEqual(Object.keys(qa.state.quotes), [customerId + '|' + row.id]);
  assert.equal(quote.published.version, 1);
  assert.equal(quote.published.priceCtn, 18);
  const quoteRecords = qa.store.rows('WixBuyerListItems');
  assert.equal(quoteRecords.length, 1);
  assert.equal(JSON.parse(quoteRecords[0].payload).webQuoteVersion, 1);
  assert.equal(Object.keys(qa.state.delivered).length, 1);
  for (const record of [quote.published, JSON.parse(Object.values(qa.state.delivered)[0])]) {
    for (const field of ['company', 'companyId', 'destination']) assert.equal(Object.hasOwn(record, field), false);
  }
});

test('re-registering an already activated web customer does not reactivate a disabled user', async () => {
  const flow = registration({ webRegistrationEnabled: true });
  await flow.api.createSalesRoomCustomer(payload);
  const [user] = flow.fmcg.rows('WixCustomerUsers');
  await flow.fmcg.update('WixCustomerUsers', { ...user, status: 'DISABLED' });
  const writes = flow.fmcgWrites.length;
  await assert.rejects(flow.api.createSalesRoomCustomer(payload), /admin review/);
  assert.equal(flow.fmcgWrites.length, writes);
  assert.equal(flow.fmcg.rows('WixCustomerUsers')[0].status, 'DISABLED');
});

test('simultaneous web registrations for the same customer keep one reservation and initial grant', async () => {
  const flow = registration({ webRegistrationEnabled: true });
  const outcomes = await Promise.allSettled([
    flow.api.createSalesRoomCustomer(payload),
    flow.api.createSalesRoomCustomer(payload)
  ]);
  const saved = flow.fmcg.rows('WixCustomers');
  assert.equal(saved.length, 1);
  assert.equal(flow.fmcg.rows('WixCustomerUsers').length, 1);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, 'fulfilled');
    assert.equal(outcome.value.result.customerId, saved[0].customerId);
  }
  assert.equal((await flow.api.createSalesRoomCustomer(payload)).ok, true);
  assert.equal(flow.masterWrites.filter(write => write.id === salesperson._id).length, 1);
  assert.equal(flow.qdRequests.length, 0);
});

test('salesperson creates without a dropdown, recovers the same customer and QD after response loss, and verifies access', async () => {
  const flow = registration({ loseFirstQdResponse: true });
  const first = await flow.api.createSalesRoomCustomer(payload);
  assert.equal(first.ok, false);
  assert.equal(first.retryable, true);
  const second = await flow.api.createSalesRoomCustomer(payload);
  assert.equal(second.ok, true);
  assert.equal(second.result.customerId, first.result.customerId);
  assert.equal(second.result.assignedStaffId, salesperson.title);
  assert.equal(flow.fmcg.rows('WixCustomers').length, 1);
  assert.equal(flow.fmcg.rows('WixCustomerUsers').length, 1);
  assert.equal(flow.files.size, 1);
  assert.equal(flow.masterWrites.filter(write => write.id === salesperson._id).length, 1);
  assert.equal(flow.qdRequests[0].customerId, flow.qdRequests[1].customerId);
  const book = flow.files.get(second.result.qdFileId).worksheet;
  assert.equal(book.metadata.get('WIX_ASSIGNED_STAFF_ID'), salesperson.title);
  assert.equal(book.metadata.get('WIX_CUSTOMER_ID'), second.result.customerId);
  const header = book.getSheetByName('WIX QUOTATION').values;
  assert.equal(header.get('D1'), payload.companyName.toUpperCase());
  assert.equal(header.get('D3'), 'USD');
  assert.equal(header.get('D4'), 4.25);
  assert.equal((await flow.api.verifySalesRoomCustomerQd(second.result.customerId)).qdStatus, 'ACTIVATION_REQUIRED');
  assert.notEqual(flow.fmcg.rows('WixCustomerUsers')[0].status, 'ACTIVE');
  book.getSheetByName('QD SETUP').values.set('B9', 'STATUS');
  const verified = await flow.api.verifySalesRoomCustomerQd(second.result.customerId);
  assert.equal(verified.qdStatus, 'READY');
  assert.equal(verified.qdFileId, second.result.qdFileId);
  assert.equal(flow.fmcg.rows('WixCustomerUsers')[0].status, 'ACTIVE');
});

test('administrator may select the owner, but cannot create unassigned or overwrite a different owner', async () => {
  const actor = { ...salesperson, _id: 'admin', title: 'STF-ADMIN1', staffEmail: 'admin@example.invalid', role: 'SUPER ADMIN', staffAccess: {} };
  const otherOwner = { ...salesperson, _id: 'other', title: 'STF-SALES2', staffEmail: 'other@example.invalid', description:'other-member' };
  const flow = registration({ actor, additionalOwners:[otherOwner] });
  await assert.rejects(flow.api.createSalesRoomCustomer(payload), /Select an active salesperson/);
  assert.equal(flow.fmcgWrites.length, 0);
  const result = await flow.api.createSalesRoomCustomer({ ...payload, assignedStaffId: salesperson.title });
  assert.equal(result.result.assignedStaffId, salesperson.title);
  assert.equal(flow.qdRequests[0].assignedStaffId, salesperson.title);
  assert.equal(flow.fmcg.rows('CustomerAssignmentAudit')[0].changedByStaffId, actor.title);
  await assert.rejects(flow.api.createSalesRoomCustomer({ ...payload, assignedStaffId: otherOwner.title }), /belongs to another salesperson/);
  assert.equal(flow.qdRequests.length, 1);
  assert.deepEqual(flow.master.rows('StaffMasterAccess').find(row=>row.title===otherOwner.title).staffAccess.customerAccess, {});
});

test('failed customer login creation resumes the same Wix customer reservation', async () => {
  const flow = registration({ failFirstAccessInsert:true });
  await assert.rejects(flow.api.createSalesRoomCustomer(payload), /access record could not be created/);
  assert.equal(flow.qdRequests.length, 0);
  assert.equal(flow.fmcg.rows('WixCustomers').length, 1);
  const original = flow.fmcg.rows('WixCustomers')[0];
  const result = await flow.api.createSalesRoomCustomer(payload);
  assert.equal(result.result.customerId, original.customerId);
  assert.equal(result.result.wixCustomerRecordId, original._id);
  assert.equal(flow.fmcg.rows('WixCustomerUsers').length, 1);
  assert.equal(flow.files.size, 1);
});

test('the assignee field is hidden until LTPOS confirms permission to assign another employee', () => {
  const html = readFileSync(join(__dirname, '../../index.html'), 'utf8');
  assert.match(html, /id="assignedStaffField" hidden>/);
  assert.match(html, /id="assignedStaffSelect" name="assignedStaffId" disabled>/);

  const field = { hidden: true };
  const select = { disabled: true, required: false, value: '', addEventListener() {}, appendChild() {} };
  const elements = { assignedStaffField: field, assignedStaffSelect: select, assignedQdHint: {} };
  const start = html.indexOf('const assignedSelect=document');
  const end = html.indexOf('\n', html.indexOf("assignedSelect.addEventListener('change'", start));
  assert.ok(start >= 0 && end > start);
  const render = vm.runInNewContext(`let customerCreationRouting=null,assignableStaff=[];\n${html.slice(start, end)}\nrenderAssignableStaff`, {
    document: { getElementById: id => elements[id], createElement: () => ({}) },
    staff: { canViewAllCustomers: false }
  });
  const owner = { staffId: salesperson.title, staffName: salesperson.staffName };
  function checkVisibility(expected) {
    assert.equal(field.hidden, !expected);
    assert.equal(select.disabled, !expected);
    assert.equal(select.required, expected);
  }
  checkVisibility(false);
  render({ canCreate: true, mayAssignOthers: false, staff: [owner] });
  checkVisibility(false);
  render({ canCreate: true, mayAssignOthers: true, staff: [owner] });
  checkVisibility(true);
  render({ canCreate: true, mayAssignOthers: true, staff: [] });
  checkVisibility(false);
  render({ canCreate: false, mayAssignOthers: false, staff: [] });
  checkVisibility(false);
});
