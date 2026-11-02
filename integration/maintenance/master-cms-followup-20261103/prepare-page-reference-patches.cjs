// Prepare offline only. Never publish these references before the matching Pages artifact.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root='C:/FMCG-WIX-LOCAL/handoff/master-three-customer-stress-20261102',build='20261103-master-stress-closeout-v1',hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const files=[['purchase','integration/wix/purchase-room-page.js'],['finance','integration/wix/account-department-page.js'],['support','integration/wix/support-department-page.js'],['warehouse','integration/wix/warehouse-department-page.js'],['sales','sales-room/wix/sales-room-page.js'],['buyer','buyer-room/wix/buyer-room-page.js']];
const report=[];
for(const[name,repo]of files){const source=fs.readFileSync(path.join(root,name+'-page-fresh-closeout-20261103.js'),'utf8').replace(/\r\n/g,'\n'),expected=fs.readFileSync(repo,'utf8').replace(/\r\n/g,'\n');assert.equal(source,expected,name+' fresh Wix mismatch');const old=[...source.matchAll(/2026\d{4}-[a-z0-9-]+/g)].map(m=>m[0]);assert.equal(old.length,1,name+' version count');const target=source.replace(old[0],build);fs.writeFileSync(path.join(root,name+'-page-candidate-closeout-20261103.js'),target);report.push({name,repositoryFile:repo,before:old[0],after:build,beforeSha256:hash(source),afterSha256:hash(target),freshOriginalMatchesRepository:true,status:'OFFLINE_PREPARED_NOT_SYNCED'});}
fs.writeFileSync(path.join(root,'WIX_PAGE_REFERENCE_PATCHES.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
