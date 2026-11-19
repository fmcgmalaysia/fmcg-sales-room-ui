const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2];
const workroom = 'catalogue/catalogue-workspace-v1.html';
const previousMarker = 'content="20261119-catalogue-sort-cost-v1"';
const newMarker = 'content="20261119-catalogue-critical-load-v1"';
const baselineHash = '4a82076d846e7d1feeb34b0af4d03d75654f689485e5624ce6841cdef94f1963';
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
const source = path.resolve(__dirname, '../../buyer-room/catalogue/wix/catalogue-workspace-v1.html');
const candidate = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
const first = previous.indexOf('    function imageMarkup(');
const last = previous.indexOf('    function render(', first);
const candidateFirst = candidate.indexOf('    function thumbnailUrl(');
const candidateLast = candidate.indexOf('    function render(', candidateFirst);
assert.ok(first > 0 && last > first && candidateFirst > 0 && candidateLast > candidateFirst);
let next = (previous.slice(0, first) + candidate.slice(candidateFirst, candidateLast) + previous.slice(last))
  .replace(previousMarker, newMarker);
const stateChanges = [
  ['selectionCountsReady:false,busyId:', 'selectionCountsReady:false,selectionReady:false,busyId:'],
  ['button.disabled=isSelected;', 'button.disabled=isSelected||!state.selectionReady;'],
  ["button.textContent=isSelected?'✓ Selected':hasError?", "button.textContent=isSelected?'✓ Selected':!state.selectionReady?'Loading account…':hasError?"],
  ['    function selectProduct(productId){\n', '    function selectProduct(productId){\n      if(!state.selectionReady)return;\n'],
  ['        state.selectionCountsReady=d.selectionCountsReady!==false;state.buyerRoomUrl=text(d.buyerRoomUrl);\n',
    '        state.selectionCountsReady=d.selectionCountsReady!==false;state.buyerRoomUrl=text(d.buyerRoomUrl);\n        state.selectionReady=d.selectionReady!==false;\n']
];
for (const [before, after] of stateChanges) {
  assert.equal(next.split(before).length, 2, 'Unexpected selection guard baseline');
  next = next.replace(before, after);
}
assert.equal(next.replace(/\r\n/g, '\n'), candidate);
fs.writeFileSync(file, next);
const after = hashTree();
assert.equal(after.size, 117);
assert.deepEqual([...after].filter(([name, value]) => before.get(name) !== value).map(([name]) => name), [workroom]);
console.log(`Verified 116 unchanged files. ${workroom}: ${after.get(workroom)}`);
