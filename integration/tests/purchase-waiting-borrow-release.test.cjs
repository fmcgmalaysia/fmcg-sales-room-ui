const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),stage=require('../prototypes/purchase-waiting-borrow-20261106/stage.cjs');
const base=process.env.PURCHASE_RECEIPT_BASE;
test('release preserves 92 verified resources and produces four parseable scoped changes',()=>{
 assert.ok(base,'Set PURCHASE_RECEIPT_BASE to the verified receipt UX package');
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'purchase-waiting-release-')),result=stage.stage(base,out);
 assert.equal(result.resources.length,96);assert.equal(result.changed.length,4);
 for(const file of result.changed.filter(file=>file.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(out,file),'utf8'),{filename:file});
 for(const item of result.resources)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out,item.path))).digest('hex'),item.sha256);
 const html=fs.readFileSync(path.join(out,'purchase-live/index.html'),'utf8');assert.match(html,/20261106-purchase-waiting-borrow-v1/);
});
test('Wix outer page changes only the verified build reference',()=>{
 const cp=require('node:child_process'),old=cp.execFileSync('git',['show','e8e5c0b7:integration/wix/purchase-room-page.js'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
 assert.equal(fs.readFileSync(path.join(root,'integration/wix/purchase-room-page.js'),'utf8').replace(/\r\n/g,'\n'),old.replace('20261106-purchase-receipt-ux-v2',stage.build));
});
