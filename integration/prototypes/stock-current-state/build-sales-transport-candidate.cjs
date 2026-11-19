'use strict';
// Narrow original-source overlays only. No source/MASTER sync or auth changes.
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../../..');
function once(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Exact Sales transport anchor changed: ' + before.slice(0, 80));
  return source.replace(before, () => after);
}
let gateway = fs.readFileSync(path.join(root, 'integration/backend/customerFulfilmentGateway.js'), 'utf8').replace(/\r\n/g, '\n');
gateway = once(gateway, 'export async function handleSalesFulfilment(request){',
  "import { dispatchCurrentSalesGateway } from 'backend/stockCurrentCommands.js';\nimport { createCurrentSourceSales } from 'backend/stockCurrentSourceSales.js';\nasync function resolveOriginalSourceSales(company,staff){return createCurrentSourceSales({company,authenticateOriginalDelegation:async()=>staff});}\nexport const SALES_CURRENT_TRANSPORT_VERSION=2;\nexport async function handleSalesFulfilment(request,resolveCurrentSales=resolveOriginalSourceSales){");
const originalResult = "body.action==='READ'?await readCustomerFulfilment(body.company,staff,body.customerId):await (body.action==='DOCUMENT'?saveCustomerAccountDocument:saveCustomerFulfilment)({company:body.company,staff,requestId:body.requestId,input:{...body.input,action:body.action,customerId:body.customerId}})";
gateway = once(gateway, 'const result=' + originalResult + ';', "if(body.action==='READ'&&body.input?.resume!==undefined){if(body.input.resume!=='SOURCE_SALES_V1'||Object.keys(body.input).length!==1)throw Error('Original source Sales recovery request required');return{status:200,body:{ok:true,result:{ok:true,company:body.company,customerId:staff.customerId,schema:'SOURCE_SALES_RESUME_V1',staff:{staffId:staff.staffId,memberId:staff.memberId,staffName:staff.staffName}}}};}\n const legacy=async()=>(" + originalResult + ');const result=await dispatchCurrentSalesGateway({body,staff,resolveCurrentSales,legacy});');

let adjustment = fs.readFileSync(path.join(root, 'sales-room/order-adjustment.js'), 'utf8').replace(/\r\n/g, '\n');
adjustment = once(adjustment, 'action,input};transmit();', "action,input:action==='ADJUST'&&data?.stockCurrent?{...input,stockCurrent:data.stockCurrent}:input};transmit();");
adjustment = once(adjustment, 'if(/changed|Enter |Select |must |already|before |authorized|preserve/i.test(message.error||\'\'))',
  'if(!pending.input?.stockCurrent&&/changed|Enter |Select |must |already|before |authorized|preserve/i.test(message.error||\'\'))');
adjustment = once(adjustment, 'const action=pending.action;pending=null;',
  "if(pending.action==='ADJUST'&&pending.input?.stockCurrent){const receipt=message.result;if(receipt?.ok===false&&receipt.pending===true&&receipt.requestId===pending.requestId&&['BEFORE','APPLY','VERIFY'].includes(receipt.phase)&&Number.isSafeInteger(receipt.completedCount)&&Number.isSafeInteger(receipt.totalRecords)&&receipt.totalRecords>0&&receipt.completedCount>=0&&receipt.completedCount<=receipt.totalRecords){lock(true);status('Saving 保存中… '+receipt.completedCount+' / '+receipt.totalRecords);timer=setTimeout(transmit,250);return;}if(receipt?.ok!==true||receipt.requestId!==pending.requestId||!Number.isSafeInteger(receipt.stockGeneration)||receipt.stockGeneration<=pending.input.stockCurrent.stockGeneration){status('Save not confirmed 保存尚未确认，请重试同一次操作。');dialog.querySelector('[data-retry]').hidden=false;return;}}\n  const action=pending.action;pending=null;");
adjustment = once(adjustment, 'version:result.adjustmentVersion,plan};render();', 'version:result.adjustmentVersion,plan,stockCurrent:result.stockCurrent};render();');
adjustment=require('./source-sales-adjustment-ui-overlay.cjs')(adjustment);
let shipment = fs.readFileSync(path.join(root, 'sales-room/shipment-ui.js'), 'utf8').replace(/\r\n/g, '\n');
shipment = once(shipment, "pending=null,saving=false;", "pending=null,saving=false,timer=null,serial=0;");
shipment = once(shipment, "action,requestId:crypto.randomUUID(),input};transmit();",
  "action,requestId:crypto.randomUUID(),input:['SELECT','CANCEL','PLAN'].includes(action)&&data?.stockCurrent?JSON.parse(JSON.stringify({...input,stockCurrent:data.stockCurrent})):input};transmit();");
shipment = once(shipment, 'const request=pending;setTimeout(()=>{if(pending===request){',
  'const request=pending,attempt=++serial;clearTimeout(timer);timer=setTimeout(()=>{if(pending===request&&serial===attempt){');
shipment = once(shipment, "return;saving=false;dialog.querySelectorAll('button,input,select,textarea')",
  "return;clearTimeout(timer);serial++;saving=false;dialog.querySelectorAll('button,input,select,textarea')");
shipment = once(shipment, "if(/changed|Enter|Select|exceeds|already exists|not authorized/.test(message.error||''))",
  "if(!pending.input?.stockCurrent&&/changed|Enter|Select|exceeds|already exists|not authorized/.test(message.error||''))");
shipment = once(shipment, 'const action=pending.action;pending=null;',
  "if(pending.action==='READ'&&message.result?.stockCurrent!=null){const meta=message.result.stockCurrent;if(meta.schema!=='CURRENT_STOCK_V2'||meta.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0){dialog.querySelector('[data-status]').textContent='Current shipment form unavailable 请刷新后重试';dialog.querySelector('[data-retry]').hidden=false;return;}}if(pending.input?.stockCurrent){const receipt=message.result;if(receipt?.ok===false&&receipt.pending===true&&receipt.requestId===pending.requestId&&['BEFORE','APPLY','VERIFY'].includes(receipt.phase)&&Number.isSafeInteger(receipt.completedCount)&&Number.isSafeInteger(receipt.totalRecords)&&receipt.totalRecords>0&&receipt.completedCount>=0&&receipt.completedCount<=receipt.totalRecords){saving=true;dialog.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=true);dialog.querySelector('[data-status]').textContent='Saving 保存中… '+receipt.completedCount+' / '+receipt.totalRecords;timer=setTimeout(transmit,250);return;}if(receipt?.ok!==true||receipt.requestId!==pending.requestId||!Number.isSafeInteger(receipt.stockGeneration)||receipt.stockGeneration<=pending.input.stockCurrent.stockGeneration){dialog.querySelector('[data-status]').textContent='Save not confirmed 保存尚未确认，请重试同一次操作';dialog.querySelector('[data-retry]').hidden=false;return;}}const action=pending.action;pending=null;");
shipment = once(shipment, 'open(customerId){if(!dialog){',
  'open(customerId){if(pending?.input?.stockCurrent){if(!dialog.open)dialog.showModal();return;}if(!dialog){');
shipment = once(shipment, ' window.masterShipments=',
  " window.addEventListener('beforeunload',event=>{if(pending?.input?.stockCurrent){event.preventDefault();event.returnValue='';}});\n window.masterShipments=");
shipment=require('./source-sales-shipment-ui-overlay.cjs')(shipment);
for (const [file, source] of [['customerFulfilmentGateway.candidate.js', gateway], ['sales-order-adjustment.candidate.js', adjustment], ['sales-shipment-ui.candidate.js', shipment]]) {
  const target = path.join(__dirname, file);
  new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Sales transport candidate differs');
  } else fs.writeFileSync(target, source);
}
process.stdout.write('Sales authenticated gateway, adjustment and shipment transport ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; candidate only\n');
