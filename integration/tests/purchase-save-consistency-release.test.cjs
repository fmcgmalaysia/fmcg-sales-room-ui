const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{plan,build}=require('../prototypes/purchase-save-consistency-20261103/stage.cjs');
test('release changes three Purchase files and preserves all other 98 public assets',()=>{
 const p=plan();assert.equal(p.assets.size,101);assert.equal(p.changed.length,3);for(const[f,b]of p.baseline)if(!p.changed.includes(f))assert.ok(b.equals(p.assets.get(f)),f);
 for(const file of p.changed.filter(f=>f.endsWith('.js')))new vm.Script(p.assets.get(file).toString());
});
test('app and grid differ from verified production only by conditional recovery notices',()=>{
 const p=plan(),app=p.assets.get('purchase-live/app.js').toString(),grid=p.assets.get('purchase-live/task-grid.js').toString();
 const notice="'+(row.procurementSavePending?'<small class=\"procurement-save-pending\" role=\"status\">Save pending 保存待恢复</small>':'')+'";
 assert.equal(app.replace(notice,''),p.baseline.get('purchase-live/app.js').toString().replace(/\r\n/g,'\n'));
 assert.equal(grid.replace('      if(row.procurementSavePending)product+=\'<small class="procurement-save-pending" role="status">Save pending 保存待恢复</small>\';\n',''),p.baseline.get('purchase-live/task-grid.js').toString().replace(/\r\n/g,'\n'));
});
test('HTML preserves existing supplier editor and every unrelated stylesheet/script reference',()=>{
 const p=plan(),html=p.assets.get('purchase-live/index.html').toString();let restored=html.replace('content="'+build+'"','content="20261103-purchase-saved-plan-close-v3"').replace('app.js?v='+build,'app.js?v=20261103-purchase-saved-plan-close-v3').replace('task-grid.js?v='+build,'task-grid.js?v=20261103-purchase-task-clarity-v1');
 restored=restored.replace('.procurement-save-pending{display:block;color:#9a5800!important;background:#fff0d7;padding:2px 5px;border-radius:3px;font-size:11px;font-weight:400;line-height:1.4;letter-spacing:normal}\n','');assert.equal(restored,p.baseline.get('purchase-live/index.html').toString().replace(/\r\n/g,'\n'));
});
test('scoped workflow uploads only the explicitly selected package',()=>{const yaml=fs.readFileSync(path.join(__dirname,'../../.github/workflows/pages-v64-same-origin.yml'),'utf8');assert.equal((yaml.match(/inputs.static_ui == 'purchase-save-consistency-only'/g)||[]).length,2);assert.match(yaml,/inputs.static_ui != 'purchase-save-consistency-only'/);assert.match(yaml,/node integration\/prototypes\/purchase-save-consistency-20261103\/stage.cjs/);});
