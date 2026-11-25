const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const pages = {
  'purchase-live/index-20261124-split-surplus.html': 'cc97eec394af9412be138c11da2f064f175d549ce51a39cfe91620ee58686614',
  'account-room/index.html': 'c11d7c3e80db707489d090a2d1f21997547026f3b89ad06a67d7ff3f6a4310fe',
  'support-room/workroom.html': 'ad3b8f8b1e4cc552903d226d4a6c0df3520e47055f23c914c0e89ee77cb8df0a',
  'warehouse-room/index.html': 'b03d8b2722226b3b9e88ceb68d463ce9152fb14ac51976a131c8c875d3918a8c',
  'warehouse-room/stock-control.html': '2e5ec2289899a5b60138f6e8901c344243f104883ac78bacf41cbf175887c2a2',
  'account-room/stock-list.html': 'f47bf7b922b52fde31bfe93110fef8abad368c6002712f0e3be5580b346b2ba9'
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = ['master-shared/company-switch.css', 'master-shared/company-switch.js'];
const buyerScript = 'buyer-room/company-switch-sheet-20261125.js';
const style = '<link rel="stylesheet" href="../master-shared/company-switch.css?v=20261125-company-switch-icon-v1">';
const script = '<script src="../master-shared/company-switch.js?v=20261125-company-switch-icon-v1"></script>';

assert.ok(process.argv[2], 'Pass a copy of the verified Pages archive');
const site = path.resolve(process.argv[2]);
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

const pending = new Map();
for (const [file, expected] of Object.entries(pages)) {
  const destination = path.join(site, file);
  const code = fs.readFileSync(destination, 'utf8');
  assert.equal(sha256(code), expected, `Live baseline mismatch for ${file}`);
  assert.equal(code.split('</head>').length, 2, file);
  assert.equal(code.split('</body>').length, 2, file);
  pending.set(destination, code.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`));
}
const buyerDestination = path.join(site, buyerScript);
assert.equal(sha256(fs.readFileSync(buyerDestination)), '32c1af78d80feca5a6dd2a06d838d5020b329714089f9111008addca2e279e1b',
  'Buyer Room and Catalogue switch baseline changed');
pending.set(buyerDestination, fs.readFileSync(path.join(__dirname, '..', buyerScript), 'utf8').replace(/\r\n/g, '\n'));
for (const file of assets) {
  const destination = path.join(site, file);
  assert.ok(!fs.existsSync(destination), `Unexpected existing asset ${file}`);
  pending.set(destination, fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n'));
}
for (const [destination, code] of pending) {
  fs.writeFileSync(destination, code);
  console.log(path.relative(site, destination), sha256(code));
}
