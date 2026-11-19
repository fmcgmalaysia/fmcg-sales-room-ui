const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const BEFORE = '70ebab2ce3046bd5cf7753eb520561c37eae485c570546cd50948ac4b1e77bde';
const BUILD = '20261119-staff-custom-domain-v1';
function patchStaffDomain(source) {
  source = source.replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), BEFORE, 'Staff source differs from captured production');
  const original = "  const parentOrigin = 'https://fmcg999.wixstudio.com';";
  assert.equal(source.split(original).length, 2);
  assert(source.includes('20261117-staff-saved-state-v1'));
  return source.replace(original, `  const trustedParents = new Set(['https://www.ltpos.ai', 'https://ltpos.ai', 'https://fmcg999.wixstudio.com']);
  let referrerOrigin = '';
  try { referrerOrigin = new URL(document.referrer).origin; } catch (_) {}
  const parentOrigin = trustedParents.has(referrerOrigin) ? referrerOrigin : '';`)
    .replace("if (window.parent === window) return Promise.reject(Error('Open this page from the MASTER website.'));",
      "if (window.parent === window || !parentOrigin) return Promise.reject(Error('Open this page from the MASTER website.'));")
    .replace('20261117-staff-saved-state-v1', BUILD);
}
module.exports = { patchStaffDomain, BEFORE, BUILD };
