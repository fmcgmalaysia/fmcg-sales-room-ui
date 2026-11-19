import { getSecret } from 'wix-secrets-backend';
import { requestPrivateDriveTransport, PRIVATE_DRIVE_ENDPOINT } from 'backend/r2purchaseDocumentClient.js';
// Reuse the tested private transport; chat validates its own response envelope.
export function createTaskChatClient({request=requestPrivateDriveTransport,secret=()=>getSecret('PURCHASE_DOCUMENT_SHARED_SECRET')}={}){
 return async input=>{
  const token=await secret();if(typeof token!=='string'||token.length<32)throw Error('Chat service is not configured.');
  let response=await request(PRIVATE_DRIVE_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,token})});
  for(let hop=0;[301,302,303,307,308].includes(response.status);hop++){
   if(hop>=3)throw Error('Chat service redirect limit.');let url;try{url=new URL(response.location);}catch{throw Error('Chat service redirect rejected.');}
   if(url.protocol!=='https:'||url.hostname!=='script.googleusercontent.com'||url.username||url.password)throw Error('Chat service redirect rejected.');response=await request(url.href,{method:'GET'});
  }
  if(response.status!==200)throw Error('Chat save is unconfirmed. Retry the same request.');let result;try{result=JSON.parse(response.body);}catch{throw Error('Chat save is unconfirmed. Retry the same request.');}
  if(result?.ok!==true)throw Error(/^CHAT_[A-Z_]+$/.test(result?.error||'')?result.error:'Chat save is unconfirmed. Retry the same request.');
  if(result.company!==input.company)throw Error('Chat company receipt does not match.');
  if(input.action==='CHAT_OPERATION'&&(result.kind!==input.kind||result.taskId!==input.taskId||result.summary?.pair!==input.pair))throw Error('Chat task receipt does not match.');
  if(input.action==='CHAT_SUMMARIES'&&(!Array.isArray(result.threads)||result.threads.length!==input.tasks.length||result.threads.some((t,i)=>t.company!==input.company||t.kind!==input.tasks[i].kind||t.taskId!==input.tasks[i].taskId||t.summary?.pair!==input.tasks[i].pair)))throw Error('Chat list receipt does not match.');
  return result;
 };
}
export const requestTaskChat=createTaskChatClient();
