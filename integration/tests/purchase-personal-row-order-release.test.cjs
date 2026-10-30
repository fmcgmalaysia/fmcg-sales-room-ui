const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {plan}=require('../prototypes/purchase-personal-row-order-20261030/stage.cjs');
test('personal row-order package changes only three Purchase resources on the current production baseline',()=>{
 const p=plan();assert.equal(p.assets.size,94);assert.deepEqual(p.changed,['purchase-live/app.js','purchase-live/display-rows.js','purchase-live/index.html']);
 const client=p.assets.get('purchase-live/app.js').toString(),preferences=p.assets.get('purchase-live/display-rows.js').toString(),index=p.assets.get('purchase-live/index.html').toString();new vm.Script(client);new vm.Script(preferences);
 assert.match(index,/content="20261030-purchase-personal-row-order-v1"/);for(const file of ['app.js','display-rows.js'])assert(index.includes(file+'?v='+p.build));
 assert.doesNotMatch(client,/行已移动，请点击 Save 保存。|Click Save afterwards/);assert.doesNotMatch(client,/sequenceDraft=groupSequence|sequenceDraft=displayRows\(\).taskSequence/);
 assert.match(client,/const input=\{edits\};mutate\('PURCHASE_SAVE_REQUEST'/);assert.match(client,/displayRows\(\).configure\(result,company\);restoreDraft\(\);migrateRowOrder\(\)/);
 assert(!preferences.includes('postMessage'));assert(!preferences.includes('setInterval'));
 const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/pages-v64-same-origin.yml'),'utf8');assert.match(workflow,/purchase-personal-row-order-only/);assert.match(workflow,/inputs.static_ui != 'purchase-personal-row-order-only'/);
});
