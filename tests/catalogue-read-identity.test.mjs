import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueReadIdentity, validCatalogueReader } from '../backend/catalogueReadIdentity.js';

function fixture(changes = {}) {
  const calls = [];
  const resolve = createCatalogueReadIdentity({
    getMember: async () => ({ _id: 'member1', loginEmail: 'qa@example.invalid' }),
    readStaff: async () => ({ authorized: true, memberId: 'member1', staffName: 'QA staff', customerScope: { pages: ['CATALOGUE'] } }),
    resolveBuyerCompany: async (member, email, scope) => {
      calls.push({ member, email, scope });
      return { customer: { customerId: scope.buyerCompanyId, title: 'QA ' + scope.buyerCompanyId }, user: { title: 'QA buyer' } };
    },
    getSelectionState: async id => ({ ok: true, customerId: id, companyName: 'Authorized customer' }), ...changes
  });
  return { calls, resolve };
}

test('both buyer companies use the same Wix member with company name from the authority', async () => {
  const { calls, resolve } = fixture();
  const [a, b] = await Promise.all(['A', 'B'].map(buyerCompanyId => resolve({ buyerCompanyId })));
  assert.equal(a.actorId, b.actorId);
  assert.equal(a.companyName, 'QA A');
  assert.equal(b.companyName, 'QA B');
  assert.equal(calls[0].email, 'qa@example.invalid');
  await assert.rejects(resolve({ buyerCompanyId: 'A', actorName: 'Someone' }));
  await assert.rejects(fixture({ getMember: async () => null }).resolve({ buyerCompanyId: 'A' }));
});

test('company-free preview requires a real authorized staff member and assisted access requires the target company', async () => {
  const { resolve } = fixture();
  const preview = await resolve({ staffPreview: true });
  assert.equal(preview.actorName, 'QA staff');
  assert.equal(preview.customerId, '');
  assert.equal(validCatalogueReader(preview), true);
  assert.equal(validCatalogueReader({ ...preview, actorType: 'CUSTOMER_USER' }), false);
  assert.equal((await resolve({ assistCustomerId: 'A' })).companyName, 'Authorized customer');
  for (const staff of [{ authorized: false }, { authorized: true, memberId: 'other' },
    { authorized: true, memberId: 'member1', customerScope: { pages: ['BUYER_ROOM'] } }]) {
    await assert.rejects(fixture({ readStaff: async () => staff }).resolve({ staffPreview: true }));
  }
  await assert.rejects(fixture({ getSelectionState: async () => ({ ok: true, customerId: 'B' }) }).resolve({ assistCustomerId: 'A' }));
  await assert.rejects(resolve({}));
});
