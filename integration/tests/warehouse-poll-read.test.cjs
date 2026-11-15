const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const load = require('./load-master-module.cjs');

const { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } = load('purchaseProjection.js');
const { confirmedPurchaseState } = load('purchasePlan.js');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'backend', file), 'utf8').replace(/\r\n/g, '\n');
}

test('Warehouse packing reads skip only supplier pages, preserving defaults and company scope', async () => {
  const reads = [];
  const wixData = {
    query(collection) {
      assert.equal(collection, 'SharedSuppliers', 'the other test collections use a direct read stub');
      return {
        limit() {
          return {
            async find(options) {
              assert.equal(options.consistentRead, true);
              reads.push(collection);
              return {
                items: [{ title: 'S1', companyName: 'Supplier One' }],
                hasNext: () => true,
                async next() {
                  reads.push(collection);
                  return { items: [{ title: 'S2', companyName: 'Supplier Two' }], hasNext: () => false };
                },
              };
            },
          };
        },
      };
    },
  };
  const fulfilmentSource = source('customerFulfilmentService.js');
  const actualRead = vm.runInNewContext(
    fulfilmentSource.slice(fulfilmentSource.indexOf('const options='), fulfilmentSource.indexOf('const saveFulfilmentEvent='))
      .replace(/^export /gm, '') + '\n({ fulfilmentStore, readFulfilmentContext });',
    { wixData, PURCHASE_COLLECTIONS, projectPurchaseWorkspace, confirmedPurchaseState },
  );
  const originalAll = actualRead.fulfilmentStore.all;
  actualRead.fulfilmentStore.all = async collection => {
    if (collection === 'SharedSuppliers') return originalAll(collection);
    reads.push(collection);
    return [];
  };
  for (const company of ['NCT', 'GHR']) {
    const { orders, tasks, activity } = PURCHASE_COLLECTIONS[company];
    const staff = { staffName: 'Warehouse', packingDepartment: 'WAREHOUSE' };
    const baseline = await actualRead.readFulfilmentContext(company, staff);
    assert.deepEqual(reads.splice(0), [orders, tasks, activity, 'SharedSuppliers', 'SharedSuppliers']);
    assert.equal(baseline.suppliers.length, 2);
    const poll = await actualRead.readFulfilmentContext(company, staff, { includeSuppliers: false });
    assert.deepEqual(reads.splice(0), [orders, tasks, activity]);
    assert.deepEqual(
      JSON.parse(JSON.stringify({ ...poll, fetchedAt: null })),
      JSON.parse(JSON.stringify({ ...baseline, fetchedAt: null, suppliers: [] })),
    );
  }
});
