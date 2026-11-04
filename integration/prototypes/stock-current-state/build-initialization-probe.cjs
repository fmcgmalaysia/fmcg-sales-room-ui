'use strict';
// NEW standalone mutation test candidate, NOT installation/execution authorization.
const fs = require('node:fs'), path = require('node:path');
const body = fs.readFileSync(path.join(__dirname, 'native-initialization-probe.cjs'), 'utf8')
 .replace(/^'use strict';\r?\n/, '').replace(/module\.exports = \{ verifyNativeInitialization \};\s*$/, '');
if (/require\(|module\.exports/.test(body)) throw Error('Unexpected initialization probe dependency');
const source = "import { items } from '@wix/data';\nimport { webMethod, Permissions } from 'wix-web-module';\n" + body
 + "\n// Fresh exact grant REQUIRED before install/run. The input is an accident guard, NOT authorization.\n"
 + "export const verifyStockInitialization = webMethod(Permissions.Admin, async input => {\n"
 + " try { return await verifyNativeInitialization({items,input}); }\n"
 + " catch (_) { return {ok:false,mutationAttempted:false,error:'Explicit bounded isolated probe input required. No recovery performed.'}; }\n});\n";
new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
const target = path.join(__dirname, 'stockProtocolInitialization.web.js');
if (process.argv.includes('--check')) {
 if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source.replace(/\r\n/g, '\n')) throw Error('Initialization probe differs');
} else fs.writeFileSync(target, source);
process.stdout.write('Admin initialization probe ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; NOT installed, executed or authorized\n');
