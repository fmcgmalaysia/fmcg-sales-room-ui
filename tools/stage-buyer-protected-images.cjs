const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync,readdirSync,writeFileSync} = require('node:fs');
const {join,resolve} = require('node:path');

assert.ok(process.argv[2], 'Pass the extracted production Pages archive.');
const site=resolve(process.argv[2]);
const head=resolve(__dirname,'..');
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const current='buyer-room-20261125-company-entry.html';
const next='buyer-room-20261126-protected-images.html';
const files=()=>readdirSync(site,{recursive:true,withFileTypes:true}).filter(file=>file.isFile())
  .map(file=>join(file.parentPath,file.name)).sort();
const before = new Map(files().map(file=>[file,digest(file)]));
assert.equal(before.size,169);
assert.equal(before.get(join(site,current)),'044adaaaab2966aa4276f2306c6e3821da14c380808645e826c9df2f70c40a62');
const candidate=readFileSync(join(head,next),'utf8').replace(/\r\n/g,'\n');
assert.match(candidate,/<meta name="buyer-protected-images-build" content="20261126-buyer-protected-images-v1">/);
writeFileSync(join(site,next),candidate,{flag:'wx'});
assert.equal(files().length,before.size+1);
for(const [file,hash] of before) assert.equal(digest(file),hash,'Unexpected change: '+file);
console.log('Verified all existing production assets; added only the protected Buyer Room image page.');
