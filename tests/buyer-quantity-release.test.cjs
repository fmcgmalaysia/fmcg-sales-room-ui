const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const stage=require('../integration/prototypes/buyer-quantity-efficiency-20261104/stage.cjs');
test('scoped package preserves shared resources and the independently accepted Sales layout',()=>{
 const manifest=require('../integration/prototypes/buyer-quantity-efficiency-20261104/baseline-manifest.json');
 const p=stage.plan();for(const {path,sha256}of manifest.resources){if(path==='buyer-room.html')continue;const expected=path==='index.html'?crypto.createHash('sha256').update(cp.execFileSync('git',['show','4bc463e:index.html'],{encoding:'utf8'}).replace(/\r\n/g,'\n')).digest('hex'):sha256;assert.equal(crypto.createHash('sha256').update(p.assets.get(path)).digest('hex'),expected,path)}
 assert.deepEqual(p.changed,['buyer-room.html']);
});
test('native downloads and submission authority remain unchanged across the authorized receipt-timing change',()=>{
 const current=fs.readFileSync('buyer-room/wix/buyer-room-page.js','utf8').replace(/\r\n/g,'\n');
 const prior=cp.execFileSync('git',['show','ae151e8:buyer-room/wix/buyer-room-page.js'],{encoding:'utf8'}).replace(/\r\n/g,'\n');
 for(const [start,end]of [['  function openHistoryFile(', '  let historyCustomerId'],['  function updateDownloadButtonVisibility(', '  let workspaceRefreshPromise']]){
  const block=s=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)));assert.equal(block(current),block(prior),start);
 }
 const html=fs.readFileSync('buyer-room.html','utf8'),old=cp.execFileSync('git',['show','ae151e8:buyer-room.html'],{encoding:'utf8'});
 const submit=s=>s.slice(s.indexOf("$('confirmSubmit').onclick="),s.indexOf("$('trackMore').onclick="));assert.equal(submit(html),submit(old));
 const download=s=>s.slice(s.indexOf('function downloadOrderExcel('),s.indexOf("window.addEventListener('message'",s.indexOf('function downloadOrderExcel(')));assert.equal(download(html),download(old));
 for(const file of ['backend/catalogueAuth.web.js','backend/buyerOrderDownload.js','backend/buyerSelectionExcel.js'])assert.equal(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),cp.execFileSync('git',['show','815ace43:'+file],{encoding:'utf8'}).replace(/\r\n/g,'\n'),file);
});
