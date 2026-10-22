'use strict';
// Mechanical local refresh only. Does not run old probes or renew deletion grants.
const fs = require('node:fs'), path = require('node:path');
const body = (file, exported) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n')
  .replace(/^'use strict';\n/, '').replace(new RegExp('module\\.exports = \\{ ' + exported + ' \\};\\s*$'), '');
const codec = 'const sdkFieldCodecFactory = (() => {\n' + body('sdk-field-codec.cjs', 'createSdkFieldCodec') + '\nreturn createSdkFieldCodec;\n})();\n';
const adapter = 'const stockAdapterFactory = (() => {\n' + body('sdk-conditional-store.cjs', 'createSdkConditionalStore')
  .replace("const { createSdkFieldCodec } = require('./sdk-field-codec.cjs');", 'const createSdkFieldCodec = sdkFieldCodecFactory;')
  .replace("const { hash } = require('./commit-proof.cjs');", "const hash = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);")
  + '\nreturn createSdkConditionalStore;\n})();';
for (const name of ['stockProtocolAdapterTest.web.js', 'stockProtocolCommitTest.web.js']) {
  const target = path.join(__dirname, name), source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const pattern = /(?:const sdkFieldCodecFactory = \(\(\) => \{[\s\S]*?return createSdkFieldCodec;\n\}\)\(\);\n)?const stockAdapterFactory = \(\(\) => \{[\s\S]*?return createSdkConditionalStore;\n\}\)\(\);/;
  if (!pattern.test(source)) throw Error('Exact diagnostic adapter boundary required');
  let out = source.replace(pattern, () => codec + adapter);
  if (!/import \{[^}]*createHash[^}]*\} from 'crypto';/.test(out)) out = out.replace("import { items } from '@wix/data';", "import { items } from '@wix/data';\nimport { createHash } from 'crypto';");
  if (process.argv.includes('--check')) {
    if (out !== source) throw Error('Diagnostic SDK source differs');
  } else fs.writeFileSync(target, out);
}
process.stdout.write('Local SDK diagnostic copies ' + (process.argv.includes('--check') ? 'verified' : 'refreshed') + '; no live probes or deployment\n');
