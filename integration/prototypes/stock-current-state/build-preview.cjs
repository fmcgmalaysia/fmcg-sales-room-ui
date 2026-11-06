'use strict';
// Mechanical browser bundle of the exact tested pure model; no alternate arithmetic.
const fs = require('node:fs'), path = require('node:path');
const { stockKey } = require('./current-model.cjs');
const out = path.join(__dirname, 'preview');
function wrap(file, name, replaceImport = false) {
  let source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  if (replaceImport) source = source.replace("const { stockKey } = require('./current-model.cjs');", stockKey.toString());
  source = source.replace('module.exports = ', 'return ');
  if (source.includes('require(')) throw Error('Unexpected browser dependency');
  return 'window.' + name + ' = (() => {\n' + source + '\n})();\n';
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'business.js'), wrap('borrowing-model.cjs', 'BorrowingModel', true) + wrap('transfer-person.cjs', 'TransferPerson'));
process.stdout.write('Built preview/business.js from tested model and current person shapes\n');
