const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2];
const workroom = 'catalogue/catalogue-workspace-v1.html';
const previousMarker = 'content="20261119-catalogue-startup-pages-v1"';
const newMarker = 'content="20261119-catalogue-sort-cost-v1"';
const baselineHash = '9cbf4d95952adcd589eead8e86f5b8bf99b931f17090f3477622872da5d75926';
const hash = data => createHash('sha256').update(data).digest('hex');

assert.ok(target && fs.statSync(target).isDirectory(), 'Pass the extracted production Pages directory.');
function hashTree() {
  const files = fs.readdirSync(target, { recursive: true, withFileTypes: true }).filter(item => item.isFile());
  return new Map(files.map(item => {
    const file = path.join(item.parentPath, item.name);
    return [path.relative(target, file).split(path.sep).join('/'), hash(fs.readFileSync(file))];
  }));
}

const before = hashTree();
assert.equal(before.size, 117);
assert.equal(before.get(workroom), baselineHash, 'Unexpected live Catalogue workspace');
const file = path.join(target, workroom);
const previous = fs.readFileSync(file, 'utf8');
assert.equal(previous.split(previousMarker).length, 2);
const next = previous.replace(previousMarker, newMarker);
const source = path.resolve(__dirname, '../../buyer-room/catalogue/wix/catalogue-workspace-v1.html');
assert.equal(next.replace(/\r\n/g, '\n'), fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n'));
fs.writeFileSync(file, next);
const after = hashTree();
assert.equal(after.size, 117);
assert.deepEqual([...after].filter(([name, value]) => before.get(name) !== value).map(([name]) => name), [workroom]);
console.log(`Verified 116 unchanged files. ${workroom}: ${after.get(workroom)}`);
