const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');

const [original, output] = process.argv.slice(2);
assert.ok(original && output, 'Pass the captured live Wix HTML and an output path.');
const bytes = fs.readFileSync(original);
const sha256 = content => createHash('sha256').update(content).digest('hex');
assert.equal(sha256(bytes), '04c9c869245ae0f227f9dab55e203c0bf077bcc200c4cbb9f96cb8b345c3b7fe',
  'Recheck the formal Wix quotation embed before editing.');

const html = bytes.toString('utf8');
const head = '</head>';
const header = '<header class="masthead">';
const style = '<link rel="stylesheet" href="https://fmcgmalaysia.github.io/fmcg-sales-room-ui/master-shared/workroom-masthead.css?v=20261125-master-masthead-v1">';
assert.equal(html.split(head).length, 2);
assert.equal(html.split(header).length, 2);
const candidate = html.replace(head, `${style}${head}`)
  .replace(header, '<header class="masthead" data-master-workroom-header>');
fs.writeFileSync(output, candidate, { flag: 'wx' });
console.log(sha256(candidate));
