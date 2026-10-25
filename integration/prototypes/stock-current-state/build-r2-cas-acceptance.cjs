'use strict';
// Local compile of exact current core, no native installation or invocation.
const fs=require('node:fs'),path=require('node:path');
const body=file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n').replace(/^'use strict';\n/,'')
 .replace(/^const \{[^\n]+\} = require\([^\n]+\);\n/gm,'').replace(/module\.exports\s*=\s*\{[^;]+\};\s*$/,'');
const wrap=(file,names)=>'const {'+names+'}=(()=>{\n'+body(file)+'\nreturn {'+names+'};\n})();\n';
const source="import { items } from '@wix/data';\nimport { webMethod, Permissions } from 'wix-web-module';\nimport { createHash, randomBytes } from 'crypto';\n"
 +"const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);\nconst randomUUID=()=>randomBytes(16).toString('hex');\n"
 +wrap('domain-scope.cjs','planCollections')+wrap('sdk-field-codec.cjs','createSdkFieldCodec')
 +wrap('sdk-conditional-store.cjs','createSdkConditionalStore')+wrap('segmented-plan.cjs','createSegmentedPlanCodec,same,copy')
 +wrap('segmented-fenced-proof.cjs','createSegmentedFencedProof')+body('r2-cas-acceptance.cjs')
 +"\nconst NATIVE_R2_CAS_ACCEPTANCE_ENABLED=false;\nexport const verifyR2Cas=webMethod(Permissions.Admin,input=>verifyR2CasAcceptance({items,createSdkConditionalStore,createSegmentedFencedProof,hash,copy,same,input,enabled:NATIVE_R2_CAS_ACCEPTANCE_ENABLED}));\n";
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
if(/require\(|module\.exports/.test(source))throw Error('Native dependency leak');
const target=path.join(__dirname,'r2CasAcceptance.web.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Native R2 CAS diagnostic drift');}
else fs.writeFileSync(target,source);
process.stdout.write('R2 CAS acceptance compiled CLOSED; no delete capability, NOT native acceptance\n');
