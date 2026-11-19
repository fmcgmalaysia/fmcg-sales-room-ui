const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {patch,baselines,build}=require('./patch.cjs');
const source=file=>fs.readFileSync(path.join(__dirname,'baseline',baselines[file][0]));
function transport(file,{origin='https://www.ltpos.ai',referrer,legacy=false}={}){
 const text=(legacy?source(file):patch(file,source(file))).toString(),support=file.startsWith('support-room');
 const start=text.indexOf(support?'  const pending=new Map()':' const requests=new Map()');
 const end=text.indexOf(support?'  let productCbm=null':' let channel=null;');assert(start>=0&&end>start);
 const parent={postMessage:(message,target)=>calls.push({message,target})},window={addEventListener:(_type,fn)=>{receive=fn;}},calls=[];
 let receive;
 const context={company:'NCT',URL,Map,Set,Error,crypto:{randomUUID:()=> 'fake-request'},location:{ancestorOrigins:origin?[origin]:[]},document:{referrer:referrer??''},parent,window,guides:[],$:()=>({}),setTimeout:()=>1,clearTimeout:()=>{}};
 const api=vm.runInNewContext('(function(){'+text.slice(start,end)+';return {send:'+ (support?'send':'sendParent')+',pending:'+(support?'pending':'requests')+'};})()',context);
 return {...api,calls,parent,receive:event=>receive(event),request:()=>api.send(support?'FULFILMENT_READ_REQUEST':'PACKING_READ_REQUEST',...(support?[]:['NCT']))};
}
for(const file of ['support-room/workroom.js','master-shared/desk-delivery.js']){
 test(file+': production source reproduces custom-domain rejection before any request',async()=>{
  const f=transport(file,{legacy:true});await assert.rejects(f.request(),/Open .*MASTER/);assert.equal(f.calls.length,0);
 });
 for(const origin of ['https://www.ltpos.ai','https://ltpos.ai','https://fmcg999.wixstudio.com','https://fmcg999-master.editor.wix.com'])test(file+': exact trusted parent '+origin,async()=>{
  const f=transport(file,{origin}),promise=f.request();assert.equal(f.calls.length,1);const {message,target}=f.calls[0];assert.equal(target,origin);
  const reply={type:message.type.replace('_REQUEST','_RESULT'),company:message.company,requestId:message.requestId,ok:true,result:{company:'NCT',customers:[{id:'FAKE-A'}]}};
  for(const change of [{origin:'https://evil.invalid'},{source:{}},{data:{...reply,company:'GHR'}},{data:{...reply,requestId:'stale-request'}},{data:{...reply,type:'OTHER_RESULT'}}]){f.receive({source:f.parent,origin,data:reply,...change});assert.equal(f.pending.size,1);}
  f.receive({source:f.parent,origin,data:reply});assert.deepEqual(await promise,reply.result);assert.equal(f.pending.size,0);
 });
 for(const origin of ['https://ltpos.ai.evil.invalid','https://evil-ltpos.ai','http://ltpos.ai','https://www.ltpos.ai:8443',''])test(file+': untrusted/missing parent stays blocked '+origin,async()=>{
  const f=transport(file,{origin});await assert.rejects(f.request(),/Open .*MASTER/);assert.equal(f.calls.length,0);
 });
 test(file+': trusted origin cannot turn a revoked server response into access',async()=>{
  const f=transport(file),promise=f.request(),m=f.calls[0].message;
  f.receive({source:f.parent,origin:'https://www.ltpos.ai',data:{type:m.type.replace('_REQUEST','_RESULT'),company:m.company,requestId:m.requestId,ok:false,error:'Staff permission does not allow this operation.'}});
  await assert.rejects(promise,/permission/);assert.equal(f.pending.size,0);assert.equal(f.calls.length,1);
 });
 test(file+': actual document referrer works when ancestorOrigins is unavailable',async()=>{
  const f=transport(file,{origin:'',referrer:'https://ltpos.ai/support-department'}),promise=f.request(),m=f.calls[0].message;
  f.receive({source:f.parent,origin:'https://ltpos.ai',data:{type:m.type.replace('_REQUEST','_RESULT'),company:m.company,requestId:m.requestId,ok:true,result:{ok:true}}});await promise;assert.equal(f.calls[0].target,'https://ltpos.ai');
 });
}
test('only the two origin expressions, build labels and three existing script references change',()=>{
 for(const file of Object.keys(baselines)){const before=source(file).toString(),after=patch(file,source(file)).toString();assert.notEqual(before,after);assert(after.includes(build));
  if(file.endsWith('.js')){new vm.Script(after);const lines=before.split('\n'),next=after.split('\n');assert(Math.abs(lines.length-next.length)<=1);
   const variable=file.startsWith('support-room')?'ref':'origin';
   let restored=after.replace("(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes("+variable+".hostname)||['https://www.ltpos.ai','https://ltpos.ai'].includes("+variable+".origin))","['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com'].includes("+variable+".hostname)");
   restored=file.startsWith('support-room')?restored.replace("dataset.supportBuild='"+build+"'","dataset.supportBuild='20261117-support-profile-saved-state-v1'"):restored.replace('\n // Build: '+build,'');
   assert.equal(restored,before,'business actions and receipt transport remain byte-identical');
  }
  else{assert.equal(before.split('\n').length,after.split('\n').length);assert(after.includes('desk-delivery.js?v='+build));}
 }
});
test('three formal Wix pages retain every handler and change only their existing iframe resource version',()=>{
 for(const name of ['purchase-page','warehouse-page','support-page']){
  const before=fs.readFileSync(path.join(__dirname,'wix',name+'.before.js'),'utf8').replace(/\r\n/g,'\n').trim();
  const after=fs.readFileSync(path.join(__dirname,'wix',name+'.after.js'),'utf8').replace(/\r\n/g,'\n').trim();
  const pattern=/https:\/\/fmcgmalaysia\.github\.io\/fmcg-sales-room-ui\/(?:purchase-live\/|warehouse-room\/|support-room\/workroom\.html)\?v=[^'\s]+/g;
  const old=[...before.matchAll(pattern)].map(x=>x[0]),next=[...after.matchAll(pattern)].map(x=>x[0]);assert.equal(old.length,1);assert.equal(next.length,1);assert(next[0].includes(build));assert.equal(before.replace(old[0],next[0]),after);
 }
});
