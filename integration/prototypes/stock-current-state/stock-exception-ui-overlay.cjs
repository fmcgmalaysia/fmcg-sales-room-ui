'use strict';
// Shared minimum overlay for the ORIGINAL three-department stock dialog/relay.
function once(source,before,after){if(source.split(before).length!==2)throw Error('Exact original stock dialog/relay anchor changed: '+before.slice(0,80));return source.replace(before,()=>after);}
const helpers=`
let stockMeta=null,stockActor=null,stockReadKind='',stockFinal=null,stockFlight=false,stockSerial=0,stockSteps=0,stockBlocked=false,stockCompanyLock=null;
const stockSame=(a,b)=>JSON.stringify(a)===JSON.stringify(b),stockClone=value=>JSON.parse(JSON.stringify(value));
const stockIdentity=value=>value&&Object.keys(value).length===2&&['staffId','memberId'].every(key=>typeof value[key]==='string'&&value[key]&&value[key].length<=200);
const stockCacheKey=(selected,actor)=>'fmcg-stock-exception-current-v1/'+selected+'/'+encodeURIComponent(actor.staffId)+'/'+encodeURIComponent(actor.memberId);
function stockRequest(request){return request&&Object.keys(request).every(key=>['type','company','requestId','input','stockProtocol','stockBuild','stockGeneration','stockIdentity'].includes(key))
 &&request.type==='STOCK_SAVE_REQUEST'&&['NCT','GHR'].includes(request.company)&&/^[a-f0-9-]{36}$/i.test(request.requestId||'')&&stockIdentity(request.stockIdentity)
 &&request.stockProtocol===1&&typeof request.stockBuild==='string'&&request.stockBuild&&Number.isSafeInteger(request.stockGeneration)&&request.stockGeneration>=0
 &&request.input&&typeof request.input==='object'&&!Array.isArray(request.input)&&['QUARANTINE','DECIDE','RETURN','REPLACEMENT','APPROVE_LOSS','APPROVE_VARIANCE','APPROVE_RELEASE','CLOSE'].includes(request.input.action)
 &&typeof request.input.version==='string'&&request.input.version&&JSON.stringify(request).length<=200000;}
function stockSelectLock(value){const select=document.getElementById('companySelect')||document.getElementById('company');if(!select)return;
 if(value){if(stockCompanyLock===null)stockCompanyLock=Boolean(select.disabled);select.disabled=true;}else if(stockCompanyLock!==null){select.disabled=stockCompanyLock;stockCompanyLock=null;}}
function stockRetained(create){const key=stockCacheKey(pending.company,pending.stockIdentity),raw=sessionStorage.getItem(key);
 if(raw!==null){const cached=JSON.parse(raw);if(cached.schema!==1||!stockSame(cached.request,pending))throw Error('Original stock cache changed');return key;}
 if(!create)throw Error('Original stock cache missing');const cached={schema:1,request:stockClone(pending)};sessionStorage.setItem(key,JSON.stringify(cached));
 if(!stockSame(JSON.parse(sessionStorage.getItem(key)||'null'),cached))throw Error('Original stock cache unconfirmed');return key;}
function stockUnknown(text){stockFlight=false;stockFinal=null;lock(false);stockSelectLock(true);error(text||stockCopy('Save unconfirmed. Original request retained; retry this same save.','保存尚未确认，已保留原请求，请重试同一次保存。'));}
function stockRecovery(){stockSelectLock(true);shell('<p>'+esc(stockCopy('Original stock save retained. No automatic retry.','原库存请求已保留，不会自动重试。'))+'</p><p>'+esc(pending.input.action)+' · '+esc(pending.requestId)+'</p>',
 '<button data-save class="primary">'+esc(stockCopy('Retry same save','重试原保存'))+'</button>');dialog.querySelector('[data-save]').onclick=save;lock(false);}
function stockSend(){if(!stockRequest(pending)||pending.company!==companyValue()||!stockSame(pending.stockIdentity,stockActor)||stockBlocked){stockUnknown(stockCopy('Original identity or request unconfirmed. Preserve this tab.','原身份或请求尚未确认，请保留此页。'));return;}
 if(stockFlight||stockFinal)return;
 try{stockRetained(true);}catch(_){stockUnknown(stockCopy('Not sent: browser cache unconfirmed. Retry this same request.','尚未发送：浏览器暂存未确认，请重试同一次请求。'));return;}
 const original=pending,segment=++stockSerial;stockFlight=true;lock(true);stockSelectLock(true);error(stockCopy('Saving original request…','正在保存原请求…'));
 try{parent.postMessage({...stockClone(pending),stockSegment:segment},'*');}catch(_){stockUnknown();return;}
 clearTimeout(timer);timer=setTimeout(()=>{if(pending===original&&stockSerial===segment&&stockFlight)stockUnknown();},30000);
}
function stockResponse(message){
 if(companyValue()!==company)return true;
 if(message.type==='STOCK_READ_RESULT'&&message.requestId===readId){
  clearTimeout(timer);const result=message.result;
  if(stockReadKind==='IDENTITY'){
   if(!message.ok||result?.ok!==true||result.company!==company||result.schema!=='STOCK_EXCEPTION_ORIGINAL_CONTEXT_V1'||!result.staff?.staffName||!stockIdentity({staffId:result.staff.staffId,memberId:result.staff.memberId})){
    error(stockCopy('Original staff identity unconfirmed. Retry reading.','原员工身份尚未确认，请重试读取。'));return true;}
   stockActor={staffId:result.staff.staffId,memberId:result.staff.memberId};
   try{const raw=sessionStorage.getItem(stockCacheKey(company,stockActor));if(raw!==null){const cached=JSON.parse(raw);
    if(cached.schema!==1||!stockRequest(cached.request)||cached.request.company!==company||!stockSame(cached.request.stockIdentity,stockActor))throw Error('Invalid original stock cache');
    pending=stockClone(cached.request);stockRecovery();return true;}
   }catch(_){stockBlocked=true;stockSelectLock(true);error(stockCopy('Original cache requires review. No new save was started.','原暂存需要核对，未开始新保存。'));return true;}
   read();return true;
  }
  if(!message.ok||!result||result.company!==company||!Array.isArray(result.cases)||!Array.isArray(result.sources)){
   if(pending?.stockProtocol===1)stockUnknown(stockCopy('Save or fresh stock unconfirmed. Original request retained.','保存或最新库存尚未确认，已保留原请求。'));else error(stockCopy('Stock read unconfirmed. Please retry.','库存读取尚未确认，请重试。'));return true;}
  const meta=result.stockCurrent;
  if(meta!==undefined&&(!meta||meta.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0||!stockIdentity(meta.stockIdentity)||!stockSame(meta.stockIdentity,stockActor))){
   if(pending)stockUnknown();else error(stockCopy('Current stock identity unconfirmed. Refresh.','当前库存身份尚未确认，请刷新。'));return true;}
  if(pending?.stockProtocol===1){
   if(!stockFinal||!meta||meta.stockBuild!==pending.stockBuild||!stockSame(meta.stockIdentity,pending.stockIdentity)||meta.stockGeneration<stockFinal.stockGeneration){stockUnknown();return true;}
   const savedCase=result.cases.find(item=>item.id===stockFinal.caseId);
   if(!savedCase||pending.input.action==='QUARANTINE'&&(savedCase.sourceTaskId!==pending.input.sourceTaskId||savedCase.quantity!==pending.input.quantity||savedCase.kind!==pending.input.kind||savedCase.byStaffId!==pending.stockIdentity.staffId)){stockUnknown();return true;}
   try{const key=stockRetained(false);sessionStorage.removeItem(key);if(sessionStorage.getItem(key)!==null)throw Error('Cleanup unconfirmed');}
   catch(_){stockUnknown(stockCopy('Save recorded; cache cleanup unconfirmed. Retry original request.','保存已记录，暂存清理尚未确认，请重试原请求。'));return true;}
   pending=null;stockFinal=null;stockFlight=false;stockSteps=0;lock(false);stockSelectLock(false);changed=true;stockMeta=stockClone(meta);data=result;list();return true;
  }
  stockMeta=meta===undefined?null:stockClone(meta);return false;
 }
 if(message.type!=='STOCK_SAVE_RESULT'||pending?.stockProtocol!==1)return false;
 if(message.requestId!==pending.requestId||message.stockSegment!==stockSerial)return true;
 if(!stockFlight||stockFinal)return true;clearTimeout(timer);const result=message.result;
 if(message.ok&&result?.ok===true&&result.pending!==true&&result.requestId===pending.requestId&&result.company===pending.company&&typeof result.caseId==='string'&&result.caseId
  &&(pending.input.action==='QUARANTINE'||result.caseId===pending.input.id)&&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>pending.stockGeneration){
  stockFlight=false;stockFinal=stockClone(result);lock(true);error(stockCopy('Save recorded. Checking current stock…','保存已记录，正在核对最新库存…'));read(false,true);return true;
 }
 if(message.ok&&result?.ok===false&&result.pending===true&&result.requestId===pending.requestId&&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)
  &&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.totalRecords<=1000000&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
  stockFlight=false;if(++stockSteps>64){stockUnknown(stockCopy('Automatic progress paused. Retry only this original save.','自动续接已暂停，请只重试原保存。'));return true;}
  error(stockCopy('Saving… ','正在保存… ')+result.completedCount+' / '+result.totalRecords);const original=pending,segment=stockSerial;
  setTimeout(()=>{if(pending===original&&stockSerial===segment&&!stockFlight&&!stockFinal)stockSend();},250);return true;
 }
 stockUnknown();return true;
}
const stockCompanySelect=document.getElementById('companySelect')||document.getElementById('company');
stockCompanySelect?.addEventListener('change',event=>{if(pending||stockBlocked){event.target.value=company;event.stopImmediatePropagation?.();}},true);
window.addEventListener('beforeunload',event=>{if(pending?.stockProtocol===1||stockBlocked){event.preventDefault();event.returnValue='';}});
`;
function patchStockExceptionDialog(source){
 source=once(source,"let company='',data=null,pending=null,busy=false,readId='',timer,changed=false,form=null;","let company='',data=null,pending=null,busy=false,readId='',timer,changed=false,form=null;\n"+helpers);
 source=once(source,'function close(){if(busy||pending){','function close(){if(busy||pending||stockBlocked){');
 const a=source.indexOf('function read(){'),b=source.indexOf('\nfunction open(){',a);if(a<0||b<a)throw Error('Original stock read anchor changed');
 source=source.slice(0,a)+`function read(identityOnly=false,verify=false){if(pending&&!verify)return;stockReadKind=identityOnly?'IDENTITY':verify?'VERIFY':'DATA';readId=crypto.randomUUID();
 parent.postMessage({type:'STOCK_READ_REQUEST',company,requestId:readId,...(identityOnly?{readOptions:{contextOnly:true}}:{})},'*');clearTimeout(timer);const id=readId;
 timer=setTimeout(()=>{if(readId!==id)return;if(pending?.stockProtocol===1)stockUnknown();else error(stockCopy('Read is not confirmed. Please retry.','读取尚未确认，请重试。'));dialog.querySelector('[data-reload]')?.removeAttribute('disabled');},30000);}`+source.slice(b);
 source=once(source,"company=companyValue();data=null;form=null;","company=companyValue();data=null;form=null;stockMeta=null;stockActor=null;stockFinal=null;stockReadKind='';");
 source=once(source,'dialog.showModal();read();}','dialog.showModal();dialog.querySelector(\'[data-reload]\').onclick=()=>read(true);read(true);}');
 source=once(source,"pending={type:'STOCK_SAVE_REQUEST',company,requestId:crypto.randomUUID(),input};}","pending={type:'STOCK_SAVE_REQUEST',company,requestId:crypto.randomUUID(),input};if(stockMeta)pending=stockClone({...pending,...stockMeta});}");
 source=once(source," error('');lock(true);parent.postMessage(pending,'*');", " if(pending.stockProtocol===1){stockSteps=0;stockSend();return;}\n error('');lock(true);parent.postMessage(pending,'*');");
 source=once(source,' if(message.company!==company)return;',' if(message.company!==company)return;\n if(stockResponse(message))return;');
 // Existing Account English selection and ALL form builders remain byte-exact.
 new Function(source);return source;
}
function patchStockExceptionParent(source){return once(source,"    if(['STOCK_READ_REQUEST','STOCK_SAVE_REQUEST'].includes(message.type)){",`    if(message.type==='STOCK_READ_REQUEST'&&message.readOptions!==undefined){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message).length>1000)throw Error('Invalid stock identity request');
        const result=await getStockExceptions(message.company,message.readOptions);room.postMessage({type:'STOCK_READ_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(_){room.postMessage({type:'STOCK_READ_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original stock identity unconfirmed.'});}return;
    }
    if(message.type==='STOCK_SAVE_REQUEST'&&message.stockProtocol!==undefined){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||message.stockProtocol!==1||!Number.isSafeInteger(message.stockSegment)||message.stockSegment<1||message.stockSegment>1000000||JSON.stringify(message).length>200000)throw Error('Invalid original current stock save');
        const metadata={stockProtocol:message.stockProtocol,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity};
        const result=await saveStockException(message.company,message.requestId,message.input,metadata);room.postMessage({type:'STOCK_SAVE_RESULT',company:message.company,requestId:message.requestId,stockSegment:message.stockSegment,ok:true,result});
      }catch(_){room.postMessage({type:'STOCK_SAVE_RESULT',company:message.company,requestId:message.requestId,stockSegment:message.stockSegment,ok:false,error:'Original stock save unconfirmed; retain the same request.'});}return;
    }
    if(['STOCK_READ_REQUEST','STOCK_SAVE_REQUEST'].includes(message.type)){`);}
function patchStockExceptionIndex(source){const pattern=/<script src="\.\.\/master-shared\/stock-exceptions\.js\?v=[^"]+"><\/script>/g;
 if((source.match(pattern)||[]).length!==1)throw Error('Exact original common stock dialog script required');return source.replace(pattern,'<script src="stock-exceptions.js?v=20261023-current-exception-v1"></script>');}
module.exports={patchStockExceptionDialog,patchStockExceptionParent,patchStockExceptionIndex};
