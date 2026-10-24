'use strict';
const fs=require('node:fs'),path=require('node:path');
let source=fs.readFileSync(path.join(__dirname,'../../backend/purchaseWorkspace.web.js'),'utf8').replace(/\r\n/g,'\n');
function once(before,after){if(source.split(before).length!==2)throw Error('Original Purchase workspace route anchor changed');source=source.replace(before,()=>after);}
source="import { createCurrentPurchaseReadRouter } from 'backend/stockCurrentCommands.js';\nimport { getPurchaseWorkspaceCurrent } from 'backend/stockCurrentBorrow.web';\nimport { operationId } from 'backend/purchaseOperationJournal.js';\n"+source;
once('  const staff = await getPurchaseStaffContext();',`  const staff = await getPurchaseStaffContext();
  return createCurrentPurchaseReadRouter({company,readCurrent:getPurchaseWorkspaceCurrent,
    readControl:async()=>{const page=await wixData.query(PURCHASE_COLLECTIONS[company].activity).eq('_id',operationId(company,'STOCK_CONTROL')).limit(2).find(options);
      if(!Array.isArray(page?.items)||page.items.length>1)throw Error('Ambiguous Purchase stock control');return page.items[0]||null;},readLegacy:async()=>{`);
once('\n});','\n  }})();\n});');
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'purchaseWorkspace.web.candidate.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Purchase workspace routing candidate differs');}
else fs.writeFileSync(target,source);
process.stdout.write('Original Purchase workspace server-mode route '+(process.argv.includes('--check')?'verified':'built')+'; control initialization required before installation\n');
