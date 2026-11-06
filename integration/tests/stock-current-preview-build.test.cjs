const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = path.join(__dirname, '../prototypes/stock-current-state');
test('generated demo includes the current exact tested model and halo code without browser Node dependencies', () => {
  const business = fs.readFileSync(path.join(source, 'preview/business.js'), 'utf8');
  const model = fs.readFileSync(path.join(source, 'borrowing-model.cjs'), 'utf8')
    .replace("const { stockKey } = require('./current-model.cjs');", require('../prototypes/stock-current-state/current-model.cjs').stockKey.toString())
    .replace('module.exports = ', 'return ');
  const person = fs.readFileSync(path.join(source, 'transfer-person.cjs'), 'utf8').replace('module.exports = ', 'return ');
  assert.equal(business, 'window.BorrowingModel = (() => {\n' + model + '\n})();\nwindow.TransferPerson = (() => {\n' + person + '\n})();\n');
  assert.equal(business.includes('require('), false);
  const window = {}; vm.runInNewContext(business, { window });
  assert.equal(typeof window.BorrowingModel.returnUnusedBorrow, 'function');
  assert.equal(typeof window.BorrowingModel.correctAccepted, 'function');
  assert.equal(window.TransferPerson.transferPerson({ taskId: 'A', relations: [] }).halo, false);
});
test('cancel/close bypass required quantity and reason fields; preview never posts business requests', () => {
  const html = fs.readFileSync(path.join(source, 'preview/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(source, 'preview/app.js'), 'utf8');
  assert.match(html, /type="button" id="cancel"/); assert.match(html, /type="button" id="close"/);
  assert.equal(/fetch\(|XMLHttpRequest|postMessage|localStorage/.test(app), false);
  assert.match(app, /window.BorrowingModel/);
});
