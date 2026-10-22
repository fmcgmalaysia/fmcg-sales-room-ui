'use strict';
// Guard the ORIGINAL stock endpoint after its original authentication. Current UI
// has its distinct current response contract; never fake that as a legacy page.
const fs=require('node:fs'),path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../../backend/stockControl.web.js'),'utf8').replace(/\r\n/g,'\n');
const before='  readContext: readFulfilmentContext';
if(source.split(before).length!==2)throw Error('Original stock read context anchor changed');
source="import { operationId } from 'backend/purchaseOperationJournal.js';\nimport { createCurrentWarehouseOrdersRouter } from 'backend/stockCurrentCommands.js';\n"+source.replace(before,`  readContext: async(company,staff)=>{
    const id=operationId(company,'STOCK_CONTROL'),journal=company==='NCT'?'NCTActivity':'NCTActivity1';let initial;
    const router=createCurrentWarehouseOrdersRouter({company,
      readControl:async()=>{initial=await fulfilmentStore.read(journal,id);return initial;},
      readCurrent:async()=>{throw Error('Inventory changed. Refresh the updated Stock Control page.');},
      readLegacy:async()=>{
        const context=await readFulfilmentContext(company,staff),after=await fulfilmentStore.read(journal,id);
        if(!after||after._id!==id||after.company!==company||after.stockCommitVersion!==initial.stockCommitVersion||after.mode!=='LEGACY'||after.pending!==null||after.generation!==initial.generation||after.schemaVersion!==initial.schemaVersion)throw Error('Inventory changed during the original stock read. Refresh before using stock.');
        return context;
      }});return router();
  }`);
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'stockControl.web.candidate.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Original stock read guard differs');}else fs.writeFileSync(target,source);
process.stdout.write('Original stock legacy-only endpoint guard '+(process.argv.includes('--check')?'verified':'built')+'; not installed\n');
