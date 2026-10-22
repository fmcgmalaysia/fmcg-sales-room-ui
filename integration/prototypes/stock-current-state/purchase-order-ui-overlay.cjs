'use strict';
// Original PO dialogs and original Purchase request cache/tracker only.
module.exports = function overlay(source) {
  const once = (before, after) => { if (source.split(before).length !== 2) throw Error('Exact current PO UI anchor changed: ' + before.slice(0, 80)); source = source.replace(before, () => after); };
  const helpers = `  let currentOrderProgressOwner=null,currentOrderContinuations=0;
  const currentOrderActions=['TERM','ACK_PAYMENT','REQUEST_PAYMENT','SUBMIT_FINANCE','WITHDRAW_FINANCE','REQUEST_RETURN','DOCUMENT_ISSUE_RESPONSE'];
  function currentOrderMetadata(kind,args){
    if(kind!=='PURCHASE_ORDER_SAVE_REQUEST'||data?.stockCurrent?.stockProtocol!==1&&poData?.stockCurrent?.stockProtocol!==1)return null;
    const meta=poData?.stockCurrent,row=poData?.orders?.find(row=>row.id===args?.input?.id);
    if(data?.stockCurrent?.stockProtocol!==1||!Number.isSafeInteger(data.stockCurrent.stockGeneration)||data.stockCurrent.stockGeneration<0||poData?.company!==company||meta?.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild
      ||meta.stockBuild!==data.stockCurrent.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0||meta.stockGeneration<data.stockCurrent.stockGeneration
      ||!data.staff?.staffId||!data.staff?.memberId||meta.stockIdentity?.staffId!==data.staff.staffId||meta.stockIdentity?.memberId!==data.staff.memberId
      ||!row||row.version!==args.input.version||!currentOrderActions.includes(args.input.action)){
      showStatus('Original purchase order save not started. Refresh its data; file operations are not connected yet. 原采购单保存未开始，请刷新资料；文件操作尚未接入。',true);return false;
    }
    return {stockProtocol:1,stockBuild:meta.stockBuild,stockGeneration:meta.stockGeneration,stockIdentity:{staffId:meta.stockIdentity.staffId,memberId:meta.stockIdentity.memberId}};
  }
  function currentOrderSuccess(request,result){return request?.type==='PURCHASE_ORDER_SAVE_REQUEST'&&result?.ok===true&&result.pending!==true
    &&result.requestId===request.requestId&&result.company===request.company&&result.poId===request.input?.id
    &&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>request.stockGeneration;}
  function retainCurrentOrder(request){
    try{if(!draftKey||draftKey!=='fmcg-purchase-draft-v1/'+company+'/'+data?.staff?.staffId+'/'+data?.staff?.memberId
        ||request.company!==company||request.stockIdentity?.staffId!==data.staff.staffId||request.stockIdentity?.memberId!==data.staff.memberId)throw Error('Original PO identity unavailable');
      cacheDraft();if(JSON.stringify(JSON.parse(sessionStorage.getItem(draftKey)||'null')?.savePending)!==JSON.stringify(request))throw Error('Original PO request not retained');return true;
    }catch(_){saveInFlight=false;saveButtonState(false);showStatus('Purchase order save not sent; check browser storage and retry this request. 采购单保存未发送，请检查浏览器暂存并重试原请求。',true);paintSaveTracker();return false;}
  }
  function clearCurrentOrderCache(request){
    try{const cached=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(!cached||JSON.stringify(cached.savePending)!==JSON.stringify(request))throw Error('Original PO cache changed');
      const next={...cached,savePending:null,saveAttemptCount:null,saveOrigin:null,saveIssue:''};sessionStorage.setItem(draftKey,JSON.stringify(next));
      if(JSON.stringify(JSON.parse(sessionStorage.getItem(draftKey)||'null'))!==JSON.stringify(next))throw Error('Original PO cleanup unconfirmed');return true;
    }catch(_){saveInFlight=false;saveButtonState(false);showStatus('Purchase order result recorded; cache cleanup unconfirmed. Retain and retry the same request. 采购单结果已记录，暂存清理尚未确认，请保留并重试原请求。',true);paintSaveTracker();return false;}
  }
`;
  once('  let currentSegmentSerial=0,', helpers + '  let currentSegmentSerial=0,');
  once("saveIssue='';saveOrigin={view,customerId,activeCustomer};", "const orderMeta=currentOrderMetadata(kind,args);if(orderMeta===false)return;saveIssue='';saveOrigin={view,customerId,activeCustomer};");
  once('...(data?.stockCurrent?.stockProtocol===1?{stockProtocol:1,stockBuild:data.stockCurrent.stockBuild,stockGeneration:data.stockCurrent.stockGeneration}:{})',
    '...(orderMeta||(data?.stockCurrent?.stockProtocol===1?{stockProtocol:1,stockBuild:data.stockCurrent.stockBuild,stockGeneration:data.stockCurrent.stockGeneration}:{}))');
  once("if(current.operation==='COST_REFERENCE'&&!retainCurrentCost(current))return;saveInFlight=true;",
    "if(current.operation==='COST_REFERENCE'&&!retainCurrentCost(current))return;if(current.stockProtocol===1&&current.type==='PURCHASE_ORDER_SAVE_REQUEST'&&!retainCurrentOrder(current))return;saveInFlight=true;");
  once('const completed=savePending,allocationHandled=', "if(savePending?.stockProtocol===1&&savePending.type==='PURCHASE_ORDER_SAVE_REQUEST'&&(!currentOrderSuccess(savePending,result)||!clearCurrentOrderCache(savePending))){saveInFlight=false;saveButtonState(false);showStatus('Purchase order result unconfirmed; original request retained. 采购单结果尚未确认，原请求保留。',true);paintSaveTracker();return;}const completed=savePending,allocationHandled=");
  once('    if(savePending.stockProtocol===1){const current=savePending,result=message.result;',
    "    if(savePending.stockProtocol===1){const current=savePending,result=message.result;if(current.type==='PURCHASE_ORDER_SAVE_REQUEST'&&result?.ok===true&&!currentOrderSuccess(current,result)){saveInFlight=false;saveButtonState(false);showStatus('Purchase order receipt identity unconfirmed; original request retained. 采购单回执身份尚未确认，原请求保留。',true);paintSaveTracker();return;}");
  once("{if(current.operation==='COST_REFERENCE'){if(currentCostProgressOwner!==current)",
    "{if(current.type==='PURCHASE_ORDER_SAVE_REQUEST'){if(currentOrderProgressOwner!==current){currentOrderProgressOwner=current;currentOrderContinuations=0;}if(!saveInFlight||++currentOrderContinuations>64){saveInFlight=false;saveButtonState(false);showStatus('Purchase order progress paused; retry only the original request. 采购单进度已暂停，只能重试原请求。',true);paintSaveTracker();return;}}if(current.operation==='COST_REFERENCE'){if(currentCostProgressOwner!==current)");
  return source;
};
