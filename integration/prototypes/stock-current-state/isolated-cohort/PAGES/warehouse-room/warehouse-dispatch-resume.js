/* Own-tab original dispatch only: no stock read, key enumeration, grant or unlock. */
(()=>{'use strict';
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function valid(request,company){return request?.type==='FULFILMENT_SAVE_REQUEST'&&request.company===company
  &&/^[a-f0-9-]{36}$/i.test(request.requestId||'')&&request.stockProtocol===1&&typeof request.stockBuild==='string'&&!!request.stockBuild
  &&Number.isSafeInteger(request.stockGeneration)&&request.stockGeneration>=0&&request.input?.action==='DISPATCH'
  &&['id','version','reference','reason'].every(field=>typeof request.input[field]==='string'&&!!request.input[field])
  &&['staffId','memberId'].every(field=>typeof request.stockIdentity?.[field]==='string'&&!!request.stockIdentity[field])
  &&Object.keys(request).every(key=>['type','company','requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))&&JSON.stringify(request).length<=200000;}
 function key(company,staff){if(!['NCT','GHR'].includes(company)||['staffId','memberId'].some(field=>typeof staff?.[field]!=='string'||!staff[field]))throw Error('Original dispatch identity required');return 'fmcg-warehouse-dispatch-v1/'+company+'/'+staff.staffId+'/'+staff.memberId;}
 function pending(company,staff){const cached=JSON.parse(sessionStorage.getItem(key(company,staff))||'null');if(cached===null)return null;
  if(!valid(cached,company)||cached.stockIdentity.staffId!==staff.staffId||cached.stockIdentity.memberId!==staff.memberId)throw Error('Original dispatch cache requires review');return cached;}
 function retain(request,staff){if(!valid(request,request?.company)||request.stockIdentity.staffId!==staff?.staffId||request.stockIdentity.memberId!==staff?.memberId)throw Error('Original dispatch session changed');
  const address=key(request.company,staff),cached=pending(request.company,staff);if(cached&&!same(cached,request))throw Error('Another original dispatch is retained');
  if(!cached)sessionStorage.setItem(address,JSON.stringify(request));if(!same(pending(request.company,staff),request))throw Error('Original dispatch not retained');}
 function clear(request,staff){const address=key(request.company,staff);if(!same(pending(request.company,staff),request))throw Error('Original dispatch cache changed');
  sessionStorage.removeItem(address);if(sessionStorage.getItem(address)!==null)throw Error('Original dispatch cache cleanup unconfirmed');}
 async function recover(company){
  if(!['NCT','GHR'].includes(company))throw Error('Original dispatch company required');const requestId=crypto.randomUUID();
  const result=await new Promise((resolve,reject)=>{
   let timer;const done=()=>{clearTimeout(timer);window.removeEventListener('message',reply);};
   function reply(event){const message=event.data||{};if(event.source!==window.parent||message.type!=='WAREHOUSE_DISPATCH_RESUME_RESULT'||message.company!==company||message.requestId!==requestId)return;
    done();message.ok?resolve(message.result):reject(Error('Original dispatch identity unconfirmed'));}
   window.addEventListener('message',reply);timer=setTimeout(()=>{done();reject(Error('Original dispatch identity timed out'));},30000);
   window.parent.postMessage({type:'WAREHOUSE_DISPATCH_RESUME_REQUEST',company,requestId},'*');
  });
  if(result?.ok!==true||result.schema!=='WAREHOUSE_DISPATCH_RESUME_V1'||result.company!==company||typeof result.staff?.staffName!=='string'||!result.staff.staffName)throw Error('Original dispatch identity unconfirmed');
  return{staff:result.staff,request:pending(company,result.staff)};
 }
 window.warehouseCurrentDispatch={valid,pending,retain,clear,recover};
})();
