// Parent-frame bridge only. It cannot change the authenticated department.
(() => {
 window.createPackingTransport=({company,onBusy})=>{
  let parentOrigin='';
  try{const ref=new URL(document.referrer);if(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com','fmcgmalaysia.github.io'].includes(ref.hostname))parentOrigin=ref.origin;}catch(_){}
  const requests=new Map();let pendingSave=null;
  const busy=()=>onBusy(Boolean(requests.size));
  window.addEventListener('message',event=>{
   if(event.source!==parent||event.origin!==parentOrigin)return;
   const message=event.data||{},request=requests.get(message.requestId);
   if(!request||message.company!==request.company||message.type!==request.resultType)return;
   clearTimeout(request.timer);requests.delete(message.requestId);
   if(message.ok!==true){request.reject(Object.assign(Error(message.error||'Request unconfirmed.'),{retryable:true}));busy();return;}
   if(message.result?.ok===false){request.reject(Object.assign(Error(message.result.error||'Save unconfirmed.'),{retryable:message.result.retryable!==false}));busy();return;}
   request.resolve(message.result);busy();
  });
  function send(message){
   if(!parentOrigin)return Promise.reject(Object.assign(Error('Open this workroom from its official Master page.'),{retryable:false}));
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{requests.delete(message.requestId);reject(Object.assign(Error('Request unconfirmed. Retry the same save.'),{retryable:true}));busy();},30000);
    requests.set(message.requestId,{company:message.company,resultType:message.type.replace('_REQUEST','_RESULT'),resolve,reject,timer});busy();parent.postMessage(message,parentOrigin);
   });
  }
  async function submit(){
   try{const result=await send(pendingSave);pendingSave=null;busy();return result;}
   catch(error){if(error.retryable===false)pendingSave=null;busy();throw error;}
  }
  window.addEventListener('beforeunload',event=>{if(pendingSave){event.preventDefault();event.returnValue='';}});
  return {
   read:()=>send({type:'PACKING_READ_REQUEST',company:company(),requestId:crypto.randomUUID()}),
   save:input=>{if(pendingSave)throw Error('Retry or confirm the previous save before starting another.');pendingSave={type:'PACKING_SAVE_REQUEST',company:company(),requestId:crypto.randomUUID(),input};return submit();},
   retry:()=>{if(!pendingSave)throw Error('There is no pending save.');return submit();},
   hasPending:()=>Boolean(pendingSave),
   login:department=>{if(parentOrigin)parent.postMessage({type:department==='WAREHOUSE'?'WAREHOUSE_LOGIN_REQUEST':'FULFILMENT_LOGIN_REQUEST'},parentOrigin);}
  };
 };
})();
