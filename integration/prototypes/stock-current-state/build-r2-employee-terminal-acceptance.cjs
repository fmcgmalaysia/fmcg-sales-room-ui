'use strict';
// New isolated diagnostic; never regenerate/arm the old occupied employee probe.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const { COHORT }=require('./isolated-cohort.cjs');
const { stable }=require('./fresh-cohort-activation-schema.cjs');
const { terminalPrefixes,createEmployeeTerminalAcceptance }=require('./r2-employee-terminal-acceptance.cjs');
const text=file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n');
const oldPrefixes={ADMIN:'SPT-R2AUTH-20261024-c281:',PURCHASE:'SPT-R2AUTH-PURCHASE-20261025-a581:',WAREHOUSE:'SPT-R2AUTH-WAREHOUSE-20261025-f281:'};
let probeBody=text('r2-sdk-authority-probe.cjs').replace(/^'use strict';\n/,'').replace(/module.exports=\{verifyR2SdkAuthority\};\s*$/,'');
for(const profile of ['PURCHASE','WAREHOUSE']){
 if(probeBody.split(oldPrefixes[profile]).length!==2)throw Error('Exact old diagnostic prefix anchor required');
 probeBody=probeBody.replace(oldPrefixes[profile],terminalPrefixes[profile]);
}
// ADMIN is not exported in this module. Even an accidental internal ADMIN call
// must not touch the old consumed administrator test.
probeBody=probeBody.replace(oldPrefixes.ADMIN,'SPT-R2TERMINAL-UNEXPORTED-ADMIN-20261025-fd09:');
const probeSourceSha256=createHash('sha256').update(probeBody).digest('hex');
const authorityBuild=createHash('sha256').update(probeBody).update(createEmployeeTerminalAcceptance.toString()).digest('hex').slice(0,40);
const source=["import { items } from '@wix/data';","import { auth } from '@wix/essentials';",
 "import { webMethod, Permissions } from 'wix-web-module';","import { currentMember } from 'wix-members-backend';",
 "import { getPurchaseStaffContext } from 'backend/r2purchaseAccess.js';","import { requireWarehouseStaff } from 'backend/r2warehouseReceiving.js';",
 "import { fulfilmentStore } from 'backend/r2customerFulfilmentService.js';","import { createHash } from 'crypto';",
 'const COHORT='+JSON.stringify(COHORT)+';', 'const stable='+stable.toString()+';',
 'const terminalPrefixes=Object.freeze('+JSON.stringify(terminalPrefixes)+');',probeBody,
 createEmployeeTerminalAcceptance.toString(),
 'const R2_EMPLOYEE_TERMINAL_ENABLED=false;',
 'const authorityBuild='+JSON.stringify(authorityBuild)+',probeSourceSha256='+JSON.stringify(probeSourceSha256)+';',
 "async function authenticatePurchase(){const staff=await getPurchaseStaffContext();if(!staff?.staffId||!staff.memberId)throw Error('Original Purchase identity required');return{staffId:staff.staffId,memberId:staff.memberId};}",
 "async function authenticateWarehouse(){const member=await currentMember.getMember({fieldsets:['FULL']});const staff=requireWarehouseStaff(member,await fulfilmentStore.all('StaffMasterAccess'));if(!member?._id||!staff?.staffId)throw Error('Original Warehouse identity required');return{staffId:staff.staffId,memberId:member._id};}",
 "const service=profile=>createEmployeeTerminalAcceptance({profile,authorityBuild,probeSourceSha256,probe:verifyR2SdkAuthority,items,elevate:auth.elevate,authenticate:profile==='PURCHASE'?authenticatePurchase:authenticateWarehouse,enabled:R2_EMPLOYEE_TERMINAL_ENABLED});",
 "export const verifyPurchaseTerminal=webMethod(Permissions.SiteMember,async input=>{const result=await service('PURCHASE').execute(input);console.info('R2_EMPLOYEE_TERMINAL_RECEIPT '+JSON.stringify(result));return result;});",
 "export const verifyWarehouseTerminal=webMethod(Permissions.SiteMember,async input=>{const result=await service('WAREHOUSE').execute(input);console.info('R2_EMPLOYEE_TERMINAL_RECEIPT '+JSON.stringify(result));return result;});",''].join('\n');
const beforePage=text('r2-employee-authority-page.candidate.js');
if(createHash('sha256').update(beforePage).digest('hex')!=='45d9f220a71d9c89ea6ae2d2b041346b7d253b938fb273d0b5c7da23736ffa79')throw Error('Exact original CLOSED diagnostic page required');
const pageAddition=text('r2-employee-terminal-page.additions.js')
 .replace('__TERMINAL_AUTHORITY_BUILD__',authorityBuild).replace('__TERMINAL_PROBE_SOURCE__',probeSourceSha256);
const pageSource=beforePage+'\n'+pageAddition;
if(require.main===module){
 new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
 new Function(pageSource.replace(/^import[^\n]+\n/gm,''));
 const target=path.join(__dirname,'r2EmployeeTerminalAcceptance.web.js');
 if(process.argv.includes('--check')){if(text('r2EmployeeTerminalAcceptance.web.js')!==source)throw Error('New employee terminal diagnostic drift');}
 else fs.writeFileSync(target,source);
 const pageTarget=path.join(__dirname,'r2-employee-terminal-page.candidate.js');
 if(process.argv.includes('--check')){if(text('r2-employee-terminal-page.candidate.js')!==pageSource)throw Error('New employee terminal page drift');}
 else fs.writeFileSync(pageTarget,pageSource);
 process.stdout.write('New employee terminal diagnostic compiled CLOSED; 2 fixed original employee profiles, no old fixtures/delete/business writes\n');
}
module.exports={source,probeBody,authorityBuild,probeSourceSha256,pageAddition,pageSource};
