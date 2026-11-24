const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const target = path.join(process.argv[2], 'purchase-live');
const source = path.resolve(__dirname, '../purchase-live');
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const original = {
  'app.js': 'b6f253e626a81c45d7997e7df339af88ea1d112ba02e6640c8879d6dc6007d20',
  'task-info.js': '3dfb1aa3b2251935e2f1aa8022e8df68c4ff152ec2b094bc2ff6883a47a7e185',
  'index-20261124-split-surplus.html': '8e0c33c002d6168ebb9e71cabe121a496343b367b461dcb60702e4d2c1698c9d',
};
for (const [name, digest] of Object.entries(original)) {
  assert.equal(sha(fs.readFileSync(path.join(target,name))), digest, name);
}
const frame = path.join(target,'index-20261124-split-surplus.html');
let markup = fs.readFileSync(frame,'utf8');
const replace = (from,to) => {
  assert.equal(markup.split(from).length,2,from);
  markup=markup.replace(from,()=>to);
};
const version = '20261124-receipt-compact-v1';
replace('task-info.js?v=20261119-purchase-support-shortfall-v1','task-info-'+version+'.js');
replace('app.js?v=20261124-purchase-shortfall-refresh-v1','app-'+version+'.js');
replace('</head>','<link rel="stylesheet" href="receipt-compact.css?v='+version+'"></head>');
for (const [input, output] of [
  ['app.js','app-'+version+'.js'],
  ['task-info.js','task-info-'+version+'.js'],
  ['receipt-compact.css','receipt-compact.css'],
]) {
  const payload = fs.readFileSync(path.join(source,input),'utf8').replace(/\r\n/g,'\n');
  fs.writeFileSync(path.join(target,output),payload,{flag:'wx'});
}
fs.writeFileSync(frame,markup);
