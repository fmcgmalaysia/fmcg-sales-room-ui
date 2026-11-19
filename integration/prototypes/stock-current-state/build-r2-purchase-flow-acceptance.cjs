'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {verifyR2PurchaseFlow}=require('./r2-purchase-flow-acceptance.cjs');
const {stable}=require('./fresh-cohort-activation-schema.cjs');
const {businessBuild}=require('./build-native-activation-evidence.cjs');
const body=verifyR2PurchaseFlow.toString().replace(/\r\n/g,'\n');
const acceptanceBuild=createHash('sha256').update(businessBuild+'\n'+body).digest('hex').slice(0,40);
const source=[
  "import { items as sdkItems } from '@wix/data';",
  "import { auth } from '@wix/essentials';",
  "import { webMethod, Permissions } from 'wix-web-module';",
  "import { currentMember } from 'wix-members-backend';",
  "import wixData from 'wix-data';",
  "import { createHash } from 'crypto';",
  "import { planCollections, createSdkConditionalStore, createSegmentedFencedProof, createCurrentOrderIntakeOperations, createCurrentPurchaseSave } from 'backend/r2stockCurrentCommands.js';",
  "import { createNctIntake, createNctReceiptReader } from 'backend/r2nctIntake.js';",
  "import { requirePurchaseStaff, projectPurchaseWorkspace } from 'backend/r2purchaseProjection.js';",
  "import { createPurchaseOperations } from 'backend/r2purchaseOperations.js';",
  "import { createPurchaseSourceOperations } from 'backend/r2purchaseSources.js';",
  "import { taskEditVersion } from 'backend/r2purchaseTaskIdentity.js';",
  "import { operationId } from 'backend/r2purchaseOperationJournal.js';",
  "import { projectPurchaseOrders } from 'backend/r2purchaseOrderWorkflow.js';",
  "import { readAllocations } from 'backend/r2plannerAllocation.js';",
  "import { readCustomerShipments } from 'backend/r2customerShipmentLedger.js';",
  "import { readPackingLists } from 'backend/r2packingListOperations.js';",
  "import { packingHeld } from 'backend/r2packingListModel.js';",
  "const hash=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);",
  'const stable='+stable.toString()+';',
  'const copy=value=>JSON.parse(JSON.stringify(value));',
  'const runtime={planCollections,createSdkConditionalStore,createSegmentedFencedProof,createCurrentOrderIntakeOperations,createCurrentPurchaseSave};',
  'const original={createNctIntake,createNctReceiptReader,requirePurchaseStaff,projectPurchaseWorkspace,createPurchaseOperations,createPurchaseSourceOperations,taskEditVersion,operationId,projectPurchaseOrders,readAllocations,readCustomerShipments,readPackingLists,packingHeld};',
  body,
  // Same original StaffMasterAccess lookup and original grant calculator. This
  // diagnostic does not add/alter employee records, grants or CMS permissions.
  "async function authenticate(){const member=await currentMember.getMember({fieldsets:['FULL']});if(!member?._id||!member.loginEmail||member.status!=='APPROVED')throw Error('Actual approved Purchase employee required');let page=await wixData.query('StaffMasterAccess').limit(1000).find({suppressAuth:true,consistentRead:true});const staffRows=[...page.items];while(page.hasNext()){page=await page.next();staffRows.push(...page.items);}const staff=requirePurchaseStaff(member,staffRows);return{member,staffRows,staffId:staff.staffId};}",
  'const R2_PURCHASE_FLOW_ENABLED=false;',
  'const acceptanceBuild='+JSON.stringify(acceptanceBuild)+';',
  "export const verifyPurchaseWorkflow=webMethod(Permissions.SiteMember,async input=>{if(!input||Array.isArray(input)||Object.keys(input).join(',')!=='step'||!['SEED','INTAKE','PLAN','PO','INSPECT'].includes(input.step))throw Error('Fixed Purchase workflow step required');if(!R2_PURCHASE_FLOW_ENABLED&&input.step!=='INSPECT'){const result={...(await verifyR2PurchaseFlow({input,enabled:false})),acceptanceBuild};console.info('R2_PURCHASE_WORKFLOW_RECEIPT '+JSON.stringify(result));return result;}const actor=await authenticate();const items={query:auth.elevate(sdkItems.query),insert:auth.elevate(sdkItems.insert),bulkInsert:auth.elevate(sdkItems.bulkInsert),patch:auth.elevate(sdkItems.patch),remove:()=>{throw Error('NO_DELETE_CAPABILITY');}};const originalAuthenticate=async()=>{const next=await authenticate();if(next.member._id!==actor.member._id||next.staffId!==actor.staffId)throw Error('Same original Purchase employee required');return next;};const result={...(await verifyR2PurchaseFlow({input,enabled:R2_PURCHASE_FLOW_ENABLED,items,runtime,original,authenticate:originalAuthenticate,hash,stable,copy})),acceptanceBuild};console.info('R2_PURCHASE_WORKFLOW_RECEIPT '+JSON.stringify(result));return result;});",''
].join('\n');
const text=file=>fs.readFileSync(path.join(__dirname,file),'utf8').replace(/\r\n/g,'\n');
const beforePage=text('r2-employee-terminal-page.candidate.js');
if(createHash('sha256').update(beforePage).digest('hex')!=='58728f7ff951fc3c44b1cf658ba5d34a9a148de2cbfcb7402873b7a04cb55e67')throw Error('Exact CLOSED existing diagnostic page required');
const pageAddition=text('r2-purchase-flow-page.additions.js').replace('__PURCHASE_FLOW_ACCEPTANCE_BUILD__',acceptanceBuild);
const pageSource=beforePage+'\n'+pageAddition;
if(require.main===module){
  new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
  const file=path.join(__dirname,'r2PurchaseFlowAcceptance.web.js');
  if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Purchase native workflow diagnostic drift');}
  else fs.writeFileSync(file,source);
  const pageFile=path.join(__dirname,'r2-purchase-flow-page.candidate.js');
  if(process.argv.includes('--check')){if(fs.readFileSync(pageFile,'utf8').replace(/\r\n/g,'\n')!==pageSource)throw Error('Purchase workflow diagnostic page drift');}
  else fs.writeFileSync(pageFile,pageSource);
  new Function(pageSource.replace(/^import[^\n]+\n/gm,''));
  process.stdout.write('Purchase native workflow diagnostic compiled CLOSED; new fixed fixture only; no business activation\n');
}
module.exports={source,acceptanceBuild,pageAddition,pageSource,businessBuild};
