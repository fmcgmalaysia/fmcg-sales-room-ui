'use strict';
module.exports=function packingDurableOverlay(source){
 function once(before,after){if(source.split(before).length!==2)throw Error('Exact current packing durability anchor changed: '+before.slice(0,80));source=source.replace(before,()=>after);}
 once('({company,onBusy})=>{','({company,department,onBusy})=>{');
 once('pendingSave=null,currentStock=null,submitting=false;','pendingSave=null,currentStock=null,submitting=false,packingStaff=null,currentReadRequired=false,packingReadSerial=0;');
 once('  const busy=()=>',`  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
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
  const busy=()=>`);
 once("const timer=setTimeout(()=>{requests.delete(message.requestId);", "const previousRequest=requests.get(message.requestId);const timer=setTimeout(()=>{if(requests.get(message.requestId)?.timer!==timer)return;requests.delete(message.requestId);");
 once("requests.set(message.requestId,{company:message.company", "if(previousRequest){clearTimeout(timer);reject(Error('The same request is still processing.'));return;}requests.set(message.requestId,{company:message.company");
 once('try{while(true){const result=await send(pendingSave);', 'try{while(true){if(pendingSave.stockProtocol===1)retain();const result=await send(pendingSave);');
 once("typeof result.id!=='string'||!result.id)","typeof result.id!=='string'||!result.id||result.company!==pendingSave.company||pendingSave.input.action!=='CREATE'&&result.id!==pendingSave.input.id)");
 once('}pendingSave=null;return result;}}', 'clearRetained();currentStock=null;currentReadRequired=true;}pendingSave=null;return result;}}');
 // Previous replacement moves cleanup inside the CURRENT branch, not legacy.
 once("if(result?.stockCurrent!=null){const meta=result.stockCurrent;", "if(result?.stockCurrent!=null){const meta=result.stockCurrent;if(result.company!==selectedCompany||result.department!==ownDepartment()||result.staff?.packingDepartment!==ownDepartment())throw Error('Original packing response identity unconfirmed.');packingStaff=result.staff;");
 once('}else currentStock=null;return result;},', "const original=cached(selectedCompany,packingStaff);if(original){pendingSave=original;busy();throw Error('Original packing request retained. Retry the same save.');}}else currentStock=null;currentReadRequired=false;return result;},");
 once("read:async()=>{const selectedCompany=company(),result=await send({type:'PACKING_READ_REQUEST',company:selectedCompany,requestId:crypto.randomUUID()});",`read:async()=>{if(pendingSave)throw Error('Retry the original packing request before reading.');const selectedCompany=company(),readAttempt=++packingReadSerial;let result;
    try{result=await send({type:'PACKING_READ_REQUEST',company:selectedCompany,requestId:crypto.randomUUID()});}catch(error){if(await recover())throw Error('Original packing request retained. Retry the same save.');throw error;}
    if(company()!==selectedCompany||readAttempt!==packingReadSerial)throw Error('Packing company or read changed during read.');`);
 once("save:input=>{if(pendingSave)","recover,save:input=>{if(currentReadRequired)throw Error('Refresh current packing before another save.');if(pendingSave)");
 once('stockGeneration:currentStock.stockGeneration}:{})','stockGeneration:currentStock.stockGeneration,stockIdentity:{staffId:packingStaff.staffId,memberId:packingStaff.memberId}}:{})');
 return source;
};
