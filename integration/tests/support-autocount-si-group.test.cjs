const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../support-room/workroom.js'), 'utf8');
const start = source.indexOf('  function autoCountRows(');
const end = source.indexOf('  function openAutoCount(', start);
const copy = vm.runInNewContext(source.slice(start, end) + '\nautoCountRows');
const cookie = '0955123456789';
const cola = '9551234567891';
const line = (quantity, overrides = {}) => ({
  orderQty: quantity, loadedQty: quantity, invoiceReadyQty: quantity,
  barcode: cookie, packing: '24 x 1', priceCtn: 12.5, currency: 'USD', ...overrides
});
const cells = result => result.text.split('\r\n').map(row => row.split('\t'));
const summary = result => cells(result).map(row => [row[0], row[10], row[12]]);

test('SI combines identical cartons in first appearance order without mutating the tasks', () => {
  const records = [line(100), line(20, {barcode: cola, priceCtn: 5}), line(50)];
  const original = structuredClone(records);
  const result = copy(records, 'SI');
  assert.equal(result.currency, 'USD');
  assert.deepEqual(summary(result), [[cookie, '150', '12.50'], [cola, '20', '5.00']]);
  assert.equal(cells(result).reduce((total, row) => total + Number(row[10]) * Number(row[12]), 0), 1975);
  assert.deepEqual(records, original);
});

test('SI preserves different carton prices and packaging as separate lines', () => {
  assert.deepEqual(summary(copy([line(100), line(50, {priceCtn: 13}), line(20, {packing: '12 x 1'})], 'SI')),
    [[cookie, '100', '12.50'], [cookie, '50', '13.00'], [cookie, '20', '12.50']]);
});

test('unresolved quantities and mixed currencies still block SI copying', () => {
  assert.throws(() => copy([line(100), line(50, {loadedQty: 20, invoiceReadyQty: 20})], 'SI'), /remaining Desk/);
  assert.throws(() => copy([line(100), line(50, {currency: 'MYR'})], 'SI'), /currency/);
});

test('DO keeps two separate 11-column rows with no price', () => {
  const expected = [100, 50].map(quantity => [cookie, ...Array(9).fill(''), String(quantity)].join('\t')).join('\r\n');
  assert.equal(copy([line(100), line(50)], 'DO').text, expected);
});
