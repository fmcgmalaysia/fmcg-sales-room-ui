'use strict';
// Original two Source seams only. No deployment or authentication replacement.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../../..');
const load=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
function once(source,before,after){if(source.split(before).length!==2)throw Error('Exact original Source date transport anchor changed: '+before.slice(0,90));return source.replace(before,()=>after);}
let backend=load('sales-room/wix/onboarding.web.js');
backend=once(backend,'async (orderId, customerPoNumber, estimatedShipmentDate, expectedRevision, requestId, expectedShipmentRevision) => {',
 'async (orderId, customerPoNumber, estimatedShipmentDate, expectedRevision, requestId, expectedShipmentRevision, stockCurrent) => {');
backend=once(backend,'date,version:expectedShipmentRevision}});',
 'date,version:expectedShipmentRevision,...(stockCurrent!==undefined?{stockCurrent}: {})}});\n        if(stockCurrent!==undefined&&receipt?.ok===false&&receipt.pending===true&&receipt.requestId===key&&[\'BEFORE\',\'APPLY\',\'VERIFY\'].includes(receipt.phase)&&Number.isSafeInteger(receipt.completedCount)&&Number.isSafeInteger(receipt.totalRecords)&&receipt.totalRecords>0&&receipt.completedCount>=0&&receipt.completedCount<=receipt.totalRecords)return{ok:false,pending:true,requestId:key,company:order.destination,orderId:normalize(orderId),phase:receipt.phase,completedCount:receipt.completedCount,totalRecords:receipt.totalRecords};');
backend=once(backend,"return {ok:true,orderId:normalize(orderId),message:'Shipment date saved.',shipmentDateRevision:receipt.revision};",
 "if(stockCurrent!==undefined&&(!Number.isSafeInteger(receipt.stockGeneration)||receipt.stockGeneration<=stockCurrent.stockGeneration))throw new Error('Current shipment date receipt is not confirmed. Retry the same save.');\n        return {ok:true,orderId:normalize(orderId),message:'Shipment date saved.',shipmentDateRevision:receipt.revision,...(stockCurrent!==undefined?{requestId:key,company:order.destination,stockGeneration:receipt.stockGeneration}: {})};");
let page=load('sales-room/wix/sales-room-page.js');
page=once(page,"message.requestId || '', message.expectedShipmentRevision);","message.requestId || '', message.expectedShipmentRevision, message.stockCurrent);");
const outputs={'source-onboarding.candidate.js':backend,'source-sales-room-page.candidate.js':page};
outputs['source-onboarding.candidate.js']=require('./source-intake-progress-backend.cjs').onboarding(backend);
for(const[name,source]of Object.entries(outputs)){
 new Function(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm,'').replace(/^export /gm,''));
 const target=path.join(__dirname,name);if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Source order-date overlay differs: '+name);}else fs.writeFileSync(target,source);
}
process.stdout.write('Original Source order-date current metadata/phase overlays '+(process.argv.includes('--check')?'verified':'built')+'; no publication\n');
