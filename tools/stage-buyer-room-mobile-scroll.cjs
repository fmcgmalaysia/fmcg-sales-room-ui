const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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
assert.equal(sha256(manifest.join('')), '805f301adddee68cbf7f8c45d2cecf6ea8aa51e6d57ea5a9c5d065d79909501e',
  'Previously deployed Pages archive does not match run 45539921169.');

const name = 'buyer-room-20261125-company-entry.html';
const code = fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');
assert.ok(code.includes('<style id="buyer-selection-mobile-scroll">'), 'Missing mobile layout marker.');
fs.writeFileSync(path.join(site, name), code);
console.log(name, sha256(code));
