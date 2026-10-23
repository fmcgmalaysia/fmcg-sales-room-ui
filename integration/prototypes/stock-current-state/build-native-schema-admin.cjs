'use strict';
const fs = require('node:fs'), path = require('node:path');
const embed = (file, replacements = []) => {
 let source = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/^'use strict';\r?\n/, '');
 for (const text of replacements) source = source.replace(text, '');
 source = source.replace(/module\.exports = (\{[^;]+\});\s*$/, 'return $1;');
 if (source.includes('require(') || source.includes('module.exports')) throw Error('Unexpected schema admin dependency');
 return source;
};
const contract = require('./native-setup-review.cjs').currentNativeSetupContract();
const output = [
 "// Private schema administration. No item access, permissions mutation, delete, publish or ACTIVE.",
 "import { collections, indexes } from '@wix/data';",
 "import { webMethod, Permissions } from 'wix-web-module';",
 'const currentNativeSetupContract = () => (' + JSON.stringify(contract) + ');',
 'const { createNativeSchemaInstaller } = (() => {\n' + embed('native-schema-installer.cjs', ["const { currentNativeSetupContract } = require('./native-setup-review.cjs');"]) + '\n})();',
 '// Lazy construction keeps unsupported SDK metadata methods observable inside the Admin call.',
 'export const inspectStockSchema = webMethod(Permissions.Admin, async input => {',
 " let stage = 'INITIALIZE'; console.info('STOCK_SCHEMA_READ', stage);",
 ' try {',
 "  const setup = createNativeSchemaInstaller({ collections, indexes, onReadStage: value => { stage = value; console.info('STOCK_SCHEMA_READ', stage); } });",
 '  return { ok: true, ...await setup.inspect(input) };',
 ' } catch (error) {',
 "  return { ok: false, stage, code: String(error?.code || error?.name || 'UNKNOWN').slice(0, 100), message: String(error?.message || 'Native schema read failed').slice(0, 500), activationAllowed: false };",
 ' }',
 '});',
 '// Mutations still throw on unknown outcomes: no success-shaped catch or retry.',
 'export const addStockSchemaField = webMethod(Permissions.Admin, async input => createNativeSchemaInstaller({ collections, indexes }).addField(input));',
 'export const addStockSchemaIndex = webMethod(Permissions.Admin, async input => createNativeSchemaInstaller({ collections, indexes }).addIndex(input));', ''
].join('\n');
const destination = path.join(__dirname, 'stockSchemaAdmin.web.js');
if (process.argv.includes('--check')) {
 if (fs.readFileSync(destination, 'utf8').replace(/\r\n/g, '\n') !== output) throw Error('Schema admin copy differs');
} else fs.writeFileSync(destination, output);
process.stdout.write('Schema Admin source ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; no native execution\n');
