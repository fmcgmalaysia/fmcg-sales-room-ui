'use strict';
const fs=require('node:fs'),path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../../backend/warehouseReceiving.web.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(source.split(before).length!==2)throw Error('Exact original Warehouse receipt route anchor changed');source=source.replace(before,()=>after);}
source="import { createCurrentWarehouseReceiptRouter, createCurrentWarehouseOrdersRouter } from 'backend/stockCurrentCommands.js';\nimport { saveWarehouseReceiptCurrent, getWarehouseOrdersCurrent } from 'backend/stockCurrentWarehouse.web';\nimport { operationId } from 'backend/purchaseOperationJournal.js';\n"+source;
once('export const saveWarehouseReceipt=webMethod(Permissions.SiteMember,async(company,requestId,input)=>{',
  'export const saveWarehouseReceipt=webMethod(Permissions.SiteMember,async(company,requestId,input,stockCurrent)=>{');
once('try{return await operations.save({company,staff,requestId,input});}',
  "try{return await createCurrentWarehouseReceiptRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),saveCurrent:saveWarehouseReceiptCurrent,saveLegacy:()=>operations.save({company,staff,requestId,input})})({requestId,input,stockCurrent});}");
once('  const staff=await staffContext(),{orders,customerLines,deliveryTasks}=await readWarehouseData(company,staff);let names=[];',
  "  const staff=await staffContext();\n  return createCurrentWarehouseOrdersRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),readCurrent:getWarehouseOrdersCurrent,readLegacy:async()=>{\n  const {orders,customerLines,deliveryTasks}=await readWarehouseData(company,staff);let names=[];");
once('readAt:new Date().toISOString()};\n});','readAt:new Date().toISOString()};\n  }})();\n});');
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'warehouseReceiving.web.candidate.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Warehouse receipt server route differs');}
else fs.writeFileSync(target,source);
process.stdout.write('Original Warehouse receipt server mode route '+(process.argv.includes('--check')?'verified':'built')+'; paired control required; no deployment\n');
