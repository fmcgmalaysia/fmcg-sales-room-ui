'use strict';
// Exact original workroom overlay. Original legacy/photo/render code stays.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../../..');
let source=fs.readFileSync(path.join(root,'warehouse-room/workroom.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(source.split(before).length!==2)throw Error('Exact Warehouse preparation UI anchor changed: '+before.slice(0,80));source=source.replace(before,()=>after);}
once("let cbmRequest=null,cbmTimer;",`let cbmRequest=null,cbmTimer,currentPreparation=null,preparationStaff=null,preparationSerial=0,preparationRecovery=0,preparationConfirmedGeneration=null;
function restorePreparation(staff,request){
 if(!request||pending||saving||dialog.open)return;
 pending=JSON.parse(JSON.stringify(request));preparationStaff=staff;resume();
}
function recoverPreparation(value,handlers){
 if(pending||saving||dialog.open||!window.warehouseCurrentPreparation)return;
 const attempt=++preparationRecovery;
 window.warehouseCurrentPreparation.recover(value).then(result=>{
  if(attempt!==preparationRecovery||pending||saving||dialog.open||company!==value)return;
  callbacks=handlers;restorePreparation(result.staff,result.request);
 }).catch(()=>{if(attempt===preparationRecovery&&company===value){callbacks=handlers;modal('Preparation recovery 备货恢复','Identity check required 请核对员工登录','<p>Original preparation recovery is unconfirmed. Keep this tab and refresh after checking login.<br>原备货恢复尚未确认，请保留此页，核对登录后再刷新。</p>');}});
}
function currentPreparationResult(message){
 if(pending?.stockProtocol!==1)return false;
 const original=pending,result=message.result;
 if(message.ok&&result?.ok===false&&result.pending===true&&result.requestId===original.requestId&&saving&&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)&&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
  clearTimeout(timer);saving=false;setBusy();$('whInfo').textContent='Saving 保存中… '+result.completedCount+' / '+result.totalRecords;const segment=preparationSerial;
  setTimeout(()=>{if(pending===original&&!saving&&segment===preparationSerial)send();},250);return true;
 }
 clearTimeout(timer);preparationSerial++;saving=false;setBusy();
 if(!(message.ok&&result?.ok===true&&result.requestId===original.requestId&&result.company===company&&result.id===original.input.id&&Number.isFinite(Date.parse(result.savedAt))&&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>original.stockGeneration)){
  error('Preparation result unconfirmed. Retry the original save. 备货结果尚未确认，请重试原保存。');$('whInfo').textContent='';$('whSave').textContent='Retry 重试';return true;
 }
 try{window.warehouseCurrentPreparation.clear(original,preparationStaff);}catch(_){error('Preparation confirmed; cache cleanup pending. Retry original save. 备货已确认，暂存清理待核对，请重试原保存。');$('whSave').textContent='Retry 重试';return true;}
 pending=null;preparationConfirmedGeneration=result.stockGeneration;dialog.close();photos=[];callbacks.refresh();return true;
}`);
once("function prepare(id,action){if(pending||saving){resume();return;}","function prepare(id,action){if(pending||saving){resume();return;}if(preparationConfirmedGeneration!==null){modal('Preparation confirmed 备货已确认','Refresh required 请刷新资料','<p>Wait for the updated Warehouse workspace before another save.<br>请先刷新货仓资料，再登记下一次操作。</p>');return;}");
once("try{sessionStorage.setItem('warehousePending/'+company,JSON.stringify(pending));}",`if(currentPreparation){pending=JSON.parse(JSON.stringify({...pending,stockProtocol:1,stockBuild:currentPreparation.stockBuild,stockGeneration:currentPreparation.stockGeneration,stockIdentity:{staffId:preparationStaff.staffId,memberId:preparationStaff.memberId}}));send();return;}
 try{sessionStorage.setItem('warehousePending/'+company,JSON.stringify(pending));}`);
once("function send(){error('');saving=true;",`function send(){if(saving||!pending)return;
 if(pending.stockProtocol===1){try{window.warehouseCurrentPreparation.retain(pending,preparationStaff);}catch(_){error('Preparation not sent: cache confirmation required. 备货尚未发送，请核对浏览器暂存。');return;}}
 const original=pending,segment=++preparationSerial;error('');saving=true;`);
once("if(pending){saving=false;setBusy();$('whSave').textContent='Retry';", "if(pending===original&&(pending.stockProtocol!==1||segment===preparationSerial)){saving=false;setBusy();$('whSave').textContent='Retry';");
once("return;clearTimeout(timer);saving=false;setBusy();if(m.ok&&m.result?.ok)","return;if(currentPreparationResult(m))return;clearTimeout(timer);saving=false;setBusy();if(m.ok&&m.result?.ok)");
once('window.warehouseWorkroom={incoming,', 'window.warehouseWorkroom={recoverCurrent:recoverPreparation,incoming,');
once("company=value;callbacks=handlers;if(!pending)",`if(company!==value&&!pending)preparationConfirmedGeneration=null;company=value;callbacks=handlers;
 if(result.stockCurrent!==undefined){const meta=result.stockCurrent;
  if(meta.schema!=='CURRENT_WAREHOUSE_V2'||meta.stockProtocol!==1||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0||meta.generation!==meta.stockGeneration||!result.staff?.staffId||!result.staff.memberId)throw Error('Current Warehouse preparation metadata unconfirmed');
  currentPreparation=meta;preparationStaff=result.staff;preparationRecovery++;if(preparationConfirmedGeneration!==null&&meta.stockGeneration>=preparationConfirmedGeneration)preparationConfirmedGeneration=null;
  if(!pending){const cached=window.warehouseCurrentPreparation.pending(company,preparationStaff);if(cached)restorePreparation(preparationStaff,cached);}
 }else{currentPreparation=null;preparationStaff=null;}
 if(!pending&&!currentPreparation)`);
source=require('./warehouse-cbm-ui-overlay.cjs')(source);
new Function(source);
const target=path.join(__dirname,'warehouse-ui/workroom.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Warehouse preparation UI differs');}
else fs.writeFileSync(target,source);
process.stdout.write('Original Warehouse preparation current UI '+(process.argv.includes('--check')?'verified':'built')+'; production unchanged\n');
