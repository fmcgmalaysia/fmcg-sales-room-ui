const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

assert.ok(process.argv[2], 'Pass the extracted Pages archive.');
const site = path.resolve(process.argv[2]);
const sha256 = content => createHash('sha256').update(content).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
  .map(entry => path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')).sort();
const manifest = files.map(name => `${sha256(fs.readFileSync(path.join(site, name)))}  ${name}\n`).join('');
assert.equal(files.length, 161);
assert.equal(sha256(manifest), '7e26b10fbe3f8b70fa50da32dfcaa9fa8a83821ce6c7bf43a89d0c4993271cb2',
  'Use the current 45658212868 Pages archive.');

const entry = path.join(site, 'purchase-live/index-20261124-split-surplus.html');
const release = '20261126-purchase-closed-remainder-v1';
const scripts = [
  ['task-grid.js', 'task-grid.js?v=20261120-shortfall-dispatch-confirmation-v1'],
  ['supplier-allocation-20261125-sourcing-handoff.js', 'supplier-allocation-20261125-sourcing-handoff.js'],
];
let html = fs.readFileSync(entry, 'utf8');
for (const [name, current] of scripts) {
  const tag = `src="${current}"`;
  assert.equal(html.split(tag).length, 2, `Expected one existing reference to ${current}.`);
  html = html.replace(tag, `src="${name}?v=${release}"`);
}
for (const [name] of scripts) {
  const source = fs.readFileSync(path.join(__dirname, '../purchase-live', name), 'utf8').replace(/\r\n/g, '\n');
  fs.writeFileSync(path.join(site, 'purchase-live', name), source);
}
fs.writeFileSync(entry, html);
console.log('Updated two Purchase scripts and their cache versions. Preserved the other 158 assets.');
