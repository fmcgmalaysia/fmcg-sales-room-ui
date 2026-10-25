'use strict';
const fs=require('node:fs'),path=require('node:path');
const body=fs.readFileSync(path.join(__dirname,'r2-intake-capacity.cjs'),'utf8').replace(/\r\n/g,'\n').replace(/^'use strict';\n/,'').replace(/module.exports=\{verifyR2IntakeCapacity\};\s*$/,'');
const source="import { items } from '@wix/data';\nimport { webMethod, Permissions } from 'wix-web-module';\nimport { createHash } from 'crypto';\n"
+"import { createSdkConditionalStore, createSegmentedFencedProof, createCurrentOrderIntakeOperations } from 'backend/r2stockCurrentCommands.js';\n"
+"import { createNctIntake, createNctReceiptReader } from 'backend/r2nctIntake.js';\n"
+"const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);\nconst copy=value=>JSON.parse(JSON.stringify(value));\nconst same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);\n"
+body+"\nconst R2_INTAKE_CAPACITY_ENABLED=false;\nexport const verifyR2Intake=webMethod(Permissions.Admin,async input=>{const result=await verifyR2IntakeCapacity({items,createSdkConditionalStore,createSegmentedFencedProof,createCurrentOrderIntakeOperations,createNctIntake,createNctReceiptReader,hash,copy,same,input,enabled:R2_INTAKE_CAPACITY_ENABLED});console.info('R2INTAKE_RECEIPT '+JSON.stringify(result));return result;});\n";
if(require.main===module){new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));const target=path.join(__dirname,'r2IntakeCapacityAcceptance.web.js');
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Intake diagnostic drift');}else fs.writeFileSync(target,source);
 process.stdout.write('Actual R2 intake capacity diagnostic compiled CLOSED; no business/delete capability\n');}
module.exports={source};
