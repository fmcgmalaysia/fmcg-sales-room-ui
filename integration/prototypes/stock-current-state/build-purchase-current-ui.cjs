'use strict';
const fs = require('node:fs'), path = require('node:path');
const target = path.join(__dirname, 'purchase-ui/app.js');
let source = fs.readFileSync(path.join(__dirname, '../../../purchase-live/app.js'), 'utf8').replace(/\r\n/g, '\n');
function once(before, after) {
  if (source.split(before).length !== 2) throw Error('Exact Purchase current UI anchor changed: ' + before.slice(0, 70));
  source = source.replace(before, () => after);
}
once('  function saveButtonState(busy)', '  let currentSegmentSerial=0;\n  function saveButtonState(busy)');
once('mutate,read:readOperation,savePending:()=>savePending', 'mutate,read:readOperation,stockActionReady:()=>!savePending&&!drafts.size&&!sequenceDraft&&!costRetry&&!allocationUi()?.dirty(),savePending:()=>savePending');
once("'PURCHASE_REFERENCE_RESULT'].includes(message.type)", "'PURCHASE_REFERENCE_RESULT','PURCHASE_BORROW_RELATIONS_RESULT','PURCHASE_BORROW_OPTIONS_RESULT'].includes(message.type)");
once('  function finishSave(result){const completed=savePending,',
  "  function finishSave(result){if(savePending?.stockProtocol===1&&(!Number.isSafeInteger(result?.stockGeneration)||result.stockGeneration<=savePending.stockGeneration)){saveInFlight=false;showStatus('Save not confirmed 保存尚未确认，原请求已保留。',true);paintSaveTracker();return;}const completed=savePending,");
once('function checkSaveReceipt(current,attempt=0){if(savePending!==current||saveCheckPending)return;',
  "function checkSaveReceipt(current,attempt=0){if(savePending!==current||saveCheckPending)return;if(current.stockProtocol===1){saveInFlight=false;saveButtonState(false);showStatus(saveDiagnostic(current,'Result unconfirmed 结果待确认，请重试原保存。'),true);cacheDraft();paintSaveTracker();return;}");
once('function saveMessage(){if(saveInFlight||!savePending)return;const current=savePending;',
  'function saveMessage(){if(saveInFlight||!savePending)return;const current=savePending,segment=++currentSegmentSerial;');
once('setTimeout(()=>{if(savePending===current)checkSaveReceipt(current);},30000);',
  'setTimeout(()=>{if(savePending===current&&(current.stockProtocol!==1||segment===currentSegmentSerial))checkSaveReceipt(current);},30000);');
once('savePending={type:kind,company,requestId:crypto.randomUUID(),...args};',
  'savePending={type:kind,company,requestId:crypto.randomUUID(),...args,...(data?.stockCurrent?.stockProtocol===1?{stockProtocol:1,stockBuild:data.stockCurrent.stockBuild,stockGeneration:data.stockCurrent.stockGeneration}:{})};if(savePending.stockProtocol===1)savePending=JSON.parse(JSON.stringify(savePending));');
const success = '    if(message.ok&&message.result?.ok===true&&message.result.requestId===savePending.requestId){finishSave(message.result);return;}';
once(success, "    if(savePending.stockProtocol===1){const current=savePending,result=message.result;if(message.ok&&result?.ok===false&&result.pending===true&&result.requestId===current.requestId&&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)&&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.completedCount>=0&&result.completedCount<=result.totalRecords){saveInFlight=false;cacheDraft();showStatus('Saving 保存中… '+result.completedCount+' / '+result.totalRecords);paintSaveTracker();setTimeout(()=>{if(savePending===current&&!saveInFlight)saveMessage();},250);return;}if(message.ok&&result?.ok===true&&result.requestId===current.requestId&&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>current.stockGeneration){finishSave(result);return;}saveIssue=message.error||result?.error||'Save not confirmed 保存尚未确认';saveInFlight=false;saveButtonState(false);showStatus(saveDiagnostic(current,saveIssue),true);cacheDraft();paintSaveTracker();return;}\n" + success);
new Function(source);
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Purchase current UI differs from tested patch');
} else fs.writeFileSync(target, source);
process.stdout.write('Purchase current metadata/progress overlay ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; no production edit\n');
