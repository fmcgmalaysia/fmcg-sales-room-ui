const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'sales-room', 'google-apps-script', 'WixQdFactory.gs'),
  'utf8'
);

test('new customer QDs carry the current template release marker', () => {
  assert.match(source, /TEMPLATE_VERSION:\s*'QD-2026\.10\.03-V3'/);
});

test('new customer QDs reject drifted quotation-status rules', () => {
  const verifier = source.slice(
    source.indexOf('function WIX_quoteStatusRuleError_'),
    source.indexOf('function WIX_formulaCount_')
  );
  assert.match(verifier, /DataValidationCriteria\.VALUE_IN_LIST/);
  assert.match(verifier, /\['RFQ', 'VIEW QUOTE', 'FAILED'\]/);
  assert.match(verifier, /getAllowInvalid\(\)/);
});
