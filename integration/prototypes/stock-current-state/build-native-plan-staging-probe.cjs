'use strict';
const fs=require('node:fs'),path=require('node:path');
const body=(file)=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n').replace(/^'use strict';\n/,'')
 .replace(/^const \{[^\n]+\} = require\([^\n]+\);\n/gm,'').replace(/module\.exports\s*=\s*\{[^;]+\};\s*$/,'');
const wrap=(file,names)=>'const {'+names+'}=(()=>{\n'+body(file)+'\nreturn {'+names+'};\n})();\n';
const source="import { items } from '@wix/data';\nimport { webMethod, Permissions } from 'wix-web-module';\nimport { createHash } from 'crypto';\n"
 +"const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);\n"
 +wrap('domain-scope.cjs','planCollections')+wrap('sdk-field-codec.cjs','createSdkFieldCodec')
 +wrap('sdk-conditional-store.cjs','createSdkConditionalStore')+wrap('segmented-plan.cjs','createSegmentedPlanCodec,same')
 +'const fixture='+fs.readFileSync(path.join(__dirname,'native-plan-staging.fixture.json'),'utf8').trim()+';\n'
 +body('native-plan-staging-probe.cjs')
 +"\n// Authorized ordinary isolated test; NO deletion or permission expansion capability.\n"
 +"export const verifyStockPlanStaging=webMethod(Permissions.Admin,async input=>{\n"
 +" try{return await verifyNativePlanStaging({items,createSdkConditionalStore,createSegmentedPlanCodec,same,fixture,input});}\n"
 +" catch(_){return{ok:false,mutationAttempted:false,error:'Fixed bounded staging input required. No recovery performed.'};}\n});\n";
if(/require\(|module\.exports/.test(source))throw Error('Unexpected staging bundle dependency');
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'stockProtocolPlanStaging.web.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Staging bundle drift');}
else fs.writeFileSync(target,source);
process.stdout.write('Admin insert-only actual300 staging probe '+(process.argv.includes('--check')?'verified':'built')+'; NOT native acceptance\n');
