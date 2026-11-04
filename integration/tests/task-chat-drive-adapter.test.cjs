const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createHash}=require('node:crypto');
function fixture(){
 const files=new Map(),properties=new Map();let held=false,reading=false,number=0,lost=false,bodyReads=0;
 const clone=x=>JSON.parse(JSON.stringify(x)),check=()=>assert(held||reading,'Drive mutation requires the service lock'),blob=(body,mimeType,name)=>({getBytes:()=>[...Buffer.from(body)],getDataAsString:()=>body,mimeType,name,body});
 const api={
  get(id){check();if(!files.has(id))throw Error('Missing');return clone(files.get(id));},
  list(options){check();const folder=options.q.match(/'([^']+)' in parents/)?.[1],name=options.q.match(/name = '([^']+)'/)?.[1],props=[...options.q.matchAll(/key='([^']+)' and value='([^']+)'/g)];return {files:[...files.values()].filter(f=>!f.trashed&&(!folder||(f.parents||[]).includes(folder))&&(!name||f.name===name)&&props.every(m=>f.appProperties?.[m[1]]===m[2])).slice(0,options.pageSize).map(clone)};},
  create(resource,media,options){assert(held);assert(options?.fields);assert(Object.keys(resource.appProperties||{}).length<=30);for(const [key,value] of Object.entries(resource.appProperties||{}))assert(Buffer.byteLength(key+value)<=124);const id='DriveFileIdentity'+String(++number).padStart(8,'0'),file={...clone(resource),id,size:media?.getBytes().length||0,body:media?.body||'',trashed:false};files.set(id,file);if(lost){lost=false;throw Error('Lost Google result');}return clone(file);},
  update(resource,id,media,options){assert(held);assert(options?.fields);assert(files.has(id));assert(Object.keys(resource.appProperties||{}).length<=30);const file={...files.get(id),...clone(resource),...(media?{body:media.body,size:media.getBytes().length}:{})};files.set(id,file);return clone(file);}
 };
 const context={Drive:{Files:api},DriveApp:{getFileById(id){check();return {getBlob(){bodyReads++;return blob(files.get(id).body);}};}},LockService:{getScriptLock:()=>({waitLock(){assert(!held);held=true;},releaseLock(){held=false;}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)})},ScriptApp:{getScriptId:()=> 'ScriptIdentity'},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,value)=>[...createHash('sha256').update(value).digest()],newBlob:blob},console};
 for(const file of ['TaskChatState.gs','TaskChatStore.gs'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../apps-script/purchase-documents',file),'utf8'),context);
 const base={action:'CHAT_OPERATION',company:'NCT',kind:'PO',taskId:'a'.repeat(32),pair:'ACCOUNT:PURCHASE',actor:{memberId:'M',staffId:'P',staffName:'Purchase',department:'PURCHASE'}};
 const run=input=>{reading=input.action==='CHAT_SUMMARIES'||input.operation==='SUMMARY';try{return clone(context.taskChatService_({...base,...input}));}finally{reading=false;}};
 return {run,files,properties,base,get held(){return held;},get bodyReads(){return bodyReads;},lost:()=>lost=true};
}
test('Drive adapter serializes mutations and reads summaries without locking PDF/photo uploads',()=>{
 const f=fixture();assert.equal(f.run({operation:'SUMMARY'}).fileId,null);assert.equal(f.files.size,0);
 for(let i=0;i<50;i++)f.run({operation:'SEND',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-'+String(i).padStart(12,'0'),body:'Message '+i,requiresAck:false,baseSequence:i});
 const folders=[...f.files.values()].filter(x=>x.mimeType==='application/vnd.google-apps.folder'),heads=[...f.files.values()].filter(x=>x.appProperties.part==='HEAD'),pages=[...f.files.values()].filter(x=>x.mimeType==='application/json'&&x.appProperties.part!=='HEAD');
 assert.equal(folders.length,1);assert.equal(folders[0].name,'FMCG Department Chats · NCT');assert.equal(heads.length,1);assert.equal(pages.length,3);assert(pages.every(p=>p.parents[0]===folders[0].id));assert(pages.every(p=>Object.keys(p.appProperties).length<=28));assert.equal(f.held,false);
 const result=f.run({operation:'SEND',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-000000000000',body:'Message 0',requiresAck:false,baseSequence:50});assert.equal(result.unchanged,true);assert.equal(result.message.sequence,1);
 const before=f.bodyReads;f.run({operation:'SUMMARY'});assert.equal(f.bodyReads,before+1,'only the task head is read for a summary');
});
test('wrong company and corrupted file identity fail closed and the service lock always releases',()=>{
 const f=fixture();assert.throws(()=>f.run({company:'OTHER',operation:'SUMMARY'}),/INVALID_TASK/);assert.equal(f.held,false);
 f.run({operation:'SEND',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',body:'One',requiresAck:false,baseSequence:0});
 const page=[...f.files.values()].find(x=>x.mimeType==='application/json'&&x.appProperties.part!=='HEAD');page.appProperties.taskKey='wrong';
 assert.throws(()=>f.run({operation:'PAGE'}),/FILE_CONFLICT/);assert.equal(f.held,false);
});
