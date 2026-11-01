const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { projectPhysicalStock } = load('stockPhysicalProjection.js');
const position = (usable, cases = []) => ({ availablePhysical: usable, cases });
const issue = (quantity, resolution) => ({ quantity, resolution });

test('ordinary stock and open quarantine are both present for a physical count', () => {
  assert.equal(projectPhysicalStock(position(220)).onHand, 220);
  const row = projectPhysicalStock(position(195, [issue(5)]));
  assert.equal(row.onHand, 200); assert.equal(row.isolated, 5);
});
test('actual partial supplier returns reduce isolated physical stock', () => {
  const row = projectPhysicalStock(position(90, [issue(10, { returns: [{ quantity: 4 }] })]));
  assert.equal(row.onHand, 96); assert.equal(row.isolated, 6); assert.equal(row.returned, 4);
});
test('replacement receipt does not imply the original rejected goods left', () => {
  const row = projectPhysicalStock(position(100, [issue(10, { replacements: [{ quantity: 10 }] })]));
  assert.equal(row.onHand, 110); assert.equal(row.isolated, 10);
});
test('settlement alone cannot establish remaining goods location or a count total', () => {
  for (const outcome of ['LOSS', 'CREDIT', 'REFUND', 'REPLACED']) {
    const row = projectPhysicalStock(position(90, [issue(10, { financeApproval: { outcome } })]));
    assert.equal(row.onHand, null); assert.equal(row.isolated, null);
    assert.equal(row.usableOnHand, 90); assert.equal(row.issues.length, 1);
  }
});
test('fully returned settled goods do not remain in physical isolation', () => {
  const row = projectPhysicalStock(position(90, [issue(10, {
    returns: [{ quantity: 10 }], financeApproval: { outcome: 'CREDIT' }
  })]));
  assert.equal(row.onHand, 90); assert.equal(row.isolated, 0);
});
test('released goods are already counted by the existing usable-stock authority', () => {
  const row = projectPhysicalStock(position(100, [issue(10, { financeApproval: { outcome: 'RELEASED' } })]));
  assert.equal(row.onHand, 100); assert.equal(row.isolated, 0);
});
test('invalid stock and contradictory physical returns cannot create negative balances', () => {
  assert.throws(() => projectPhysicalStock(position(-1)), /verified/);
  assert.throws(() => projectPhysicalStock(position(90, [issue(10, { returns: [{ quantity: 11 }] })])), /exceed/);
  assert.throws(() => projectPhysicalStock(position(100, [issue(10, {
    returns: [{ quantity: 1 }], financeApproval: { outcome: 'RELEASED' }
  })])), /Released/);
});
