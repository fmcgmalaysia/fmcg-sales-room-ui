'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createSegmentedPlanCodec}=require('./segmented-plan.cjs');
const fixture=require('./native-plan-staging.fixture.json');
const encoded=createSegmentedPlanCodec({company:'NCT',domainWrites:true}).encode({...fixture,attempt:'FIXED-RETAINED-STAGING-ATTEMPT'});
const logicalIds=[...encoded.fragments,encoded.manifest].map(row=>row._id);
const sourceIdentity={schema:'STOCK_NATIVE_300_COMMIT_SOURCE_V1',company:'NCT',key:fixture.key,digest:fixture.digest,
 memberId:fixture.memberId,requestId:fixture.requestId,planHash:encoded.manifest.planHash,planBytes:encoded.manifest.planBytes,
 logicalIds,physicalIds:logicalIds.map(id=>'SPT-STAGE300-20261023-a32d:'+id)};
const body=file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n').replace(/^'use strict';\n/,'')
 .replace(/^const \{[^\n]+\} = require\([^\n]+\);\n/gm,'').replace(/module\.exports\s*=\s*\{[^;]+\};\s*$/,'');
const wrap=(file,names)=>'const {'+names+'}=(()=>{\n'+body(file)+'\nreturn {'+names+'};\n})();\n';
// This compiled server constant may be changed ONLY after the exact action-time
// native fixed-lock deletion grant. CLI/browser flags do not authorize that edit.
const allowConditionalLockRelease=false;
const source="import { items } from '@wix/data';\nimport { webMethod, Permissions } from 'wix-web-module';\nimport { createHash, randomBytes } from 'crypto';\n"
 +"const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);\n"
 +"const randomUUID=()=>randomBytes(16).toString('hex');\n"
 +wrap('domain-scope.cjs','planCollections')+wrap('sdk-field-codec.cjs','createSdkFieldCodec')
 +wrap('sdk-conditional-store.cjs','createSdkConditionalStore')+wrap('segmented-plan.cjs','createSegmentedPlanCodec,same,copy')
 +wrap('segmented-fenced-proof.cjs','createSegmentedFencedProof')
 +'const retainedSource='+JSON.stringify(sourceIdentity)+';\n'+body('native-300-commit-probe.cjs')
 +'\nconst NATIVE_TEST_LOCK_RELEASE_GRANTED='+allowConditionalLockRelease+';\n'
 +"export const verifyStock300Commit=webMethod(Permissions.Admin,async input=>{\n"
 +" try{return await verifyNative300Commit({items,createSdkConditionalStore,createSegmentedPlanCodec,createSegmentedFencedProof,same,copy,hash,source:retainedSource,input,newAttempt:randomUUID,allowConditionalLockRelease:NATIVE_TEST_LOCK_RELEASE_GRANTED});}\n"
 +" catch(_){return{ok:false,mutationAttempted:false,error:'Fixed native300 test input required. No recovery performed.'};}\n});\n";
if(/require\(|module\.exports/.test(source))throw Error('Unexpected native300 dependency');
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'stockProtocol300Commit.web.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Native300 bundle drift');}
else fs.writeFileSync(target,source);
if(require.main===module)process.stdout.write('Native300 Admin probe '+(process.argv.includes('--check')?'verified':'built')+'; conditional test lock release '+(allowConditionalLockRelease?'AUTHORIZED':'BLOCKED')+'; NOT native acceptance\n');
module.exports={sourceIdentity};
