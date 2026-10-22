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
  "import { dispatchCurrentSalesGateway } from 'backend/stockCurrentCommands.js';\nexport const SALES_CURRENT_TRANSPORT_VERSION=2;\nexport async function handleSalesFulfilment(request,resolveCurrentSales){");
const originalResult = "body.action==='READ'?await readCustomerFulfilment(body.company,staff,body.customerId):await (body.action==='DOCUMENT'?saveCustomerAccountDocument:saveCustomerFulfilment)({company:body.company,staff,requestId:body.requestId,input:{...body.input,action:body.action,customerId:body.customerId}})";
gateway = once(gateway, 'const result=' + originalResult + ';', 'const legacy=async()=>(' + originalResult + ');const result=resolveCurrentSales?await dispatchCurrentSalesGateway({body,staff,resolveCurrentSales,legacy}):await legacy();');

let adjustment = fs.readFileSync(path.join(root, 'sales-room/order-adjustment.js'), 'utf8').replace(/\r\n/g, '\n');
adjustment = once(adjustment, 'action,input};transmit();', "action,input:action==='ADJUST'&&data?.stockCurrent?{...input,stockCurrent:data.stockCurrent}:input};transmit();");
adjustment = once(adjustment, 'if(/changed|Enter |Select |must |already|before |authorized|preserve/i.test(message.error||\'\'))',
  'if(!pending.input?.stockCurrent&&/changed|Enter |Select |must |already|before |authorized|preserve/i.test(message.error||\'\'))');
adjustment = once(adjustment, 'const action=pending.action;pending=null;',
  "if(pending.action==='ADJUST'&&pending.input?.stockCurrent){const receipt=message.result;if(receipt?.ok===false&&receipt.pending===true&&receipt.requestId===pending.requestId&&['BEFORE','APPLY','VERIFY'].includes(receipt.phase)&&Number.isSafeInteger(receipt.completedCount)&&Number.isSafeInteger(receipt.totalRecords)&&receipt.totalRecords>0&&receipt.completedCount>=0&&receipt.completedCount<=receipt.totalRecords){lock(true);status('Saving 保存中… '+receipt.completedCount+' / '+receipt.totalRecords);timer=setTimeout(transmit,250);return;}if(receipt?.ok!==true||receipt.requestId!==pending.requestId||!Number.isSafeInteger(receipt.stockGeneration)||receipt.stockGeneration<=pending.input.stockCurrent.stockGeneration){status('Save not confirmed 保存尚未确认，请重试同一次操作。');dialog.querySelector('[data-retry]').hidden=false;return;}}\n  const action=pending.action;pending=null;");
adjustment = once(adjustment, 'version:result.adjustmentVersion,plan};render();', 'version:result.adjustmentVersion,plan,stockCurrent:result.stockCurrent};render();');
for (const [file, source] of [['customerFulfilmentGateway.candidate.js', gateway], ['sales-order-adjustment.candidate.js', adjustment]]) {
  const target = path.join(__dirname, file);
  new Function(source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, ''));
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Sales transport candidate differs');
  } else fs.writeFileSync(target, source);
}
process.stdout.write('Sales authenticated gateway and adjustment transport ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; candidate only\n');
