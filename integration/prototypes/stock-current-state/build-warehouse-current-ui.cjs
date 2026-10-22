'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'),out=path.join(__dirname,'warehouse-ui');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
let source=read('warehouse-room/app.js');
function once(before,after){if(source.split(before).length!==2)throw Error('Exact Warehouse current receipt UI anchor changed: '+before.slice(0,80));source=source.replace(before,()=>after);}
once("const month=value=>",`let currentWarehouse=null,currentReceiptStaff=null,currentReceiptSerial=0,recoverySerial=0;
function paintCurrentReceipt(message='Original receipt retained 原收货请求保留'){
 if(pending?.stockProtocol!==1)return;
 $('notice').hidden=false;$('notice').innerHTML='<span>'+esc(message)+' · '+esc(pending.requestId)+'</span> <button id="retryCurrentReceipt" class="primary" type="button">Retry same receipt 重试原收货</button>';
 $('retryCurrentReceipt').disabled=saving;$('retryCurrentReceipt').onclick=save;$('company').disabled=true;
}
function restoreCurrentReceipt(staff,request){
 if(!request||pending||saving||$('entry').open)return;
 pending=JSON.parse(JSON.stringify(request));currentReceiptStaff=staff;paintCurrentReceipt();
}
function recoverCurrentReceipt(){
 const helper=window.warehouseCurrentReceipt,selectedCompany=company,attempt=++recoverySerial;
 if(!helper||pending||saving||$('entry').open)return;
 helper.recover(company).then(result=>{if(attempt===recoverySerial&&company===selectedCompany)restoreCurrentReceipt(result.staff,result.request);})
  .catch(()=>{if(attempt===recoverySerial&&company===selectedCompany)notice('Original receipt recovery unconfirmed. Keep this tab and check staff login. 原收货恢复尚未确认，请保留此页并核对员工登录。',true);});
}
const month=value=>`);
once('function openEntry(id){selected=',"function openEntry(id){if(pending?.stockProtocol===1){paintCurrentReceipt();return;}selected=");
once("$('closeEntry').disabled=value;}","$('closeEntry').disabled=value;if(pending?.stockProtocol===1)paintCurrentReceipt(value?'Saving receipt 正在保存收货':'Original receipt retained 原收货请求保留');else $('company').disabled=false;}");
once(" setSaving(true);$('entryError').textContent='';parent.postMessage(pending,'*');const id=pending.requestId;",
 ` if(pending.stockProtocol===undefined&&currentWarehouse){pending=JSON.parse(JSON.stringify({...pending,stockProtocol:1,stockBuild:currentWarehouse.stockBuild,stockGeneration:currentWarehouse.stockGeneration,stockIdentity:{staffId:currentReceiptStaff.staffId,memberId:currentReceiptStaff.memberId}}));}
 if(pending.stockProtocol===1){try{window.warehouseCurrentReceipt.retain(pending,currentReceiptStaff);}catch(_){setSaving(false);paintCurrentReceipt('Receipt not sent: cache confirmation required 尚未发送收货，请核对浏览器暂存');return;}}
 setSaving(true);$('entryError').textContent='';parent.postMessage(pending,'*');const id=pending.requestId,segment=++currentReceiptSerial;`);
once('if(saving&&pending?.requestId===id){','if(saving&&pending?.requestId===id&&(pending.stockProtocol!==1||segment===currentReceiptSerial)){');
once("$('entryError').textContent='尚未收到保存确认。请重试同一次保存，系统不会重复累计。';", "$('entryError').textContent='尚未收到保存确认。请重试同一次保存，系统不会重复累计。';if(pending.stockProtocol===1)paintCurrentReceipt($('entryError').textContent);");
once("notice(message.error||'读取失败，请登录后重试。',true);return;", "notice(message.error||'读取失败，请登录后重试。',true);recoverCurrentReceipt();window.warehouseWorkroom?.recoverCurrent?.(company,{render,refresh:request});return;");
once('setData({orders:rows,deliveryTasks:legacyTasks}', 'setData({orders:rows,deliveryTasks:legacyTasks,...(currentWarehouse?{stockCurrent:currentWarehouse,staff:currentReceiptStaff}:{})}');
once('rows=result.orders;deliveryTasks=',`if(result.stockCurrent!==undefined){const meta=result.stockCurrent;
 if(meta.schema!=='CURRENT_WAREHOUSE_V2'||meta.stockProtocol!==1||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0||meta.generation!==meta.stockGeneration||!result.staff?.staffId||!result.staff.memberId){notice('Current Warehouse response unconfirmed 当前货仓回执尚未确认。',true);return;}
 recoverySerial++;currentWarehouse=meta;currentReceiptStaff=result.staff;
 try{restoreCurrentReceipt(result.staff,window.warehouseCurrentReceipt.pending(company,result.staff));}catch(_){notice('Original receipt cache unavailable. Do not enter another receipt. 原收货缓存无法核对，请勿重新登记。',true);return;}
 }else{currentWarehouse=null;currentReceiptStaff=null;}
 rows=result.orders;deliveryTasks=`);
once("notice('');render();}","notice('');render();if(pending?.stockProtocol===1)paintCurrentReceipt();}");
once(" if(message.type==='WAREHOUSE_RECEIPT_RESULT'&&pending?.requestId===message.requestId){",` if(message.type==='WAREHOUSE_RECEIPT_RESULT'&&pending?.requestId===message.requestId){
 if(pending.stockProtocol===1){const original=pending,result=message.result;
  if(message.ok&&result?.ok===false&&result.pending===true&&result.requestId===original.requestId&&saving&&['BEFORE','APPLY','VERIFY'].includes(result.phase)&&Number.isSafeInteger(result.completedCount)&&Number.isSafeInteger(result.totalRecords)&&result.totalRecords>0&&result.completedCount>=0&&result.completedCount<=result.totalRecords){
   setSaving(false);paintCurrentReceipt('Saving receipt 保存中… '+result.completedCount+' / '+result.totalRecords);const segment=currentReceiptSerial;
   setTimeout(()=>{if(pending===original&&!saving&&segment===currentReceiptSerial)save();},250);return;
  }
  if(!(message.ok&&result?.ok===true&&result.requestId===original.requestId&&result.company===company&&result.poId===original.input.id&&typeof result.receiptId==='string'&&result.receiptId&&Number.isFinite(Date.parse(result.savedAt))&&Number.isSafeInteger(result.stockGeneration)&&result.stockGeneration>original.stockGeneration)){
   currentReceiptSerial++;setSaving(false);paintCurrentReceipt('Receipt result unconfirmed 原收货结果尚未确认，请重试原请求');return;
  }
  try{window.warehouseCurrentReceipt.clear(original,currentReceiptStaff);}catch(_){currentReceiptSerial++;setSaving(false);paintCurrentReceipt('Receipt confirmed; cache cleanup pending 收货已确认，暂存清理待核对，请重试原请求');return;}
  currentReceiptSerial++;currentWarehouse=null;
 }
`);
new Function(source);
let html=read('warehouse-room/index.html').replace('<script src="app.js?', '<script src="warehouse-receipt-resume.js?v=20261022-current-receipt-v2"></script><script src="app.js?');
html=html.replace('<script src="workroom.js?v=20261020-split-controls-v1">','<script src="warehouse-preparation-resume.js?v=20261022-current-preparation-v1"></script><script src="workroom.js?v=20261022-current-preparation-v1">');
html=html.replace('<script src="dispatch.js?v=20261018-warehouse-workroom-v1">','<script src="warehouse-dispatch-resume.js?v=20261022-current-dispatch-v1"></script><script src="dispatch.js?v=20261022-current-dispatch-v1">');
html=html.replaceAll('20261021-packing-v1','20261022-current-receipt-v2').replace('content="2026-10-21-stock-tab-v1"','content="2026-10-22-current-receipt-v2"');
html=html.replace('packing-list-link.js?v=20261021-packing-company-v1','packing-list-link.js?v=20261022-current-warehouse-v2');
html=html.replace('stock-control-link.js?v=20261021-stock-tab-v1','stock-control-link.js?v=20261022-current-stock-v1');
const packingLink=read('warehouse-room/packing-list-link.js').replace("['20261021-packing-v1','20261021-packing-company-v1']","['20261021-packing-v1','20261021-packing-company-v1','20261022-current-warehouse-v2']");
const files=[['app.js',source],['index.html',html],['packing-list-link.js',packingLink]];
if(process.argv.includes('--check')){for(const[file,text]of files)if(fs.readFileSync(path.join(out,file),'utf8').replace(/\r\n/g,'\n')!==text)throw Error('Warehouse current UI differs: '+file);}
else{for(const[file,text]of files)fs.writeFileSync(path.join(out,file),text);}
process.stdout.write('Original Warehouse receipt current UI '+(process.argv.includes('--check')?'verified':'built')+'; production unchanged\n');
