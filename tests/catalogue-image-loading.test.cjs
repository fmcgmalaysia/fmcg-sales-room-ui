const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workspace = fs.readFileSync(path.join(__dirname, '../buyer-room/catalogue/wix/catalogue-workspace-v1.html'), 'utf8');
const imageFunctions = workspace.slice(workspace.indexOf('    function thumbnailUrl('), workspace.indexOf('    function render('));
const methods = vm.runInNewContext(imageFunctions + '\n({ thumbnailUrl, imageMarkup })', {
  URL, esc: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
});
const source = 'https://static.wixstatic.com/media/catalogue-fixture.png';

test('list images request a bounded CDN thumbnail while product detail uses the full source', () => {
  assert.equal(methods.thumbnailUrl(source), source + '/v1/fit/w_168,h_168,q_85,enc_auto/product.png');
  const small = methods.imageMarkup({ image: source });
  assert.match(small, /\/v1\/fit\/w_168,h_168/);
  assert.match(small, /loading="lazy"/);
  assert.match(small, /decoding="async"/);
  assert.match(small, /width="168" height="168"/);
  const large = methods.imageMarkup({ image: source }, true);
  assert.match(large, new RegExp('src="' + source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'));
  assert.doesNotMatch(large, /\/v1\/fit\//);
  assert.match(large, /loading="lazy"/);
});

test('existing transformed and external image addresses retain their source and missing images retain their label', () => {
  for (const image of [
    source + '/v1/fit/w_640,h_640/sample.png',
    'https://images.example.test/product.png',
    'invalid image'
  ]) {
    assert.equal(methods.thumbnailUrl(image), image);
  }
  assert.match(methods.imageMarkup({}), /NO IMAGE/);
  assert.match(methods.imageMarkup({}, true), /IMAGE PENDING/);
});
