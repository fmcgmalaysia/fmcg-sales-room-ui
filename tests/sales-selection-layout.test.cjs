const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('scoped release changes Sales only against the verified 101-resource manifest',()=>{
 const p=require('../integration/prototypes/sales-selection-layout-20261104/stage.cjs').plan();
 assert.equal(p.assets.size,101);assert.deepEqual(p.changed,['index.html']);
 for(const[file,b]of p.baseline)if(file!=='index.html')assert(b.equals(p.assets.get(file)),file);
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/pages-v64-same-origin.yml'),'utf8');
 assert.match(workflow,/inputs.static_ui != 'sales-selection-layout-only'/);
 assert.match(workflow,/node integration\/prototypes\/sales-selection-layout-20261104\/stage.cjs/);
});
test('business scripts and Wix page change only the requested table rendering and version',()=>{
 const before=cp.execFileSync('git',['show','7d28c83:index.html'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n'),after=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n');
 const scripts=s=>[...s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 const stripTable=s=>s.replace(/customerTable=function\(rows,recent\)\{[\s\S]*?(?=renderCustomerWorkspaceDrawer=function)/,'TABLE');
 assert.deepEqual(scripts(before).map(stripTable),scripts(after).map(stripTable));
 const oldPage=cp.execFileSync('git',['show','7d28c83:sales-room/wix/sales-room-page.js'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
 assert.equal(fs.readFileSync(path.join(root,'sales-room/wix/sales-room-page.js'),'utf8').replace(/\r\n/g,'\n'),oldPage.replace('20261104-sales-customer-selected-v1','20261104-sales-selection-layout-v1'));
});
