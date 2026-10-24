'use strict';
// Reuse the existing substantive end-to-end acceptance assertions, executing
// the ACTUAL newly compiled modules in an isolated local VM. No fixture/backend
// originals are edited, no native calls/coverage evidence are manufactured.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), test = require('node:test');
const { buildIsolatedCohort } = require('../prototypes/stock-current-state/build-isolated-cohort.cjs');
const { collectionTokens, COHORT } = require('../prototypes/stock-current-state/isolated-cohort.cjs');
const checkout = path.resolve(__dirname, '../..'), packet = buildIsolatedCohort(), cache = new Map(), generated = new Map();
const key = file => path.resolve(file).replace(/\\/g, '/').toLowerCase();
for (const row of packet.report.backend.filter(row => row.system === 'MASTER')) {
  const source = packet.output.get('MASTER/' + row.target);
  generated.set(key(path.join(checkout, row.source)), source);
  generated.set(key(path.join(checkout, 'integration/backend', row.target)), source);
}
function readSource(file, encoding) {
  let source = generated.get(key(file));
  if (source === undefined) source = collectionTokens(fs.readFileSync(file, 'utf8'), 'MASTER');
  if (path.basename(file) === 'stock-current-intake-root.test.cjs') {
    // The existing fixture explicitly seeds TEST-only ACTIVE/coverage. Retain
    // that synthetic policy and mark its TEST control for the new SDK guard.
    source = source.replace("{ mode: 'ACTIVE', schemaVersion: 1, writerBuild: 'TEST' }",
      "{ mode: 'ACTIVE', cohort: '" + COHORT + "', schemaVersion: 1, writerBuild: 'TEST' }");
  }
  if (path.basename(file) === 'stock-current-intake-loaded-composition.test.cjs') {
    source = source.replaceAll('/^Stock(Positions|Claims)\\//', '/^R2Stock(Positions|Claims)\\//');
  }
  return encoding ? source : Buffer.from(source);
}
const virtualFs = { ...fs, readFileSync: readSource };
function requireFrom(file) {
  const native = createRequire(file);
  function load(specifier) {
    if (specifier === 'node:fs' || specifier === 'fs') return virtualFs;
    if (specifier === 'node:module') return { ...require('node:module'), createRequire: requireFrom };
    if (specifier === 'node:test') return (name, ...args) => test('ISOLATED ' + name, ...args);
    if (!specifier.startsWith('.')) return native(specifier);
    const resolved = native.resolve(specifier);
    if (!resolved.endsWith('.cjs') || !resolved.startsWith(checkout + path.sep)) return native(specifier);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} }; cache.set(resolved, module);
    const source = readSource(resolved, 'utf8');
    vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + source + '\n})', { filename: resolved })
      (requireFrom(resolved), module, module.exports, resolved, path.dirname(resolved));
    return module.exports;
  }
  load.resolve = native.resolve; return load;
}
for (const file of ['stock-current-intake-loaded-composition.test.cjs', 'stock-current-borrow-gateway.test.cjs',
  'stock-current-borrowing.test.cjs', 'stock-current-borrow-options.test.cjs', 'stock-current-rcv-repayment.test.cjs',
  'stock-current-alloc-entry.test.cjs']) requireFrom(__filename)('./' + file);
