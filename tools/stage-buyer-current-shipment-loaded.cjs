const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

assert.ok(process.argv[2], 'Pass the extracted Pages archive.');
const site = path.resolve(process.argv[2]);
const sha256 = content => createHash('sha256').update(content).digest('hex');
const files = fs.readdirSync(site, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => path.relative(site, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .sort();
const manifest = files.map(name => `${sha256(fs.readFileSync(path.join(site, name)))}  ${name}\n`).join('');
assert.equal(files.length, 161);
assert.equal(sha256(manifest), '4f6992d2445f1b8502298b319014f6e902ca874e001a5552492d5133b7cf718f',
  'Use the current 45741903970 Pages archive.');

const entry = 'buyer-room-20261125-company-entry.html';
const target = path.join(site, entry);
assert.equal(sha256(fs.readFileSync(target)), 'a1e300cd03633435f5bc30a2dca470f261eeb1df1b10e3bc5560f6c2ff034e16');
const html = fs.readFileSync(path.join(__dirname, '..', entry), 'utf8').replace(/\r\n/g, '\n');
assert.equal(sha256(html), '1df6fa30b6cd38f442601530fbeac4fc1ae4c86b3240541c1415b12453c351d9');
fs.writeFileSync(target, html);
console.log('Updated the live Buyer Room entry. Preserved the other 160 assets.');
