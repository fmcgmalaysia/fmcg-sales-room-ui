const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateGrossProfitMargin: margin, calculateNetCartonCost: net } = require('./load-master-module.cjs')('grossProfitMargin.js');

test('margin uses MYR per transaction currency unit and changes with current Admin FX', () => {
  const line = { sellingPricePc: 10, eaPerCtn: 10, netCostCtn: 240 };
  assert.equal(margin({ ...line, rateToMyr: 3.2 }), .25);
  assert.equal(margin({ ...line, rateToMyr: 4 }), .4);
  assert.equal(margin({ ...line, netCostCtn: 75, rateToMyr: 1 }), .25);
});

test('missing/zero selling price, FX, EA and cost remain unavailable; explicit zero cost is valid', () => {
  const line = { sellingPricePc: 10, eaPerCtn: 10, netCostCtn: 75, rateToMyr: 1 };
  for (const patch of [{ sellingPricePc: 0 }, { rateToMyr: null }, { rateToMyr: 0 },
    { eaPerCtn: null }, { eaPerCtn: 1.5 }, { netCostCtn: null }, { netCostCtn: -1 }, { rateToMyr: Infinity }]) {
    assert.equal(margin({ ...line, ...patch }), null);
  }
  assert.equal(margin({ ...line, netCostCtn: 0 }), 1);
  assert.equal(margin({ ...line, netCostCtn: 120 }), -.2);
});

test('Disc3 is a MYR carton amount and sequential discounts keep full precision until presentation', () => {
  assert.equal(net({ lpCtn: 100, disc1: .05, disc2: .03, disc3: 5 }), 87.14999999999999);
  const cost = 1005 / 135;
  assert.equal(net({ lpCtn: cost, disc1: 0, disc2: 0, disc3: 0 }), cost);
  assert.equal(net({ lpCtn: 100, disc1: null, disc2: 0, disc3: 0 }), null);
  assert.equal(net({ lpCtn: 100, disc1: 0, disc2: 0, disc3: 101 }), null);
});
