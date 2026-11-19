'use strict';
const fs=require('node:fs'),path=require('node:path');
const body=fs.readFileSync(path.join(__dirname,'r2-sdk-authority-probe.cjs'),'utf8').replace(/\r\n/g,'\n').replace(/^'use strict';\n/,'').replace(/module.exports=\{verifyR2SdkAuthority\};\s*$/,'');
const source="import { items } from '@wix/data';\nimport { auth } from '@wix/essentials';\nimport { webMethod, Permissions } from 'wix-web-module';\nconst elevate=auth.elevate;\n"+body
 +"\nconst R2_SDK_AUTHORITY_PROBE_ENABLED=false;\nexport const verifyR2Authority=webMethod(Permissions.Admin,async input=>{const result=await verifyR2SdkAuthority({items,elevate,input,enabled:R2_SDK_AUTHORITY_PROBE_ENABLED});console.info('R2AUTH_RECEIPT '+JSON.stringify(result));return result;});\n";
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
if(require.main===module){const target=path.join(__dirname,'r2SdkAuthorityAcceptance.web.js');if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Authority probe source mismatch');}else fs.writeFileSync(target,source);process.stdout.write('New R2 authority probe compiled CLOSED; fixed3test records, no deletion or production access\n');}
module.exports={source};
