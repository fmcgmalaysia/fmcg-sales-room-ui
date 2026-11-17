const assert = require('node:assert/strict');
const { test } = require('node:test');
const { qaSites, qaRoute } = require('./wix-qa-site-pair.cjs');

test('QA staff access, order intake and quote sync are pinned to their respective independent Wix sites', () => {
  assert.equal(qaRoute('staffAccess', qaSites.fmcg.siteId, qaSites.ltpos.siteId, qaSites.ltpos.base),
    qaSites.ltpos.base + '/_functions/staffAccess?rc=test-site');
  assert.equal(qaRoute('qaQuotePublish', qaSites.ltpos.siteId, qaSites.fmcg.siteId, qaSites.fmcg.base),
    qaSites.fmcg.base + '/_functions/qaQuotePublish?rc=test-site');
  assert.throws(() => qaRoute('nctIntake', '5292b63a-30e5-4c0e-8762-a1b127bbc651',
    qaSites.ltpos.siteId, qaSites.ltpos.base), /Unverified/);
  assert.throws(() => qaRoute('nctIntake', qaSites.fmcg.siteId,
    'f80870fd-a3d8-47c0-9917-1bfd9c16ea44', 'https://fmcg999.wixstudio.com/master'), /Unverified/);
  assert.throws(() => qaRoute('qaQuoteSelection', qaSites.ltpos.siteId,
    qaSites.fmcg.siteId, 'https://www.fmcgmalaysia.com'), /Unverified/);
});
