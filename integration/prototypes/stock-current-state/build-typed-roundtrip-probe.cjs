'use strict';
// Mechanical standalone Admin diagnostic only; no install/run/permission grant.
const fs = require('node:fs'), path = require('node:path');
const body = (file, names) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')
 .replace(/^'use strict';\n/, '').replace(new RegExp('module\\.exports = \\{ ' + names + ' \\};\\s*$'), '');
const codec = 'const createSdkFieldCodec = (() => {\n' + body('sdk-field-codec.cjs', 'createSdkFieldCodec') + '\nreturn createSdkFieldCodec;\n})();\n';
const adapter = 'const createSdkConditionalStore = (() => {\n' + body('sdk-conditional-store.cjs', 'createSdkConditionalStore')
 .replace("const { createSdkFieldCodec } = require('./sdk-field-codec.cjs');", '')
 .replace("const { hash } = require('./commit-proof.cjs');", "const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);")
 + '\nreturn createSdkConditionalStore;\n})();\n';
const probe = body('native-typed-roundtrip-probe.cjs', 'verifyNativeTypedRoundtrip');
const source = "import { items } from '@wix/data';\nimport { webMethod, Permissions } from 'wix-web-module';\nimport { createHash } from 'crypto';\n"
 + codec + adapter + probe
 + "\n// Fresh exact mutation grant REQUIRED. Confirmation input is not user authorization.\n"
 + "export const verifyStockTypedRoundtrip = webMethod(Permissions.Admin, async input => {\n"
 + " try { return await verifyNativeTypedRoundtrip({items,createSdkConditionalStore,input}); }\n"
 + " catch (_) { return {ok:false,mutationAttempted:false,error:'Explicit bounded isolated typed probe input required. No recovery performed.'}; }\n});\n";
if (/require\(|module\.exports/.test(source)) throw Error('Unexpected typed probe dependency');
new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
const target = path.join(__dirname, 'stockProtocolTypedRoundtrip.web.js');
if (process.argv.includes('--check')) {
 if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Typed probe differs from exact shared codec/store');
} else fs.writeFileSync(target, source);
process.stdout.write('Admin typed probe ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; NOT installed, executed or authorized\n');
