import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCatalogueReadIdentity, validCatalogueReader } from '../backend/catalogueReadIdentity.js';
import { isWebQuotationReady } from '../backend/webQuotationCustomer.js';

function fixture(changes = {}) {
  const calls = [];
  const resolve = createCatalogueReadIdentity({
    getMember: async () => ({ _id: 'member1', loginEmail: 'qa@example.invalid' }),
    readStaff: async () => ({ authorized: true, memberId: 'member1', staffName: 'QA staff', customerScope: { pages: ['CATALOGUE'] } }),
    resolveBuyerCompany: async (member, email, scope) => {
      calls.push({ member, email, scope });
      return { customer: { customerId: scope.buyerCompanyId, title: 'QA ' + scope.buyerCompanyId }, user: { title: 'QA buyer' } };
    },
    readStaffCustomer: async (_staff, id) => ({ customerId: id, title: 'Authorized customer' }), ...changes
  });
  return { calls, resolve };
}

test('both buyer companies use the same Wix member with company name from the authority', async () => {
  let memberReads = 0;
  const { calls, resolve } = fixture({
    getMember: async () => { memberReads++; return { _id: 'member1', loginEmail: 'qa@example.invalid' }; },
    readStaff: async () => assert.fail('Buyer reads do not use the staff resolver.')
  });
  const [a, b] = await Promise.all(['A', 'B'].map(buyerCompanyId => resolve({ buyerCompanyId })));
  assert.equal(memberReads, 2);
  assert.equal(a.actorId, b.actorId);
  assert.equal(a.companyName, 'QA A');
  assert.equal(b.companyName, 'QA B');
  assert.equal(calls[0].email, 'qa@example.invalid');
  await assert.rejects(resolve({ buyerCompanyId: 'A', actorName: 'Someone' }));
  await assert.rejects(fixture({ getMember: async () => null }).resolve({ buyerCompanyId: 'A' }));
});

test('company-free preview requires a real authorized staff member and assisted access requires the target company', async () => {
  const { resolve } = fixture({
    getMember: async () => assert.fail('Staff reads must only use the verified member from the staff resolver.')
  });
  const preview = await resolve({ staffPreview: true });
  assert.equal(preview.actorId, 'member1');
  assert.equal(preview.actorName, 'QA staff');
  assert.equal(preview.customerId, '');
  assert.equal(validCatalogueReader(preview), true);
  assert.equal(validCatalogueReader({ ...preview, actorType: 'CUSTOMER_USER' }), false);
  assert.equal((await resolve({ assistCustomerId: 'A' })).companyName, 'Authorized customer');
  for (const staff of [null, { authorized: false, memberId: 'member1' }, { authorized: true }, { authorized: true, memberId: ' ' },
    { authorized: true, memberId: 'member1', customerScope: { pages: ['BUYER_ROOM'] } }]) {
    await assert.rejects(fixture({ readStaff: async () => staff }).resolve({ staffPreview: true }));
  }
  await assert.rejects(fixture({ readStaffCustomer: async () => ({ customerId: 'B' }) }).resolve({ assistCustomerId: 'A' }));
  await assert.rejects(resolve({}));
  await assert.rejects(resolve({ assistCustomerId: 'A', memberId: 'forged' }));
});

test('assisted reads recheck staff and the target company without loading selections', async () => {
  const source = readFileSync(new URL('../backend/catalogueStaffCustomerAccess.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const queryCalls = [];
  const ready = { customerId: 'A', title: 'Company A', quotationMode: 'WEB', webQuotationStatus: 'READY',
    lifecycleStatus: 'ACTIVE', accessStatus: 'ACTIVE' };
  let customers = [ready];
  let allowed = true;
  let staffReads = 0;
  let memberReads = 0;
  const wixData = { query(collection) {
    assert.equal(collection, 'WixCustomers');
    return { eq(key, value) {
      assert.equal(key, 'customerId');
      queryCalls.push(value);
      return this;
    }, limit(size) {
      assert.equal(size, 2);
      return this;
    }, find: async () => ({ items: customers }) };
  } };
  const readStaffCustomer = new Function('wixData', 'requireStaffCustomerAccess', 'isWebQuotationReady',
    source + '\nreturn readCatalogueCustomerForStaff;')(wixData, (_staff, action, id) => {
    assert.equal(action, 'CATALOGUE_VIEW');
    if (!allowed || id !== 'A') throw Error('Staff access denied.');
  }, isWebQuotationReady);
  const { resolve } = fixture({
    getMember: async () => { memberReads++; return { _id: 'member1' }; },
    readStaff: async () => { staffReads++; return { authorized: true, memberId: 'member1' }; },
    readStaffCustomer
  });

  assert.equal((await resolve({ assistCustomerId: 'A' })).companyName, 'Company A');
  assert.deepEqual([memberReads, staffReads, queryCalls], [0, 1, ['A']]);
  allowed = false;
  await assert.rejects(resolve({ assistCustomerId: 'A' }), /Staff access denied/);
  allowed = true;
  await assert.rejects(resolve({ assistCustomerId: 'B' }), /Staff access denied/);
  customers = [{ ...ready, lifecycleStatus: 'ARCHIVED' }];
  await assert.rejects(resolve({ assistCustomerId: 'A' }), /suspended/);
  customers = [{ ...ready, webQuotationStatus: 'PENDING' }];
  await assert.rejects(resolve({ assistCustomerId: 'A' }), /not ready/);
  customers = [ready, ready];
  await assert.rejects(resolve({ assistCustomerId: 'A' }), /not found/);
});
