import { getTaskChats, getTaskChatPage, saveTaskChat } from 'backend/taskChat.web';
// Deploy as public/taskChatBridge.js. Department is supplied by each page, never by the iframe.
export async function handleTaskChat(message,department,post){
 const types={TASK_CHAT_LIST_REQUEST:'TASK_CHAT_LIST_RESULT',TASK_CHAT_PAGE_REQUEST:'TASK_CHAT_PAGE_RESULT',TASK_CHAT_SAVE_REQUEST:'TASK_CHAT_SAVE_RESULT'},type=types[message.type];
 if(!type)return false;
 if(!['PURCHASE','ACCOUNT','WAREHOUSE','SUPPORT'].includes(department)||message.department!==department||!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>16000)return true;
 const envelope={type,company:message.company,department,requestId:message.requestId};
 try{
  const result=message.type==='TASK_CHAT_LIST_REQUEST'?await getTaskChats(message.company,department,message.historyCursor||null):message.type==='TASK_CHAT_PAGE_REQUEST'?await getTaskChatPage(message.company,department,message.input):await saveTaskChat(message.company,department,message.requestId,message.input);
  post({...envelope,ok:true,result});
 }catch(error){const text=String(error?.message||''),safe=text.startsWith('Chat ')||/^CHAT_[A-Z_]+$/.test(text);post({...envelope,ok:false,error:safe?text:'Chat request is unconfirmed. Please retry.'});}
 return true;
}
