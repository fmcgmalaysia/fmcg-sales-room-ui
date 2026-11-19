const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {patchBuyerQuoteDate}=require('../prototypes/quote-published-date-20261119/patch.cjs');
const {patchOrderSort}=require('../prototypes/buyer-order-sort-20261119/patch.cjs');
const {patchPublishSwitch}=require('../prototypes/quotation-publish-switch-20261119/patch.cjs');
const site=process.argv[2];assert(site&&fs.statSync(site).isDirectory(),'Pass extracted verified Pages archive');
const sha=s=>createHash('sha256').update(s).digest('hex');
function tree(){return new Map(fs.readdirSync(site,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const p=path.join(e.parentPath,e.name);return[path.relative(site,p).split(path.sep).join('/'),sha(fs.readFileSync(p))]}));}
const before=tree();assert.equal(before.size,117);
const expected={
 'buyer-room.html':'71f7fdff71a9fcf1110f6be900ecbf5f7ed37e2d5708be4c9b4ff1c38b040278',
 'master-quotations/app.js':'36891e7177677ae7b67017ff35a243ac6fdb43476b0f162b64275d127c2f6b12',
 'master-quotations/index.html':'a1f4ffa179f1aee76cb47a936e410c277e60164440c31cb73a7bc738b9a52e3e',
 'ltpos/managed.html':'05aa412d0db74a797f2d6148c759354112916025fb9aec7cc90ed1b62857654b'
};
for(const [file,hash]of Object.entries(expected))assert.equal(before.get(file),hash,'Unexpected live source '+file);
function edit(file,transform){const p=path.join(site,file),text=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');fs.writeFileSync(p,transform(text));}
function marker(text,old,next){assert(text.includes(old));return text.replaceAll(old,next);}
edit('buyer-room.html',s=>marker(patchOrderSort(patchBuyerQuoteDate(s)),'20261119-buyer-short-name-sort-v1','20261119-buyer-quote-date-order-v1'));
edit('master-quotations/app.js',patchPublishSwitch);
edit('master-quotations/index.html',s=>marker(s,'20261119-view-quote-row-v1','20261119-view-quote-immediate-v1'));
edit('ltpos/managed.html',()=>fs.readFileSync(path.resolve(__dirname,'../../ltpos/managed.html'),'utf8').replace(/\r\n/g,'\n'));
const after=tree();assert.equal(after.size,before.size);
const changes=[...after].filter(([name,value])=>before.get(name)!==value).map(([name])=>name).sort();
assert.deepEqual(changes,Object.keys(expected).sort());
console.log(JSON.stringify({changed:changes.map(name=>({name,sha256:after.get(name)})),unchanged:113}));
