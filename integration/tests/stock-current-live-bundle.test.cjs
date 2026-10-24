const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../prototypes/stock-current-state');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const compact = text => text.replace(/\s/g, '');
const body = (name, exports) => compact(read(name).replace(/^'use strict';\r?\n/, '')
  .replace(new RegExp('module\\.exports = \\{ ' + exports + ' \\};\\s*$'), ''));

test('live diagnostic embeds the actual candidate adapter/query, not a divergent implementation', () => {
  const source = read('stockProtocolAdapterTest.web.js');
  const adapter = source.split('const stockAdapterFactory = (() => {')[1].split('return createSdkConditionalStore;')[0];
  const query = source.split('const stockQueryFactory = (() => {')[1].split('return createCurrentQuery;')[0];
  assert.equal(compact(adapter), body('sdk-conditional-store.cjs', 'createSdkConditionalStore')
    .replace(compact("const { createSdkFieldCodec } = require('./sdk-field-codec.cjs');"), compact('const createSdkFieldCodec = sdkFieldCodecFactory;'))
    .replace(compact("const { hash } = require('./commit-proof.cjs');"), compact("const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);")));
  const codec = source.split('const sdkFieldCodecFactory = (() => {')[1].split('return createSdkFieldCodec;')[0];
  assert.equal(compact(codec), body('sdk-field-codec.cjs', 'createSdkFieldCodec'));
  assert.equal(compact(query), body('current-query.cjs', 'createCurrentQuery, readCurrentDetailPage'));
  assert.ok(compact(source).includes(compact(read('adapter-live-harness.txt'))));
  assert.ok(compact(source).includes(compact(read('adapter-readonly-harness.txt'))));
});
test('only Admin entries exist; read-only continuation never invokes mutation or protocol activation', () => {
  const source = read('stockProtocolAdapterTest.web.js');
  assert.equal((source.match(/webMethod\(Permissions\.Admin/g) || []).length, 2);
  assert.ok(!/Permissions\.(Anyone|SiteMember)|from ['"]backend\//.test(source));
  const readonly = read('adapter-readonly-harness.txt');
  assert.ok(!/await (?:items|store)\.(?:insert|patch|remove|compareAndSet|compareAndRemove)/.test(readonly));
  assert.ok(!/\.commit\(|\.initialize\(/.test(source));
});
