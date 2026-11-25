const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

assert.ok(process.argv[2], 'Pass a copy of the verified Pages archive');
const site = path.resolve(process.argv[2]);
const sha256 = content => createHash('sha256').update(content).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => {
    assert.ok(entry.isFile() || entry.isDirectory(), 'Unexpected archive entry: ' + entry.name);
    return entry.isFile();
  })
  .map(entry => path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .sort();
const manifest = files.map(name => `${sha256(fs.readFileSync(path.join(site, name)))}  ${name}\n`).join('');
assert.equal(files.length, 158);
assert.equal(sha256(manifest), '9ba29cf5a7a3d5dc416202f84fc1126504123dcfdb73e202ac7ed6ec8cf37b29', 'Use the 45644018325 archive.');

const purchase = 'purchase-live/index-20261124-split-surplus.html';
const additions = [
  'purchase-live/app-20261125-dashboard-handle.js',
  'purchase-live/purchase-typography-20261125.css',
  'purchase-live/active-order-typography-20261125.css',
];
const buyer = 'buyer-room-20261125-company-entry.html';
const candidate = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');
const buyerHtml = candidate(buyer);
assert.equal(sha256(buyerHtml), 'a1e300cd03633435f5bc30a2dca470f261eeb1df1b10e3bc5560f6c2ff034e16');

const original = fs.readFileSync(path.join(site, purchase), 'utf8');
const oldScript = 'src="app-20261125-sourcing-handoff.js"';
assert.equal(original.split(oldScript).length, 2);
assert.equal(original.split('</head>').length, 2);
const links = '<link rel="stylesheet" href="purchase-typography-20261125.css"><link rel="stylesheet" href="active-order-typography-20261125.css">';
const replacement = original.replace(oldScript, 'src="app-20261125-dashboard-handle.js"')
  .replace('</head>', '<meta name="purchase-ui-build" content="20261125-purchase-ui-closeout-v1">' + links + '</head>');

for (const name of additions) {
  fs.writeFileSync(path.join(site, name), candidate(name), { flag: 'wx' });
}
fs.writeFileSync(path.join(site, buyer), buyerHtml);
fs.writeFileSync(path.join(site, purchase), replacement);
console.log('Preserved 156 baseline assets and staged the 5 exact UI changes.');
