const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const stage=require('../integration/prototypes/buyer-quantity-efficiency-20261104/stage.cjs');
test('scoped package preserves the other 100 currently released resources',()=>{
 const manifest=require('../integration/prototypes/buyer-quantity-efficiency-20261104/baseline-manifest.json');
 const p=stage.plan();for(const {path,sha256}of manifest.resources){if(path==='buyer-room.html')continue;assert.equal(crypto.createHash('sha256').update(p.assets.get(path)).digest('hex'),sha256,path)}
 assert.deepEqual(p.changed,['buyer-room.html']);
});
test('native download, order receipt lightbox and submission implementation remain byte-identical to accepted source',()=>{
 const current=fs.readFileSync('buyer-room/wix/buyer-room-page.js','utf8').replace(/\r\n/g,'\n');
 const prior=cp.execFileSync('git',['show','ae151e8:buyer-room/wix/buyer-room-page.js'],{encoding:'utf8'}).replace(/\r\n/g,'\n');
 for(const [start,end]of [['  function openHistoryFile(', '  let historyCustomerId'],['  function updateDownloadButtonVisibility(', '  let workspaceRefreshPromise'],["    if (message.type === 'BUYER_ROOM_SUBMIT_ORDER')",'  wixRealtimeFrontend.subscribe']]){
  const block=s=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)));assert.equal(block(current),block(prior),start);
 }
 const html=fs.readFileSync('buyer-room.html','utf8'),old=cp.execFileSync('git',['show','ae151e8:buyer-room.html'],{encoding:'utf8'});
 const submit=s=>s.slice(s.indexOf("$('confirmSubmit').onclick="),s.indexOf("$('trackMore').onclick="));assert.equal(submit(html),submit(old));
});
