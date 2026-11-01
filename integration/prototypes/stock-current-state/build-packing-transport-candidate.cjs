'use strict';
const fs = require('node:fs'), path = require('node:path');
let source = fs.readFileSync(path.join(__dirname, '../../../support-room/packing-transport.js'), 'utf8').replace(/\r\n/g, '\n');
function once(before, after) {
  if (source.split(before).length !== 2) throw Error('Exact original packing transport anchor changed');
  source = source.replace(before, () => after);
}
once('const requests=new Map();let pendingSave=null;', 'const requests=new Map();let pendingSave=null,currentStock=null,submitting=false;');
once('const busy=()=>onBusy(Boolean(requests.size));', 'const busy=()=>onBusy(Boolean(requests.size)||submitting);');
once('if(message.result?.ok===false){', "if(message.result?.ok===false&&!(pendingSave?.stockProtocol===1&&message.result.pending===true&&message.result.requestId===pendingSave.requestId&&['BEFORE','APPLY','VERIFY'].includes(message.result.phase)&&Number.isSafeInteger(message.result.completedCount)&&Number.isSafeInteger(message.result.totalRecords)&&message.result.totalRecords>0&&message.result.completedCount>=0&&message.result.completedCount<=message.result.totalRecords)){");
once('try{const result=await send(pendingSave);pendingSave=null;busy();return result;}\n   catch(error){if(error.retryable===false)pendingSave=null;busy();throw error;}',
  "if(submitting)throw Error('The original packing save is still processing.');submitting=true;busy();\n   try{while(true){const result=await send(pendingSave);if(pendingSave.stockProtocol===1){if(result?.pending===true){await new Promise(resolve=>setTimeout(resolve,250));continue;}if(result?.ok!==true||result.requestId!==pendingSave.requestId||!Number.isSafeInteger(result.stockGeneration)||result.stockGeneration<=pendingSave.stockGeneration||typeof result.id!=='string'||!result.id)throw Object.assign(Error('Packing save unconfirmed. Retry the same save.'),{retryable:true});}pendingSave=null;return result;}}\n   catch(error){if(error.retryable===false&&pendingSave?.stockProtocol!==1)pendingSave=null;throw error;}finally{submitting=false;busy();}");
once("read:()=>send({type:'PACKING_READ_REQUEST',company:company(),requestId:crypto.randomUUID()}),",
  "read:async()=>{const selectedCompany=company(),result=await send({type:'PACKING_READ_REQUEST',company:selectedCompany,requestId:crypto.randomUUID()});if(result?.stockCurrent!=null){const meta=result.stockCurrent;if(meta.schema!=='CURRENT_STOCK_V2'||meta.stockProtocol!==1||typeof meta.stockBuild!=='string'||!meta.stockBuild||!Number.isSafeInteger(meta.stockGeneration)||meta.stockGeneration<0)throw Error('Current packing form metadata unavailable. Refresh.');currentStock={company:selectedCompany,stockProtocol:1,stockBuild:meta.stockBuild,stockGeneration:meta.stockGeneration};}else currentStock=null;return result;},");
once("pendingSave={type:'PACKING_SAVE_REQUEST',company:company(),requestId:crypto.randomUUID(),input};",
  "if(currentStock&&currentStock.company!==company())throw Error('Company changed. Refresh packing before saving.');pendingSave={type:'PACKING_SAVE_REQUEST',company:company(),requestId:crypto.randomUUID(),input:currentStock?JSON.parse(JSON.stringify(input)):input,...(currentStock?{stockProtocol:1,stockBuild:currentStock.stockBuild,stockGeneration:currentStock.stockGeneration}:{})};");
source=require('./packing-durable-transport-overlay.cjs')(source);
new Function(source);
const target = path.join(__dirname, 'packing-transport.current.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== source) throw Error('Packing transport candidate differs');
} else fs.writeFileSync(target, source);
process.stdout.write('Original packing same-request transport ' + (process.argv.includes('--check') ? 'verified' : 'built') + '; candidate only\n');
