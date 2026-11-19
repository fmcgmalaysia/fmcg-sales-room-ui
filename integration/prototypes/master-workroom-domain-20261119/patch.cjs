const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const build='20261119-master-workroom-domain-v1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const baselines={
 'support-room/workroom.js':['support-workroom.js','2f86c3add417146f29b7e1a6a798f27e138f1e44bd723389752c5264b1bd0185'],
 'master-shared/desk-delivery.js':['desk-delivery.js','4aa73cd58bbf04a05b698bfbaf1acf8e9b635a2d5d642a488d7bfcb0b28e1205'],
 'support-room/workroom.html':['support-workroom.html','f5a33c0b5d8c1157edf0808327ca78601e09b590ea899c0b33224a60f8a2a6b7'],
 'warehouse-room/index.html':['warehouse-index.html','be9222d717992091e22c686ee023ca75f1f14fa6de5fb8acf55917b962169a24'],
 'purchase-live/index.html':['purchase-index.html','b59748053404d7fde6bec7b19d218fda5b9d41818dad09bf47172333414dccdc']
};
function once(source,before,after){assert.equal(source.split(before).length,2,'unique frozen context required');return source.replace(before,()=>after);}
function patch(file,bytes){
 assert.equal(sha(bytes),baselines[file]?.[1],file+': production baseline changed');
 let text=bytes.toString();
 if(file==='support-room/workroom.js'){
  text=once(text,"['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes(ref.hostname)","(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes(ref.hostname)||['https://www.ltpos.ai','https://ltpos.ai'].includes(ref.origin))");
  text=once(text,"dataset.supportBuild='20261117-support-profile-saved-state-v1'","dataset.supportBuild='"+build+"'");
 }else if(file==='master-shared/desk-delivery.js'){
  text=once(text,"['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes(origin.hostname)","(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes(origin.hostname)||['https://www.ltpos.ai','https://ltpos.ai'].includes(origin.origin))");
  text=once(text," 'use strict';"," 'use strict';\n // Build: "+build);
 }else{
  const old=file==='warehouse-room/index.html'?'20261117-warehouse-expiry-unchanged-v1':'20261116-desk-delivery-receipt-v1';
  text=once(text,'../master-shared/desk-delivery.js?v='+old,'../master-shared/desk-delivery.js?v='+build);
  if(file==='support-room/workroom.html')text=once(text,'src="workroom.js?v=20261117-workroom-header-v1"','src="workroom.js?v='+build+'"');
 }
 return Buffer.from(text);
}
module.exports={patch,baselines,build,sha};
