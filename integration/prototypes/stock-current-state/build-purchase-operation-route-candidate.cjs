'use strict';
const fs=require('node:fs'),path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../../backend/purchaseOperations.web.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(source.split(before).length!==2)throw Error('Exact original Purchase operation route anchor changed');source=source.replace(before,()=>after);}
source="import { createCurrentPurchaseSaveRouter } from 'backend/stockCurrentCommands.js';\nimport { savePurchaseTasksCurrent } from 'backend/stockCurrentBorrow.web';\n"+source;
once('async(company,requestId,operation,input)=>{','async(company,requestId,operation,input,stockCurrent)=>{');
const original="operation==='QUANTITY_CASE'?await decideQuantityCase({company,requestId,input,staff:{...staff,canDecideQuantityCase:true}}):operation==='ADD_SOURCE'?await addSource({company,requestId,input:{...input,action:'ADD_SOURCE'},staff:{...staff,canAddPurchaseSource:true}}):operation==='SHORTAGE'?await decideShortage({company,requestId,input,staff}):operation==='ALLOCATE'?await allocate({company,requestId,input,staff}):await operate({company,requestId,operation,input,staff})";
once('return '+original+';',"return await createCurrentPurchaseSaveRouter({company,readControl:()=>store.read(PURCHASE_COLLECTIONS[company].activity,operationId(company,'STOCK_CONTROL')),saveCurrent:savePurchaseTasksCurrent,saveLegacy:async()=>"+original+"})({requestId,operation,input,stockCurrent});");
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'purchaseOperations.web.candidate.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Purchase server mode routing candidate differs');}
else fs.writeFileSync(target,source);
process.stdout.write('Original Purchase server mode route '+(process.argv.includes('--check')?'verified':'built')+'; paired control required before installation; no deployment\n');
