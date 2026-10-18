/* Private chat files only. PDF/photo folders, delivery and permissions are untouched. */
function taskChatService_(input){
 const readOnly=input.action==='CHAT_SUMMARIES'||input.action==='CHAT_OPERATION'&&input.operation==='SUMMARY';
 const lock=readOnly?null:LockService.getScriptLock();if(lock)lock.waitLock(20000);
 try{
  const hash=value=>Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value)).map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
  const properties=PropertiesService.getScriptProperties(),scriptId=ScriptApp.getScriptId(),roots={};
  function root(company,create){
   if(!['NCT','GHR'].includes(company))throw Error('CHAT_INVALID_TASK');
   if(roots[company])return roots[company];
   const property='TASK_CHAT_ROOT_'+company;let id=properties.getProperty(property);
   if(id){const folder=Drive.Files.get(id,{fields:'id,mimeType,trashed,appProperties'});if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||folder.appProperties?.service!=='TASK_CHAT_V1'||folder.appProperties?.company!==company||folder.appProperties?.script!==scriptId)throw Error('CHAT_ROOT_CONFLICT');roots[company]=id;return id;}
   const files=Drive.Files.list({q:"trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='service' and value='TASK_CHAT_V1' } and appProperties has { key='company' and value='"+company+"' } and appProperties has { key='script' and value='"+scriptId+"' }",fields:'files(id)',pageSize:2}).files||[];
   if(files.length>1)throw Error('CHAT_ROOT_CONFLICT');id=files[0]?.id;
   if(!id&&create)id=Drive.Files.create({name:'FMCG Department Chats · '+company,mimeType:'application/vnd.google-apps.folder',appProperties:{service:'TASK_CHAT_V1',company,script:scriptId}},null,{fields:'id'}).id;
   if(id){if(!readOnly)properties.setProperty(property,id);roots[company]=id;}return id||null;
  }
  function run(request){
   let folder=root(request.company,false),headId=null;
   function identity(key,pair,number){return {service:'TASK_CHAT_V1',company:request.company,taskKey:key,part:pair==null?'HEAD':pair.replace(':','-')+'-'+number};}
   function locate(key,pair,number){if(!folder)return null;const props=identity(key,pair,number),name=key+'.'+props.part+'.json';const rows=Drive.Files.list({q:"'"+folder+"' in parents and trashed = false and name = '"+name+"'",fields:'files(id,name,mimeType,size,appProperties)',pageSize:2}).files||[];if(rows.length>1)throw Error('CHAT_FILE_CONFLICT');const file=rows[0];if(file&&(file.mimeType!=='application/json'||Number(file.size)>262144||Object.keys(props).some(k=>file.appProperties?.[k]!==props[k])))throw Error('CHAT_FILE_CONFLICT');return file||null;}
   function read(key,pair,number){const file=locate(key,pair,number);if(!file)return null;if(pair==null)headId=file.id;let content;try{content=JSON.parse(DriveApp.getFileById(file.id).getBlob().getDataAsString('UTF-8'));}catch(_){throw Error('CHAT_FILE_UNREADABLE');}return content;}
   function write(key,pair,number,value){
    if(!folder)folder=root(request.company,true);const props=identity(key,pair,number),name=key+'.'+props.part+'.json',body=JSON.stringify(value),blob=Utilities.newBlob(body,'application/json',name);
    if(pair!=null)for(const message of value.messages){if(!/^[a-f0-9]{64}$/.test(message.id))throw Error('CHAT_FILE_CONFLICT');props['m_'+message.id]='1';}
    if(blob.getBytes().length>262144)throw Error('CHAT_CAPACITY_REVIEW_REQUIRED');
    let file=locate(key,pair,number);
    try{file=file?Drive.Files.update({appProperties:props},file.id,blob,{fields:'id'}):Drive.Files.create({name,mimeType:'application/json',parents:[folder],appProperties:props},blob,{fields:'id'});}
    catch(error){file=locate(key,pair,number);if(!file||DriveApp.getFileById(file.id).getBlob().getDataAsString('UTF-8')!==body)throw Error('CHAT_SAVE_UNCONFIRMED');}
    if(pair==null)headId=file.id;
   }
   function findMessage(key,pair,id){
    if(!folder)return null;
    const rows=Drive.Files.list({q:"'"+folder+"' in parents and trashed = false and appProperties has { key='m_"+id+"' and value='1' }",fields:'files(id,mimeType,appProperties)',pageSize:2}).files||[];
    if(rows.length>1)throw Error('CHAT_FILE_CONFLICT');if(!rows.length)return null;
    const file=rows[0],prefix=pair.replace(':','-')+'-',part=file.appProperties?.part||'';
    if(file.mimeType!=='application/json'||file.appProperties?.taskKey!==key||!part.startsWith(prefix)||!/^\d+$/.test(part.slice(prefix.length)))throw Error('CHAT_FILE_CONFLICT');
    const message=read(key,pair,Number(part.slice(prefix.length)))?.messages.find(m=>m.id===id);if(!message)throw Error('CHAT_FILE_CONFLICT');return message;
   }
   const store={head:key=>read(key,null,0),putHead:(key,value)=>write(key,null,0,value),page:(key,pair,number)=>read(key,pair,number),putPage:(key,pair,number,value)=>write(key,pair,number,value),findMessage};
   const result=taskChatRun_(store,request,hash,()=>new Date().toISOString());
   if(request.operation==='SUMMARY'&&result.summary.lastIncoming)result.summary.lastIncoming.body=result.summary.lastIncoming.body.slice(0,240);
   return {...result,fileId:headId};
  }
  if(input.action==='CHAT_SUMMARIES'){
   if(!Array.isArray(input.tasks)||input.tasks.length>20)throw Error('CHAT_INVALID_TASK');
   return {ok:true,company:input.company,threads:input.tasks.map(task=>run({...task,company:input.company,actor:input.actor,operation:'SUMMARY'}))};
  }
  if(input.action!=='CHAT_OPERATION')throw Error('CHAT_INVALID_OPERATION');
  return run(input);
 }finally{if(lock)lock.releaseLock();}
}
