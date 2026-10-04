const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'buyer-room', 'catalogue', 'wix', 'catalogue-page-v3.js'),
  'utf8'
);

test('Catalogue search always starts from all products and clears prior navigation filters', () => {
  const applySearch = source.slice(
    source.indexOf('const applySearch = async'),
    source.indexOf('// The search control', source.indexOf('const applySearch = async'))
  );
  assert.match(applySearch, /catalogueWorkspaceQueryVersion \+= 1/);
  assert.match(applySearch, /catalogueWorkspaceProducts = \[\.\.\.catalogueWorkspaceAllProducts\]/);
  assert.match(applySearch, /catalogueWorkspaceFilter = \{ query, main: '', subIds: \[\], principle: '' \}/);
  assert.match(applySearch, /sendCatalogueWorkspaceData\(\)/);
});

test('A stale category response cannot overwrite a newer search', () => {
  const filteredQuery = source.slice(
    source.indexOf('async function showCatalogueWorkspaceQuery'),
    source.indexOf('function showAllCatalogueWorkspaceProducts')
  );
  assert.match(filteredQuery, /const queryVersion = \+\+catalogueWorkspaceQueryVersion/);
  assert.match(filteredQuery, /if \(queryVersion !== catalogueWorkspaceQueryVersion\) return/);
});
