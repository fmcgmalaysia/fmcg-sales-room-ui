// Package the same backend modules exercised by the local regression suite for Wix Studio.
const fs = require('node:fs');
const path = require('node:path');
const modules = ['catalogueReadIdentity','catalogueBudgetStore','catalogueReadBudget','catalogueCoverage',
  'catalogueRiskAlert','cataloguePageIndex','catalogueSelectionScope','catalogueImageAssets',
  'buyerProductImage','protectedCatalogueRead','catalogueProtectionRuntime'];
const resolved = new Set(), imports = new Set();
const parts = modules.map(name => {
  const file = fs.readFileSync(path.join(__dirname, '../backend', name + '.js'), 'utf8').replace(/\r\n/g, '\n');
  const body = file.replace(/^import (.+) from '([^']+)';\n/gm, (line, names, from) => {
    if (from.startsWith('./')) {
      if (!resolved.has(path.basename(from, '.js'))) throw Error('Missing dependency: ' + from);
    } else if (from !== 'crypto') imports.add(line.trimEnd());
    else if (!['{ createHash }', '{ randomUUID }'].includes(names)) throw Error('Unknown crypto dependency');
    return '';
  });
  if (/^import /m.test(body)) throw Error('Unrecognized import in ' + name);
  resolved.add(name);
  if (name === 'catalogueProtectionRuntime') return body;
  const names = Array.from(body.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm), hit => hit[1]).join(', ');
  if (!names) throw Error('No exports in ' + name);
  return 'const { ' + names + ' } = (() => {\n' + body.replace(/^export /gm, '') + '\nreturn { ' + names + ' };\n})();';
});
if (!process.argv[2]) throw Error('Supply the destination file.');
fs.writeFileSync(process.argv[2], ["import { createHash, randomUUID } from 'crypto';", ...imports, ...parts].join('\n') + '\n');
