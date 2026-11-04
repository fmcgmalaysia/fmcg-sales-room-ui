const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const plan=require('../prototypes/master-closeout-display-20261031/stage.cjs').plan();
test('release preserves all other departments and limits the five changed assets',()=>{
 assert.equal(plan.assets.size,99);
 assert.deepEqual(plan.changed.sort(),['account-room/index.html','account-room/payment-layout.js','purchase-live/app.js','purchase-live/index.html','purchase-live/task-info.js']);
 for(const file of ['master-shared/desk-delivery.js','warehouse-room/index.html','support-room/workroom.html'])assert(plan.assets.get(file).equals(plan.baseline.get(file)));
});
test('release points each changed script at its scoped version and retains single-loaded behavior',()=>{
 const purchase=plan.assets.get('purchase-live/index.html').toString(),finance=plan.assets.get('account-room/index.html').toString();
 assert(purchase.includes('task-info.js?v=20261031-purchase-allocation-origin-info-v1'));
 assert(purchase.includes('app.js?v='+plan.build));assert(finance.includes('payment-layout.js?v='+plan.build));
 for(const html of [purchase,finance])assert(html.includes('<meta name="build" content="'+plan.build+'"'));
 const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/pages-v64-same-origin.yml'),'utf8');
 assert(workflow.includes("inputs.static_ui != 'master-closeout-display-only'"));
 assert.equal((workflow.match(/inputs.static_ui == 'master-closeout-display-only'/g)||[]).length,2);
});
