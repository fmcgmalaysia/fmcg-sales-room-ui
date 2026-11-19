/* Pure chat state machine. The caller must hold the service lock for every mutation.
 * Store pages contain bodies; the task head contains only summaries and personal cursors.
 * A page is committed before its head so a lost head write can be recovered on retry. */
const TASK_CHAT_PAGE_SIZE=24; // 24 message identities + 4 private file properties stay below Drive's 30/app limit.
const TASK_CHAT_PAIRS=['ACCOUNT:PURCHASE','PURCHASE:WAREHOUSE','SUPPORT:WAREHOUSE','PURCHASE:SALES','SALES:SUPPORT','SALES:WAREHOUSE'];
function taskChatRun_(store,input,hash,clock){
 const fail=message=>{throw Error('CHAT_'+message);},copy=value=>JSON.parse(JSON.stringify(value));
 const departments=['PURCHASE','ACCOUNT','WAREHOUSE','SUPPORT','SALES'];
 const actor=input.actor||{},pair=String(input.pair||''),members=pair.split(':');
 if(!['NCT','GHR'].includes(input.company)||!['PO','DELIVERY'].includes(input.kind)||!/^\w{32,64}$/.test(input.taskId||''))fail('INVALID_TASK');
 if(!TASK_CHAT_PAIRS.includes(pair)||!members.includes(actor.department)||!departments.includes(actor.department))fail('INVALID_PAIR');
 if(input.kind==='PO'&&(pair==='SUPPORT:WAREHOUSE'||members.includes('SALES'))||input.kind==='DELIVERY'&&pair==='ACCOUNT:PURCHASE')fail('INVALID_PAIR');
 if(![actor.memberId,actor.staffId,actor.staffName].every(value=>typeof value==='string'&&value.length>0&&value.length<=200))fail('INVALID_ACTOR');
 const key=hash([input.company,input.kind,input.taskId]),actorKey=actor.department+':'+actor.staffId,now=clock();
 let head=store.head(key)||{schema:1,company:input.company,kind:input.kind,taskId:input.taskId,revision:0,conversations:{}};
 if(head.schema!==1||head.company!==input.company||head.kind!==input.kind||head.taskId!==input.taskId)fail('IDENTITY_CONFLICT');
 let thread=head.conversations[pair]||{sequence:0,totals:{},lastIncoming:{},cursors:{},updatedAt:null};
 const peers=members.filter(d=>d!==actor.department),to=peers[0];
 function total(totals,department,except){return Object.entries(totals[department]||{}).reduce((n,[by,count])=>n+(by===except?0:count),0);}
 function accept(message){
  if(message.sequence!==thread.sequence+1||message.pair!==pair||message.company!==input.company||message.taskId!==input.taskId)fail('SEQUENCE_CONFLICT');
  thread.sequence=message.sequence;thread.updatedAt=message.at;
  const counts=thread.totals[message.to]||(thread.totals[message.to]={});counts[message.byStaffId]=(counts[message.byStaffId]||0)+1;
  thread.lastIncoming[message.to]={id:message.id,sequence:message.sequence,from:message.from,to:message.to,body:message.body,at:message.at,by:message.by,byStaffId:message.byStaffId};
 }
 function commitHead(){head.conversations[pair]=thread;head.revision++;store.putHead(key,head);}
 function pageNumber(sequence){return Math.floor((sequence-1)/TASK_CHAT_PAGE_SIZE);}
 function readPage(number){const page=store.page(key,pair,number);if(page&&(page.schema!==1||page.key!==key||page.pair!==pair||page.number!==number||!Array.isArray(page.messages)||page.messages.length>TASK_CHAT_PAGE_SIZE))fail('PAGE_CONFLICT');return page;}
 function summary(){
  const cursor=thread.cursors[actorKey],received=total(thread.totals,actor.department,actor.staffId);
  return {pair,sequence:thread.sequence,updatedAt:thread.updatedAt,lastIncoming:copy(thread.lastIncoming[actor.department]||null),unread:Math.max(0,received-(cursor?.received||0)),cursor:cursor?.sequence||0,legacyReadAt:cursor?.legacyAt||null,systemReadAt:cursor?.systemAt||null,legacyAcknowledgements:copy(thread.legacyAcknowledgements?.[actorKey]||{})};
 }
 const result=extra=>({ok:true,company:input.company,kind:input.kind,taskId:input.taskId,revision:head.revision,summary:summary(),...extra});
 function decorate(message){
  const acknowledgements=Object.entries(message.acknowledged||{}).map(([key,at])=>({kind:'ACK',department:key.split(':')[0],byStaffId:key.slice(key.indexOf(':')+1),at}));
  const reads=Object.entries(thread.cursors).filter(([key,cursor])=>key.startsWith(message.to+':')&&cursor.sequence>=message.sequence).map(([key,cursor])=>({kind:'READ',department:message.to,byStaffId:key.slice(key.indexOf(':')+1),at:cursor.at}));
  const all=acknowledgements.concat(reads),receipts=[];
  for(const kind of ['ACK','READ']){
   const values=all.filter(r=>r.kind===kind),personal=values.find(r=>r.department===actor.department&&r.byStaffId===actor.staffId);
   if(personal)receipts.push(personal);const first=values.find(r=>r!==personal);if(first)receipts.push(first);
  }
  const value=copy(message);delete value.acknowledged;
  // Full receipts remain in private storage; the conversation UI needs status plus this employee's receipt.
  return {...value,receipts,receiptCounts:{acknowledged:acknowledgements.length,read:reads.length}};
 }
 if(input.operation==='SUMMARY')return result({});
 // List summaries never open body pages. A page/save request recovers an ambiguous tail.
 let recovered=false;
 const tail=readPage(Math.floor(thread.sequence/TASK_CHAT_PAGE_SIZE));
 if(tail)for(const message of tail.messages.filter(m=>m.sequence>thread.sequence).sort((a,b)=>a.sequence-b.sequence)){accept(message);recovered=true;}
 if(recovered)commitHead();
 if(input.operation==='PAGE'){
  const before=input.beforeSequence==null?thread.sequence+1:input.beforeSequence;
  if(!Number.isSafeInteger(before)||before<1||before>thread.sequence+1)fail('INVALID_CURSOR');
  const limit=20,messages=[];let next=before-1;
  while(next>0&&messages.length<limit){const page=readPage(pageNumber(next));if(!page)fail('PAGE_MISSING');const selected=page.messages.filter(m=>m.sequence<=next).sort((a,b)=>b.sequence-a.sequence).slice(0,limit-messages.length);if(!selected.length)fail('PAGE_MISSING');messages.push(...selected);next=selected[selected.length-1].sequence-1;}
  return result({messages:messages.reverse().map(decorate),beforeSequence:next>0?next+1:null});
 }
 if(!/^[a-f0-9-]{36}$/i.test(input.requestId||''))fail('INVALID_REQUEST');
 if(input.operation==='LEGACY_READ'||input.operation==='SYSTEM_READ'){
  if(typeof input.at!=='string'||!Number.isFinite(Date.parse(input.at))||new Date(input.at).toISOString()!==input.at)fail('INVALID_CURSOR');
  const field=input.operation==='SYSTEM_READ'?'systemAt':'legacyAt',cursor=thread.cursors[actorKey]||{sequence:0,received:0};if(cursor[field]&&cursor[field]>=input.at)return result({unchanged:true});
  thread.cursors[actorKey]={...cursor,[field]:input.at};commitHead();return result({});
 }
 if(input.operation==='LEGACY_ACK'){
  if(!/^\w{32,64}$/.test(input.messageId||''))fail('INVALID_ACK');
  if(!thread.legacyAcknowledgements)thread.legacyAcknowledgements={};const receipts=thread.legacyAcknowledgements[actorKey]||(thread.legacyAcknowledgements[actorKey]={});
  if(receipts[input.messageId])return result({unchanged:true});receipts[input.messageId]=now;commitHead();return result({});
 }
 if(input.operation==='SEND'){
  const body=String(input.body||'').trim();if(!body||body.length>2000||typeof input.requiresAck!=='boolean')fail('INVALID_MESSAGE');
  if(!Number.isSafeInteger(input.baseSequence)||input.baseSequence<0||input.baseSequence>thread.sequence)fail('INVALID_CURSOR');
  const id=hash([key,pair,actor.memberId,actor.department,input.requestId]),digest=hash([body,input.requiresAck,input.replyTo||null]);
  // Message identity is indexed on its bounded Drive page, independent of a client cursor.
  const existing=store.findMessage(key,pair,id);
  if(existing){if(existing.digest!==digest)fail('REQUEST_REUSED');return result({message:decorate(existing),unchanged:true});}
  if(input.replyTo){const ref=input.replyTo;if(!ref||!Number.isSafeInteger(ref.sequence)||ref.sequence<1||ref.sequence>thread.sequence)fail('INVALID_REPLY');const message=readPage(pageNumber(ref.sequence))?.messages.find(m=>m.sequence===ref.sequence&&m.id===ref.id);if(!message)fail('INVALID_REPLY');}
  const sequence=thread.sequence+1,number=pageNumber(sequence),page=readPage(number)||{schema:1,key,pair,number,beforeTotals:copy(thread.totals),messages:[]};
  const message={id,digest,sequence,pair,company:input.company,taskId:input.taskId,from:actor.department,to,body,requiresAck:input.requiresAck,replyTo:input.replyTo||null,at:now,by:actor.staffName,byStaffId:actor.staffId,acknowledged:{}};
  page.messages.push(message);store.putPage(key,pair,number,page);accept(message);commitHead();return result({message:decorate(message)});
 }
 if(input.operation==='READ'){
  const sequence=input.sequence;
  if(!Number.isSafeInteger(sequence)||sequence<1||sequence>thread.sequence)fail('INVALID_CURSOR');
  if((thread.cursors[actorKey]?.sequence||0)>=sequence)return result({unchanged:true});
  const page=readPage(pageNumber(sequence));if(!page)fail('PAGE_MISSING');
  const received=total(page.beforeTotals,actor.department,actor.staffId)+page.messages.filter(m=>m.sequence<=sequence&&m.to===actor.department&&m.byStaffId!==actor.staffId).length;
  thread.cursors[actorKey]={...(thread.cursors[actorKey]||{}),sequence,received,at:now};commitHead();return result({});
 }
 if(input.operation==='ACK'){
  const sequence=input.sequence;if(!Number.isSafeInteger(sequence)||sequence<1||sequence>thread.sequence)fail('INVALID_MESSAGE');
  const number=pageNumber(sequence),page=readPage(number),message=page?.messages.find(m=>m.sequence===sequence&&m.id===input.messageId);
  if(!message||message.to!==actor.department||!message.requiresAck)fail('INVALID_ACK');
  if(message.acknowledged[actorKey])return result({unchanged:true});
  message.acknowledged[actorKey]=now;store.putPage(key,pair,number,page);return result({message:decorate(message)});
 }
 fail('INVALID_OPERATION');
}
