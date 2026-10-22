// Parent-frame bridge only. It cannot change the authenticated department.
(() => {
 window.createPackingTransport=({company,onBusy})=>{
  let parentOrigin='';
  try{const ref=new URL(document.referrer);if(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com','fmcgmalaysia.github.io'].includes(ref.hostname))parentOrigin=ref.origin;}catch(_){}
  const requests=new Map();let pendingSave=null,currentStock=null,submitting=false;
  const busy=()=>onBusy(Boolean(requests.size)||submitting);
  window.addEventListener('message',event=>{
   if(event.source!==parent||event.origin!==parentOrigin)return;
   const message=event.data||{},request=requests.get(message.requestId);
   if(!request||message.company!==request.company||message.type!==request.resultType)return;
   clearTimeout(request.timer);requests.delete(message.requestId);
   if(message.ok!==true){request.reject(Object.assign(Error(message.error||'Request unconfirmed.'),{retryable:true}));busy();return;}
   if(message.result?.ok===false&&!(pendingSave?.stockProtocol===1&&message.result.pending===true&&message.result.requestId===pendingSave.requestId&&['BEFORE','APPLY','VERIFY'].includes(message.result.phase)&&Number.isSafeInteger(message.result.completedCount)&&Number.isSafeInteger(message.result.totalRecords)&&message.result.totalRecords>0&&message.result.completedCount>=0&&message.result.completedCount<=message.result.totalRecords)){request.reject(Object.assign(Error(message.result.error||'Save unconfirmed.'),{retryable:message.result.retryable!==false}));busy();return;}
   request.resolve(message.result);busy();
  });
  function send(message){
   if(!parentOrigin)return Promise.reject(Object.assign(Error('Open this workroom from its official Master page.'),{retryable:false}));
   return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{requests.delete(message.requestId);reject(Object.assign(Error('Request unconfirmed. Retry the same save.'),{retryable:true}));busy();},30000);
    requests.set(message.requestId,{company:message.company,resultType:message.type.replace('_REQUEST','_RESULT'),resolve,reject,timer});busy();parent.postMessage(message,parentOrigin);
   });
  }
  async function submit(){
   if(submitting)throw Error('The original packing save is still processing.');submitting=true;busy();
   try{while(true){const result=await send(pendingSave);if(pendingSave.stockProtocol===1){if(result?.pending===true){await new Promise(resolve=>setTimeout(resolve,250));continue;}if(result?.ok!==true||result.requestId!==pendingSave.requestId||!Number.isSafeInteger(result.stockGeneration)||result.stockGeneration<=pendingSave.stockGeneration||typeof result.id!=='string'||!result.id)throw Object.assign(Error('Packing save unconfirmed. Retry the same save.'),{retryable:true});}pendingSave=null;return result;}}
   catch(error){if(error.retryable===false&&pendingSave?.stockProtocol!==1)pendingSave=null;throw error;}finally{submitting=false;busy();}
  }
  window.addEventListener('beforeunload',event=>{if(pendingSave){event.preventDefault();event.returnValue='';}});
  return {
   read:async()=>{const selectedCompany=company(),result=await send({type:'PACKING_READ_REQUEST',company:selectedCompany,requestId:crypto.randomUUID()});if(result?.stockCurrent!=null){const meta=result.stockCurrent;if(meta.schema!=='CURRENT_STOCK_V2'||meta.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0)throw Error('Current packing form metadata unavailable. Refresh.');currentStock={company:selectedCompany,stockProtocol:1,stockBuild:meta.stockBuild,stockGeneration:meta.stockGeneration};}else currentStock=null;return result;},
   save:input=>{if(pendingSave)throw Error('Retry or confirm the previous save before starting another.');if(currentStock&&currentStock.company!==company())throw Error('Company changed. Refresh packing before saving.');pendingSave={type:'PACKING_SAVE_REQUEST',company:company(),requestId:crypto.randomUUID(),input:currentStock?JSON.parse(JSON.stringify(input)):input,...(currentStock?{stockProtocol:1,stockBuild:currentStock.stockBuild,stockGeneration:currentStock.stockGeneration}:{})};return submit();},
   retry:()=>{if(!pendingSave)throw Error('There is no pending save.');return submit();},
   hasPending:()=>Boolean(pendingSave),
   login:department=>{if(parentOrigin)parent.postMessage({type:department==='WAREHOUSE'?'WAREHOUSE_LOGIN_REQUEST':'FULFILMENT_LOGIN_REQUEST'},parentOrigin);}
  };
 };
})();
