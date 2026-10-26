// Task-authorized chat orchestration. Drive is the message authority; CMS is one task index/cache.
const pairs=['ACCOUNT:PURCHASE','PURCHASE:WAREHOUSE','SUPPORT:WAREHOUSE','PURCHASE:SALES','SALES:SUPPORT','SALES:WAREHOUSE'];
const salesContext=task=>task.kind==='DELIVERY'?{customerId:task.customerId||null,orderId:task.orderId||null,sourceLineId:task.sourceLineId||null,batchId:task.batchId||null}:{};
const departmentKeys=task=>task.kind==='PO'?['PURCHASE','ACCOUNT','WAREHOUSE']:['PURCHASE','WAREHOUSE','SUPPORT','SALES'];
const clone=value=>JSON.parse(JSON.stringify(value));
export function taskChatPair(department,peer){const pair=[department,peer].sort().join(':');if(!pairs.includes(pair))throw Error('Chat departments are not permitted to converse.');return pair;}
export function createTaskChatService({drive,index,resolve,hash}){
 const indexId=(company,task)=>hash(['TASK_CHAT_INDEX',company,task.kind,task.id]).slice(0,32);
 const storageTask=task=>hash(['TASK_CHAT_TASK',task.kind,task.id]);
 const fail=message=>{throw Error('Chat '+message);};
 function select(model,input,department){const task=model.tasks.find(t=>t.kind===input.kind&&t.id===input.taskId);if(!task)fail('task is not available in this company.');const pair=taskChatPair(department,input.peer);if(!task.peers.includes(input.peer))fail('department is not permitted on this task.');return {task,pair};}
 const actor=(staff,department)=>({memberId:staff.memberId,staffId:staff.staffId,staffName:staff.staffName,department});
 const envelope=(company,department,staff,task,pair)=>({company,kind:task.kind,taskId:storageTask(task),pair,actor:actor(staff,department)});
 const updates=(task,department,peer)=>(task.updates||[]).filter(e=>!e.from||e.from===department||e.from===peer);
 async function ensureIndex(company,task){
  const id=indexId(company,task),valid=row=>row&&row.company===company&&row.taskKind===task.kind&&row.taskId===task.id;
  const existing=await index.read(id);if(existing){if(!valid(existing))fail('index identity requires review.');return;}
  // Establish discoverability before the first Drive write, including a lost browser session.
  const row={_id:id,title:task.number||task.title||task.id,company,taskKind:task.kind,taskId:task.id,manifestId:null,departmentKeys:departmentKeys(task),details:{task:{number:task.number,title:task.title,closed:!!task.closed,sourceTaskId:task.sourceTaskId||null,sourceTaskIds:task.sourceTaskIds||[],...salesContext(task)},summaries:{},authority:'DRIVE_V1'}};
  try{await index.insert(row);}catch(error){if(!valid(await index.read(id)))throw error;}
 }
 async function cache(company,task,result){
  if(!result.fileId)return;
  const id=indexId(company,task),existing=await index.read(id);
  if(existing&&(existing.company!==company||existing.taskKind!==task.kind||existing.taskId!==task.id||existing.manifestId&&existing.manifestId!==result.fileId))fail('index identity requires review.');
  const row={...(existing||{}),_id:id,title:task.number||task.title||task.id,company,taskKind:task.kind,taskId:task.id,manifestId:result.fileId,departmentKeys:departmentKeys(task),details:{...(existing?.details||{}),task:{number:task.number,title:task.title,closed:!!task.closed,sourceTaskId:task.sourceTaskId||null,sourceTaskIds:task.sourceTaskIds||[],...salesContext(task)},summaries:{...(existing?.details?.summaries||{}),[result.summary.pair]:{revision:result.revision,updatedAt:result.summary.updatedAt,lastIncoming:result.summary.lastIncoming}},authority:'DRIVE_V1'}};
  // Summary cache may lag a competing response. List never treats it as message authority.
  if(existing)await index.update(row);else try{await index.insert(row);}catch(error){const raced=await index.read(id);if(!raced||raced.company!==company||raced.taskKind!==task.kind||raced.taskId!==task.id||raced.manifestId!==row.manifestId)throw error;}
 }
 function legacy(task,department,peer,summary){
  return (task.legacy||[]).filter(m=>(m.from===department&&m.to.includes(peer))||(m.from===peer&&m.to.includes(department))).map(m=>{
   const receipts=[...(m.receipts||[])];if(m.to.includes(department)&&summary?.legacyReadAt&&m.at<=summary.legacyReadAt)receipts.push({kind:'READ',department,byStaffId:summary.staffId,at:summary.legacyReadAt});
   if(summary?.legacyAcknowledgements?.[m.id])receipts.push({kind:'ACK',department,byStaffId:summary.staffId,at:summary.legacyAcknowledgements[m.id]});
   return {...m,to:m.from===department?[peer]:[department],legacy:true,receipts};
  }).sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.id.localeCompare(b.id));
 }
 function summary(task,peer,department,staff,result){
  const value={sequence:0,unread:0,lastIncoming:null,...result?.summary,staffId:staff.staffId};
  const old=legacy(task,department,peer,value),incoming=old.filter(m=>m.to.includes(department)),oldLast=incoming.at(-1);
  const lastIncoming=[value.lastIncoming||oldLast,...updates(task,department,peer).filter(e=>e.presentation==='MESSAGE'&&e.from===peer)].filter(Boolean).sort((a,b)=>String(a.at).localeCompare(String(b.at))).at(-1)||null;
  const unread=old.filter(m=>m.to.includes(department)&&m.byStaffId!==staff.staffId&&!m.receipts.some(r=>r.byStaffId===staff.staffId&&r.department===department)).length;
  return {kind:task.kind,taskId:task.id,sourceTaskId:task.sourceTaskId||null,sourceTaskIds:task.sourceTaskIds||[],...salesContext(task),peer,pair:taskChatPair(department,peer),number:task.number,title:task.title,closed:!!task.closed,sequence:value.sequence,updatedAt:[value.updatedAt,old.at(-1)?.at,...updates(task,department,peer).map(e=>e.at)].filter(Boolean).sort().at(-1)||null,unread:value.unread+unread+updates(task,department,peer).filter(e=>e.notify&&e.from===peer&&(!value.systemReadAt||e.at>value.systemReadAt)).length,lastIncoming,updates:updates(task,department,peer)};
 }
 return {
  async list({company,department,staff,historyCursor=null}){
   const model=await resolve({company,department,staff,historyCursor}),ids=model.tasks.map(t=>indexId(company,t)),stored=await index.find(ids),requests=[];
   for(const task of model.tasks)if(stored.some(i=>i._id===indexId(company,task)))for(const peer of task.peers)requests.push({task,peer,...envelope(company,department,staff,task,taskChatPair(department,peer))});
   const results=new Map();
   for(let n=0;n<requests.length;n+=20){const batch=requests.slice(n,n+20),read=await drive({action:'CHAT_SUMMARIES',company,actor:actor(staff,department),tasks:batch.map(({kind,taskId,pair})=>({kind,taskId,pair}))});for(let i=0;i<batch.length;i++)results.set(batch[i].task.kind+':'+batch[i].task.id+':'+batch[i].peer,read.threads[i]);}
   return {company,department,staff:{staffId:staff.staffId,staffName:staff.staffName},threads:model.tasks.flatMap(task=>task.peers.map(peer=>summary(task,peer,department,staff,results.get(task.kind+':'+task.id+':'+peer)))),legacyArchive:(model.legacyArchive||[]).map(({messages,...metadata})=>({...metadata,lastIncoming:messages.filter(m=>m.to.includes(department)).at(-1)||null})),nextHistory:model.nextHistory||null,readAt:new Date().toISOString()};
  },
  async page({company,department,staff,input}){
   const model=await resolve({company,department,staff,taskRef:{kind:input.kind,id:input.taskId}}),before=input.before||null;
   if(input.legacyOnly){const archived=(model.legacyArchive||[]).find(t=>t.taskId===input.taskId&&t.peer===input.peer);if(!archived)fail('legacy history is not available.');const end=before==null?archived.messages.length:Number(String(before).replace(/^L:/,''));if(!Number.isSafeInteger(end)||end<0||end>archived.messages.length)fail('history cursor is invalid.');const start=Math.max(0,end-20);return {company,department,kind:'PO',taskId:input.taskId,peer:input.peer,readOnly:true,messages:archived.messages.slice(start,end),before:start?'L:'+start:null,updates:[]};}
   const {task,pair}=select(model,input,department);
   if(before!==null&&!/^[NL]:\d+$/.test(before))fail('history cursor is invalid.');
   const core=await drive({...envelope(company,department,staff,task,pair),action:'CHAT_OPERATION',operation:before?.startsWith('L:')?'SUMMARY':'PAGE',...(before?.startsWith('N:')?{beforeSequence:Number(before.slice(2))}:{})});
   if(core.fileId)await cache(company,task,core);
   const previous=legacy(task,department,input.peer,{...core.summary,staffId:staff.staffId}),messages=before?.startsWith('L:')?[]:core.messages||[];
   let next=core.beforeSequence?'N:'+core.beforeSequence:null;
   if(!next&&messages.length<20){const end=before?.startsWith('L:')?Number(before.slice(2)):previous.length;if(end<0||end>previous.length)fail('history cursor is invalid.');const start=Math.max(0,end-(20-messages.length));messages.unshift(...previous.slice(start,end));next=start?'L:'+start:null;}
   else if(!next&&previous.length)next='L:'+previous.length;
   return {company,department,kind:task.kind,taskId:task.id,peer:input.peer,messages,before:next,summary:summary(task,input.peer,department,staff,core),updates:updates(task,department,input.peer)};
  },
  async save({company,department,staff,requestId,input}){
   const model=await resolve({company,department,staff,taskRef:{kind:input.kind,id:input.taskId}}),{task,pair}=select(model,input,department);
   let operation=input.action;
   if(!['SEND','READ','ACK','LEGACY_READ','LEGACY_ACK','SYSTEM_READ'].includes(operation))fail('action is not supported.');
   const payload={...envelope(company,department,staff,task,pair),action:'CHAT_OPERATION',operation,requestId};
   if(operation==='SEND'){if(typeof input.body!=='string'||input.body.trim().length<1||input.body.trim().length>2000||typeof input.requiresAck!=='boolean')fail('message must contain 1–2000 characters.');Object.assign(payload,{body:input.body,requiresAck:input.requiresAck,baseSequence:input.baseSequence,replyTo:input.replyTo||null});}
   else if(operation==='SYSTEM_READ'){
    const update=updates(task,department,input.peer).find(e=>e.id===input.messageId&&e.from===input.peer&&e.notify===true);
    if(!update)fail('notification is not addressed to this department.');payload.at=update.at;
   }else if(operation.startsWith('LEGACY_')){
    const old=legacy(task,department,input.peer,{}).find(m=>m.id===input.messageId&&m.to.includes(department));if(!old||operation==='LEGACY_ACK'&&!old.requiresAck)fail('legacy message is not addressed to this department.');
    Object.assign(payload,operation==='LEGACY_READ'?{at:old.at}:{messageId:old.id});
   }else Object.assign(payload,{sequence:input.sequence,...(operation==='ACK'?{messageId:input.messageId}:{})});
   await ensureIndex(company,task);
   const result=await drive(payload);await cache(company,task,result);
   return {ok:true,company,department,requestId,kind:task.kind,taskId:task.id,peer:input.peer,summary:summary(task,input.peer,department,staff,result),message:result.message||null,unchanged:result.unchanged===true};
  }
 };
}
