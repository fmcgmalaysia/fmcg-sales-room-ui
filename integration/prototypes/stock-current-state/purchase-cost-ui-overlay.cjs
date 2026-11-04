'use strict';
// Reuse ORIGINAL Purchase save/cache/resume/tracker, not another cost request store.
module.exports = function overlay(source) {
  const once = (before, after) => { if (source.split(before).length !== 2) throw Error('Exact current Purchase cost anchor changed: ' + before.slice(0, 80)); source = source.replace(before, () => after); };
  const helpers = `  let currentCostProgressOwner=null,currentCostContinuations=0;
  function currentCostSuccess(request,result){return request?.operation==='COST_REFERENCE'&&request.type==='PURCHASE_SAVE_REQUEST'&&result?.ok===true&&result.pending!==true&&result.requestId===request.requestId&&result.company===request.company&&result.taskId===request.input?.taskId&&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>request.stockGeneration;}
  function currentCostFinal(request,result){return request?.operation==='COST_REFERENCE'&&request.type==='PURCHASE_SAVE_REQUEST'&&result?.ok===false&&result.stockFinal===true&&result.pending!==true&&result.requestId===request.requestId&&result.company===request.company&&result.taskId===request.input?.taskId&&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>request.stockGeneration&&/^(POINTBASE_[A-Z0-9_]+|COST_RETRY_SAVE_FAILED)$/.test(result.error||'');}
  function retainCurrentCost(request){
    if(request?.operation!=='COST_REFERENCE')return true;
    try{if(!draftKey||request.company!==company||data?.staff?.staffId!==request.stockIdentity?.staffId||data?.staff?.memberId!==request.stockIdentity?.memberId)throw Error('Original Purchase identity unavailable');
      cacheDraft();if(JSON.stringify(JSON.parse(sessionStorage.getItem(draftKey)||'null')?.savePending)!==JSON.stringify(request))throw Error('Original cost request not retained');return true;
    }catch(_){saveInFlight=false;saveButtonState(false);showStatus('Reference save not sent. Original request retained; check browser storage. 参考成本保存未发送，请检查浏览器暂存后重试原请求。',true);paintSaveTracker();return false;}
  }
  function clearCurrentCostCache(current){
    try{const cached=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(!cached||JSON.stringify(cached.savePending)!==JSON.stringify(current))throw Error('Original cache changed');
      const next={...cached,savePending:null,saveAttemptCount:null,saveOrigin:null,saveIssue:''};sessionStorage.setItem(draftKey,JSON.stringify(next));
      if(JSON.stringify(JSON.parse(sessionStorage.getItem(draftKey)||'null'))!==JSON.stringify(next))throw Error('Original cache cleanup unconfirmed');
    }catch(_){saveInFlight=false;saveButtonState(false);showStatus('Result recorded; original request cleanup unconfirmed. Keep and retry the same request. 结果已记录，原请求暂存清理尚未确认，请保留并重试原请求。',true);paintSaveTracker();return false;}return true;
  }
  function finishCurrentCostFailure(result){
    const current=savePending;if(!currentCostFinal(current,result)||!clearCurrentCostCache(current))return false;
    ++currentSegmentSerial;savePending=null;saveAttemptCount=null;saveOrigin=null;saveDialog=null;saveInFlight=false;saveCheckPending=false;saveIssue='';
    freezeDialog(false);saveButtonState(false);paintSaveTracker();document.querySelector('#companySelect').disabled=false;
    request();showStatus('Reference cost unavailable; failure recorded, original data unchanged. 参考成本未取得，失败已记录，原资料保持不变。 '+result.error,true);return true;
  }
`;
  once('  let currentSegmentSerial=0,', helpers + '  let currentSegmentSerial=0,');
  once('const completed=savePending,allocationHandled=', "if(savePending?.operation==='COST_REFERENCE'&&(!currentCostSuccess(savePending,result)||!clearCurrentCostCache(savePending))){saveInFlight=false;saveButtonState(false);showStatus('Reference result unconfirmed; original request retained. 参考成本结果尚未确认，原请求保留。',true);paintSaveTracker();return;}const completed=savePending,allocationHandled=");
  once('finishSave(receipt.result);},0);', "(currentCostFinal(savePending,receipt.result)?finishCurrentCostFailure:finishSave)(receipt.result);},0);");
  once('currentRecoveredReceipt=null;finishSave(receipt.result);return true;', 'currentRecoveredReceipt=null;if(currentCostFinal(savePending,receipt.result))return finishCurrentCostFailure(receipt.result);finishSave(receipt.result);return true;');
  once('const current=savePending,segment=++currentSegmentSerial;saveInFlight=true;', "const current=savePending,segment=++currentSegmentSerial;if(current.operation==='COST_REFERENCE'&&!retainCurrentCost(current))return;saveInFlight=true;");
  once('    if(savePending.stockProtocol===1){const current=savePending,result=message.result;', "    if(savePending.stockProtocol===1){const current=savePending,result=message.result;if(message.ok&&current.operation==='COST_REFERENCE'&&currentCostFinal(current,result)){finishCurrentCostFailure(result);return;}if(current.operation==='COST_REFERENCE'&&result?.ok===true&&!currentCostSuccess(current,result)){saveInFlight=false;saveButtonState(false);showStatus('Reference result identity unconfirmed; original request retained. 参考成本回执身份尚未确认，原请求保留。',true);paintSaveTracker();return;}");
  once("{saveInFlight=false;cacheDraft();showStatus('Saving 保存中… '+result.completedCount+' / '+result.totalRecords);", "{if(current.operation==='COST_REFERENCE'){if(currentCostProgressOwner!==current){currentCostProgressOwner=current;currentCostContinuations=0;}if(!saveInFlight||++currentCostContinuations>64){saveInFlight=false;saveButtonState(false);showStatus('Reference progress paused; retry only the original request. 参考成本进度已暂停，只能重试原请求。',true);paintSaveTracker();return;}}saveInFlight=false;cacheDraft();showStatus('Saving 保存中… '+result.completedCount+' / '+result.totalRecords);");
  once("return ({DOCUMENT:['Uploading document", "return ({COST_REFERENCE:['Refreshing reference cost 正在抓取参考成本','Reference cost refreshed 参考成本已更新'],DOCUMENT:['Uploading document");
  once("    if(control.id==='retryTaskCost'){\n", `    if(control.id==='retryTaskCost'&&data?.stockCurrent?.stockProtocol===1){
      if(costRetry||savePending||drafts.size||sequenceDraft||allocationUi()?.dirty()){showStatus('请先保存或取消当前修改。',true);return;}
      if(!/^[a-f0-9]{32}$/.test(control.dataset.taskId||'')||!data.staff?.staffId||!data.staff?.memberId){showStatus('Original reference task or identity unavailable. 原参考成本任务或员工身份尚未确认。',true);return;}
      control.disabled=true;control.textContent='正在抓取…';return mutate('PURCHASE_SAVE_REQUEST',{operation:'COST_REFERENCE',input:{taskId:control.dataset.taskId},stockIdentity:{staffId:data.staff.staffId,memberId:data.staff.memberId}});
    }
    if(control.id==='retryTaskCost'){
`);
  return source;
};
