'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { build, buildR2CapacityAcceptance, prefix } = require('../prototypes/stock-current-state/build-r2-capacity-acceptance.cjs');
const source = fs.readFileSync(path.join(__dirname, '../prototypes/stock-current-state/stockProtocol300Commit.web.js'), 'utf8').replace(/\r\n/g, '\n');
test('fresh capacity identity keeps exact executor, budgets, scope and closed deletion gate', () => {
  const result = build();
  assert.equal(result.source.replace(prefix, 'SPT-COMMIT300-20261023-b19d:')
    .replace('export const verifyR2CapacityAcceptance=', 'export const verifyStock300Commit='), source);
  assert.equal(result.source.includes('SPT-COMMIT300-20261023-b19d:'), false);
  assert.equal(result.lockReleaseEnabled, false);
  assert.equal(result.businessActivationAllowed, false);
  assert.match(result.source, /const NATIVE_TEST_LOCK_RELEASE_GRANTED=false;/);
});
test('an armed or ambiguous source cannot be repackaged as a closed fresh test', () => {
  assert.throws(() => buildR2CapacityAcceptance(source.replace('NATIVE_TEST_LOCK_RELEASE_GRANTED=false', 'NATIVE_TEST_LOCK_RELEASE_GRANTED=true')));
  assert.throws(() => buildR2CapacityAcceptance(source + 'SPT-COMMIT300-20261023-b19d:'));
});
