'use strict';
// Native Admin reader for the activation verifier; no activation export while
// all-writer native proof is incomplete. The current business graph is unchanged.
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { COHORT } = require('./isolated-cohort.cjs');
const { WRITERS } = require('./stock-admission.cjs');
const { REQUIRED } = require('./fresh-cohort-activation.cjs');
const { createNativeActivationEvidence, inspectRetainedEmployeeTerminals, sha256 } = require('./native-activation-evidence.cjs');
const { stable } = require('./fresh-cohort-activation-schema.cjs');
const { buildIsolatedCohort } = require('./build-isolated-cohort.cjs');
const { authorityBuild, probeSourceSha256 } = require('./build-r2-employee-terminal-acceptance.cjs');
const { terminalPrefixes } = require('./r2-employee-terminal-acceptance.cjs');
const employeeContract = { authorityBuild, probeSourceSha256 };
// Keep current native readers as their own authoritative implementations. The
// new endpoint composes their already-installed Admin webMethods read-only.
const packet = buildIsolatedCohort();
const graph = [...packet.output].filter(([name]) => name.endsWith('.js')).map(([name,source]) =>
  [name, createHash('sha256').update(source).digest('hex')]).sort(([a],[b]) => a.localeCompare(b));
const businessBuild = sha256(graph).slice(0,40);
// No proof is inferred from local tests or the old isolated SDK/borrow fixture.
// Exact native terminal bindings are added only after their actual procedure has
// completed and its retained observations have been independently inspected.
const bindings = Object.fromEntries(['NCT','GHR'].map(company => [company,
  { cohort: COHORT, company, build: businessBuild, checks: {}, writers: {} }]));
const source = [
  "import { items } from '@wix/data';",
  "import { webMethod, Permissions } from 'wix-web-module';",
  "import { currentMember } from 'wix-members-backend';",
  "import { createHash } from 'crypto';",
  "import { inspectNativeReadPrerequisites } from 'backend/r2readPreflight.web.js';",
  "import { inspectActivationAuditSchema } from 'backend/r2activationSchema.web.js';",
  "import { inspectFreshCohort } from 'backend/r2cohortBootstrap.web.js';",
  'const COHORT=' + JSON.stringify(COHORT) + ';',
  'const WRITERS=Object.freeze(' + JSON.stringify(WRITERS) + ');',
  'const REQUIRED=Object.freeze(' + JSON.stringify(REQUIRED) + ');',
  'const stable=' + stable.toString() + ';', 'const sha256=' + sha256.toString() + ';',
  'const businessBuild=' + JSON.stringify(businessBuild) + ';',
  'const bindings=' + JSON.stringify(bindings) + ';',
  'const employeeContract=' + JSON.stringify(employeeContract) + ';',
  'const terminalPrefixes=' + JSON.stringify(terminalPrefixes) + ';',
  inspectRetainedEmployeeTerminals.toString(),
  createNativeActivationEvidence.toString(),
  "async function authenticateAdmin(){const member=await currentMember.getMember({fieldsets:['FULL']});if(member?.status!=='APPROVED'||typeof member._id!=='string'||!member._id||member._id.length>200)throw Error('Actual approved administrator required');return{isAdmin:true,memberId:member._id};}",
  "async function readTerminalImages(ids){if(!Array.isArray(ids)||!ids.length||ids.length>25||ids.some(id=>typeof id!=='string'||!/^SPT-R2ACCEPT-(NCT|GHR):/.test(id)))throw Error('Fixed native terminal scope required');const page=await items.query('StockProtocolTest').hasSome('_id',ids).limit(ids.length+1).find({consistentRead:true,returnTotalCount:true});if(!Array.isArray(page?.items)||!Number.isSafeInteger(page.totalCount)||page.totalCount!==page.items.length||page.totalCount>ids.length||new Set(page.items.map(row=>row._id)).size!==page.items.length||page.items.some(row=>!ids.includes(row._id)))throw Error('Complete native terminal read required');return ids.map(id=>page.items.find(row=>row._id===id)||null);}",
  "async function inspectFreshBusiness({cohort,company}){if(cohort!==COHORT||!['NCT','GHR'].includes(company))throw Error('Fixed fresh business scope required');const result=await inspectFreshCohort({});if(result?.cohort!==COHORT||result.system!=='MASTER'||result.emptyBusiness!==true||!Array.isArray(result.rows)||result.rows.length!==12)throw Error('Native empty cohort not verified');return{cohort:COHORT,company,emptyBusiness:true,pending:false,unknownRecords:false};}",
  "export const inspectNativeActivation=webMethod(Permissions.Admin,async input=>{if(!input||Array.isArray(input)||Object.keys(input).join(',')!=='company'||!['NCT','GHR'].includes(input.company))throw Error('Only a fixed company may be inspected');const company=input.company;const service=createNativeActivationEvidence({company,build:businessBuild,bindings:bindings[company],authenticateAdmin,readTerminalImages,inspectReadPrerequisites:inspectNativeReadPrerequisites,inspectAuditSchema:inspectActivationAuditSchema,inspectFreshBusiness,employeeContract,inspectEmployeeTerminals:()=>inspectRetainedEmployeeTerminals({items,contract:employeeContract,prefixes:terminalPrefixes})});const result=await service.inspect({cohort:COHORT,company,build:businessBuild});console.info('R2_NATIVE_ACTIVATION_RECEIPT '+JSON.stringify(result));return result;});",
  // The whole verification path hit two native 504s. Do not repeat it. This
  // separate bounded reader performs ONE fixed SDK query, with no receipt write,
  // retry, mode switch or adoption of the earlier timed-out invocations.
  "export const inspectRetainedEmployeeEvidence=webMethod(Permissions.Admin,async input=>{if(!input||Array.isArray(input)||Object.keys(input).length)throw Error('Empty fixed employee evidence request required');const owner=(await authenticateAdmin()).memberId;const profiles=await inspectRetainedEmployeeTerminals({items,contract:employeeContract,prefixes:terminalPrefixes});if((await authenticateAdmin()).memberId!==owner)throw Error('Same actual administrator required');const result={schema:'R2_RETAINED_EMPLOYEE_EVIDENCE_V1',cohort:COHORT,build:businessBuild,profiles,nativeMethodsVerified:profiles.every(row=>row.terminalReceiptVerified===true),digest:sha256(profiles),mutationCapability:false,writerCoverageAccepted:false,activationAllowed:false};console.info('R2_RETAINED_EMPLOYEE_RECEIPT '+JSON.stringify(result));return result;});", ''
].join('\n');
if (require.main === module) {
  new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
  const target = path.join(__dirname,'r2nativeActivation.web.js');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n') !== source) throw Error('Native activation verifier drift');
  } else fs.writeFileSync(target,source);
  process.stdout.write('Native activation inspector compiled; missing native proofs stay blocked; no business activation export\n');
}
module.exports = { source, businessBuild, bindings, graph, employeeContract };
