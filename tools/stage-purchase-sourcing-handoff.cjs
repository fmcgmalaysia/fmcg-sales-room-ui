const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

assert.ok(process.argv[2], 'Pass the unpacked verified Pages archive.');
const site = path.resolve(process.argv[2]);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => {
    assert.ok(entry.isFile() || entry.isDirectory(), 'Unsupported archive entry: ' + entry.name);
    return entry.isFile();
  })
  .map(entry => path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .sort();
const manifest = files.map(name => `${sha256(fs.readFileSync(path.join(site, name)))}  ${name}\n`);
assert.equal(files.length, 151);
assert.equal(sha256(manifest.join('')), 'b77915d8bf2554ab88b0936462cc0ce86ddaf1eb0e3417fe7b3bfb2488aa90d7',
  'Previously deployed Pages archive does not match run 45619162711.');

// These two workrooms also receive the previously verified common masthead.
execFileSync(process.execPath, [path.join(__dirname, 'stage-company-switch-icon.cjs'), site], { stdio: 'inherit' });

const added = ['purchase-live/app-20261125-sourcing-handoff.js', 'purchase-live/supplier-allocation-20261125-sourcing-handoff.js',
  'purchase-live/workflow-closeout-20261125.css', 'support-room/workroom-20261125-sourcing-handoff.js'];
for (const name of added) {
  const code = fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(site, name), code, { flag: 'wx' });
  console.log(name, sha256(code));
}

const entries = {
  'purchase-live/index-20261124-split-surplus.html': [
    ['src="app-20261124-receipt-compact-v1.js"', 'src="app-20261125-sourcing-handoff.js"'],
    ['src="supplier-allocation-20261125-discard-draft.js"', 'src="supplier-allocation-20261125-sourcing-handoff.js"'],
    ['</head>', '<link rel="stylesheet" href="workflow-closeout-20261125.css"></head>']
  ],
  'support-room/workroom.html': [['src="workroom.js?v=20261120-support-create-cipl-v1"', 'src="workroom-20261125-sourcing-handoff.js"']]
};
for (const [name, replacements] of Object.entries(entries)) {
  const destination = path.join(site, name);
  let code = fs.readFileSync(destination, 'utf8');
  for (const [previous, next] of replacements) {
    assert.equal(code.split(previous).length, 2, `${name}: ${previous}`);
    code = code.replace(previous, next);
  }
  fs.writeFileSync(destination, code);
  console.log(name, sha256(code));
}
