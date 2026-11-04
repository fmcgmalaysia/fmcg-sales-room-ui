const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const release=require('../prototypes/support-reusable-desk-20261103/stage.cjs');
test('Desk release modifies only seven declared resources and retains the deployed Warehouse route guard',()=>{
 const p=release.plan();assert.equal(p.assets.size,101);assert.equal(p.changed.length,7);
 for(const[file,bytes]of p.assets)if(!p.changed.includes(file))assert(bytes.equals(p.baseline.get(file)),file);else if(file.endsWith('.js'))new vm.Script(bytes.toString());
 const shared=p.assets.get('master-shared/desk-delivery.js').toString();assert(shared.includes('completedLists'));assert(shared.includes('Warehouse navigation'));assert(shared.includes('currentAuthorization===false'));
 for(const file of ['support-room/workroom.html','purchase-live/index.html','warehouse-room/index.html'])assert(p.assets.get(file).toString().includes(release.build),file);
 assert(p.assets.get('support-room/workroom.js').toString().includes("supportBuild='"+release.build+"'"));
 assert(!p.assets.get('support-room/workroom.html').toString().includes('locks this Desk'));
});
test('the scoped workflow stages one Desk package and never enables the general site build for this input',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/pages-v64-same-origin.yml'),'utf8');assert(workflow.includes("inputs.static_ui != 'support-reusable-desk-only'"));assert.equal((workflow.match(/inputs.static_ui == 'support-reusable-desk-only'/g)||[]).length,2);assert(workflow.includes('support-reusable-desk-20261103/stage.cjs'));
});
