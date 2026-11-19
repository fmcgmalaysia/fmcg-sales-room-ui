// Parent-frame bridge only. It cannot change the authenticated department.
(() => {
 window.createPackingTransport=({company,department,onBusy})=>{
  let parentOrigin='';
  try{const ref=new URL(document.referrer);if(['fmcg999.wixstudio.com','fmcg999-master.editor.wix.com','fmcgmalaysia.github.io'].includes(ref.hostname))parentOrigin=ref.origin;}catch(_){}
  const requests=new Map();let pendingSave=null,currentStock=null,submitting=false,packingStaff=null,currentReadRequired=false,packingReadSerial=0;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const ownDepartment=()=>{const value=department?.();if(!['SUPPORT','WAREHOUSE'].includes(value))throw Error('Original packing department required.');return value;};
  function address(selected,staff){if(!['NCT','GHR'].includes(selected)||['staffId','memberId'].some(key=>typeof staff?.[key]!=='string'||!staff[key]||staff[key].length>200))throw Error('Original packing staff required.');return'fmcg-packing-save-v1/'+ownDepartment()+'/'+selected+'/'+staff.staffId+'/'+staff.memberId;}
  function valid(request,selected,staff){return request?.type==='PACKING_SAVE_REQUEST'&&request.company===selected&&/^[a-f0-9-]{36}$/i.test(request.requestId||'')
   &&request.stockProtocol===1&&typeof request.stockBuild==='string'&&!!request.stockBuild&&Number.isSafeInteger(request.stockGeneration)&&request.stockGeneration>=0
   &&request.input&&typeof request.input==='object'&&!Array.isArray(request.input)&&request.stockIdentity&&Object.keys(request.stockIdentity).length===2
   &&request.stockIdentity.staffId===staff.staffId&&request.stockIdentity.memberId===staff.memberId
   &&Object.keys(request).every(key=>['type','company','requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))&&JSON.stringify(request).length<=3100000;}
  function cached(selected,staff){const row=JSON.parse(sessionStorage.getItem(address(selected,staff))||'null');if(row===null)return null;
   if(row.department!==ownDepartment()||!valid(row.request,selected,staff))throw Error('Original packing cache requires review.');return row.request;}
  function retain(){if(!valid(pendingSave,pendingSave?.company,packingStaff))throw Error('Original packing request identity required.');
   const key=address(pendingSave.company,packingStaff),prior=cached(pendingSave.company,packingStaff);if(prior&&!same(prior,pendingSave))throw Error('Another original packing request is retained.');
   if(!prior)sessionStorage.setItem(key,JSON.stringify({department:ownDepartment(),request:pendingSave}));if(!same(cached(pendingSave.company,packingStaff),pendingSave))throw Error('Original packing request not retained.');}
  function clearRetained(){const key=address(pendingSave.company,packingStaff);if(!same(cached(pendingSave.company,packingStaff),pendingSave))throw Error('Original packing request changed.');
   sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)throw Error('Original packing cache cleanup unconfirmed.');}
  async function recover(){
   if(submitting||pendingSave)return Boolean(pendingSave);const selected=company(),dept=ownDepartment();
   const result=await send({type:'PACKING_RESUME_CONTEXT_REQUEST',company:selected,requestId:crypto.randomUUID()});
   if(company()!==selected||ownDepartment()!==dept||result?.ok!==true||result.company!==selected||result.department!==dept||result.schema!=='PACKING_RESUME_CONTEXT_V1'||result.staff?.packingDepartment!==dept||!result.staff.staffName)throw Error('Original packing recovery identity unconfirmed.');
   packingStaff=result.staff;const original=cached(selected,packingStaff);if(original){pendingSave=original;currentReadRequired=true;busy();}return Boolean(original);
  }
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
   return new Promise((resolve,reject)=>{const previousRequest=requests.get(message.requestId);const timer=setTimeout(()=>{if(requests.get(message.requestId)?.timer!==timer)return;requests.delete(message.requestId);reject(Object.assign(Error('Request unconfirmed. Retry the same save.'),{retryable:true}));busy();},30000);
    if(previousRequest){clearTimeout(timer);reject(Error('The same request is still processing.'));return;}requests.set(message.requestId,{company:message.company,resultType:message.type.replace('_REQUEST','_RESULT'),resolve,reject,timer});busy();parent.postMessage(message,parentOrigin);
   });
  }
  async function submit(){
   if(submitting)throw Error('The original packing save is still processing.');submitting=true;busy();
   try{while(true){if(pendingSave.stockProtocol===1)retain();const result=await send(pendingSave);if(pendingSave.stockProtocol===1){if(result?.pending===true){await new Promise(resolve=>setTimeout(resolve,250));continue;}if(result?.ok!==true||result.requestId!==pendingSave.requestId||!Number.isSafeInteger(result.stockGeneration)||result.stockGeneration<=pendingSave.stockGeneration||typeof result.id!=='string'||!result.id||result.company!==pendingSave.company||pendingSave.input.action!=='CREATE'&&result.id!==pendingSave.input.id)throw Object.assign(Error('Packing save unconfirmed. Retry the same save.'),{retryable:true});clearRetained();currentStock=null;currentReadRequired=true;}pendingSave=null;return result;}}
   catch(error){if(error.retryable===false&&pendingSave?.stockProtocol!==1)pendingSave=null;throw error;}finally{submitting=false;busy();}
  }
  window.addEventListener('beforeunload',event=>{if(pendingSave){event.preventDefault();event.returnValue='';}});
  return {
   read:async()=>{if(pendingSave)throw Error('Retry the original packing request before reading.');const selectedCompany=company(),readAttempt=++packingReadSerial;let result;
    try{result=await send({type:'PACKING_READ_REQUEST',company:selectedCompany,requestId:crypto.randomUUID()});}catch(error){if(await recover())throw Error('Original packing request retained. Retry the same save.');throw error;}
    if(company()!==selectedCompany||readAttempt!==packingReadSerial)throw Error('Packing company or read changed during read.');if(result?.stockCurrent!=null){const meta=result.stockCurrent;if(result.company!==selectedCompany||result.department!==ownDepartment()||result.staff?.packingDepartment!==ownDepartment())throw Error('Original packing response identity unconfirmed.');packingStaff=result.staff;if(meta.schema!=='CURRENT_STOCK_V2'||meta.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0)throw Error('Current packing form metadata unavailable. Refresh.');currentStock={company:selectedCompany,stockProtocol:1,stockBuild:meta.stockBuild,stockGeneration:meta.stockGeneration};const original=cached(selectedCompany,packingStaff);if(original){pendingSave=original;busy();throw Error('Original packing request retained. Retry the same save.');}}else currentStock=null;currentReadRequired=false;return result;},
   recover,save:input=>{if(currentReadRequired)throw Error('Refresh current packing before another save.');if(pendingSave)throw Error('Retry or confirm the previous save before starting another.');if(currentStock&&currentStock.company!==company())throw Error('Company changed. Refresh packing before saving.');pendingSave={type:'PACKING_SAVE_REQUEST',company:company(),requestId:crypto.randomUUID(),input:currentStock?JSON.parse(JSON.stringify(input)):input,...(currentStock?{stockProtocol:1,stockBuild:currentStock.stockBuild,stockGeneration:currentStock.stockGeneration,stockIdentity:{staffId:packingStaff.staffId,memberId:packingStaff.memberId}}:{})};return submit();},
   retry:()=>{if(!pendingSave)throw Error('There is no pending save.');return submit();},
   hasPending:()=>Boolean(pendingSave),
   login:department=>{if(parentOrigin)parent.postMessage({type:department==='WAREHOUSE'?'WAREHOUSE_LOGIN_REQUEST':'FULFILMENT_LOGIN_REQUEST'},parentOrigin);}
  };
 };
})();
