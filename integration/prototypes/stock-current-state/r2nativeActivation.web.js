import { items } from '@wix/data';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { createHash } from 'crypto';
import { inspectNativeReadPrerequisites } from 'backend/r2readPreflight.web.js';
import { inspectActivationAuditSchema } from 'backend/r2activationSchema.web.js';
import { inspectFreshCohort } from 'backend/r2cohortBootstrap.web.js';
const COHORT="MASTER_20261024_R2";
const WRITERS=Object.freeze(["RECEIPT","ALLOCATION","BORROWING","SALES_DEMAND","PURCHASE_SOURCE","PURCHASE_PLAN","PURCHASE_TASK","STOCK_EXCEPTION","STOCK_RESOLUTION","PACKING","WAREHOUSE_PREPARATION","SHIPMENT","ORDER_INTAKE","ORDER_UPDATE","COST_REFERENCE","MARGIN_REFERENCE","SHIPMENT_PLAN","QUANTITY_CASE","PURCHASE_ORDER_RECORD","ACCOUNT_PURCHASE_RECORD"]);
const REQUIRED=Object.freeze(["isolation","nativeSchema","nativeQueries","nativeConditionalWrites","nativeCapacity","nativeRecovery","pairedInstallation"]);
const stable=value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const sha256=value => createHash('sha256').update(stable(value)).digest('hex');
const businessBuild="f9fe1c19caa991b166ab2852956cd7f47712117c";
const bindings={"NCT":{"cohort":"MASTER_20261024_R2","company":"NCT","build":"f9fe1c19caa991b166ab2852956cd7f47712117c","checks":{},"writers":{}},"GHR":{"cohort":"MASTER_20261024_R2","company":"GHR","build":"f9fe1c19caa991b166ab2852956cd7f47712117c","checks":{},"writers":{}}};
const employeeContract={"authorityBuild":"03ca8d21023736f45e2526f0d503989ab29bcea6","probeSourceSha256":"93f04d5946b74481eff770786c958ffe53488955df15e2d3aa280bea3306ec9a"};
const terminalPrefixes={"PURCHASE":"SPT-R2TERMINAL-PURCHASE-20261025-d491:","WAREHOUSE":"SPT-R2TERMINAL-WAREHOUSE-20261025-b381:"};
async function inspectRetainedEmployeeTerminals({ items, contract, prefixes }) {
  const profiles = ['PURCHASE','WAREHOUSE'];
  const ids = profiles.flatMap(profile => ['CONDITIONAL','BULK-A','BULK-B','TERMINAL'].map(name => prefixes[profile] + name));
  const page = await items.query('StockProtocolTest').hasSome('_id',ids).limit(9).find({consistentRead:true,returnTotalCount:true});
  if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount !== page.items.length
    || page.totalCount > 8 || new Set(page.items.map(row => row?._id)).size !== page.items.length
    || page.items.some(row => !ids.includes(row?._id) || row.company !== 'NCT')) throw Error('Complete fixed employee terminal images required');
  const nativeMethods = { elevatedQueryConfirmed:true,elevatedInsertConfirmed:true,elevatedBulkInsertConfirmed:true,
    elevatedPatchConfirmed:true,staleConditionRejected:true,ordinaryStaffAuthorizationAccepted:true,ordinaryReadDenied:true,finalValue:17 };
  return profiles.map(profile => {
    const selected = page.items.filter(row => row._id.startsWith(prefixes[profile]));
    const terminal = selected.find(row => row._id === prefixes[profile] + 'TERMINAL');
    const actorHash = terminal?.details?.actorHash;
    const details = { schema:'R2_EMPLOYEE_TERMINAL_RECEIPT_V1',cohort:COHORT,profile,
      authorityBuild:contract.authorityBuild,probeSourceSha256:contract.probeSourceSha256,actorHash,evidence:nativeMethods };
    const complete = selected.length === 4 && /^[a-f0-9]{64}$/.test(actorHash || '')
      && stable(terminal.details) === stable(details) && terminal.stockCommitVersion === sha256(details).slice(0,32)
      && ['CONDITIONAL','BULK-A','BULK-B'].every((name,index) => {
        const row = selected.find(row => row._id === prefixes[profile] + name);
        return row?.stockCommitVersion === (index ? 'AUTH-BULK' : 'AUTH-V1')
          && stable(row.details) === stable({probe:'R2_AUTHORITY_V1',value:index || 17,zero:0,absent:null,tags:['same','request']});
      });
    return { schema:'R2_EMPLOYEE_TERMINAL_ACCEPTANCE_V1',cohort:COHORT,profile,...contract,step:'INSPECT',ok:true,
      stage:'READ_ONLY_TERMINAL_INSPECTION',retainedRecords:selected.length,terminalReceiptVerified:complete,
      ordinaryStaffWriteAccepted:complete,mutationAttempted:false,oldFixturesAccessed:false,businessAuthorizationAccepted:false,
      writerCoverageAccepted:false,activationAllowed:false,inspectionAuthority:'ADMIN_FIXED_RETAINED_IMAGES',
      terminalImagesSha256:sha256(selected.map(row => ({_id:row._id,company:row.company,
        stockCommitVersion:row.stockCommitVersion,details:row.details})).sort((a,b)=>a._id.localeCompare(b._id))) };
  });
}
function createNativeActivationEvidence({ company, build, bindings, authenticateAdmin,
  readTerminalImages, inspectReadPrerequisites, inspectAuditSchema, inspectFreshBusiness,
  employeeContract, inspectEmployeeTerminals }) {
  const hex = (value, length) => typeof value === 'string' && new RegExp('^[a-f0-9]{' + length + '}$').test(value);
  if (!['NCT', 'GHR'].includes(company) || !hex(build, 40)
    || !bindings || bindings.cohort !== COHORT || bindings.company !== company || bindings.build !== build
    || !employeeContract || !hex(employeeContract.authorityBuild,40) || !hex(employeeContract.probeSourceSha256,64)
    || [authenticateAdmin, readTerminalImages, inspectReadPrerequisites, inspectAuditSchema, inspectFreshBusiness, inspectEmployeeTerminals].some(fn => typeof fn !== 'function')) {
    throw Error('Fixed native activation evidence dependencies required');
  }
  // Copy at construction: an external caller cannot mutate a captured binding
  // after authorization. Only an exact retained image previously accepted by the
  // native procedure can satisfy a binding. Empty maps are deliberately valid
  // for inspection and can NEVER activate a company.
  const fixed = JSON.parse(JSON.stringify(bindings));
  const employeeProof = JSON.parse(JSON.stringify(employeeContract));
  const subjects = [...REQUIRED.filter(name => !['nativeSchema', 'nativeQueries', 'nativeConditionalWrites'].includes(name)).map(name => ['CHECK', name]),
    ...WRITERS.map(name => ['WRITER', name])];
  if (Object.keys(fixed).sort().join(',') !== 'build,checks,cohort,company,writers'
    || !fixed.checks || !fixed.writers || Array.isArray(fixed.checks) || Array.isArray(fixed.writers)
    || Object.keys(fixed.checks).some(name => !subjects.some(([kind, subject]) => kind === 'CHECK' && subject === name))
    || Object.keys(fixed.writers).some(name => !WRITERS.includes(name))) throw Error('Only fixed native proof subjects are accepted');
  const references = subjects.map(([kind, subject]) => {
    const ref = (kind === 'CHECK' ? fixed.checks : fixed.writers)[subject];
    if (ref === undefined) return { kind, subject, ref: null };
    if (!ref || Object.keys(ref).sort().join(',') !== 'id,sha256'
      || typeof ref.id !== 'string' || !ref.id.startsWith('SPT-R2ACCEPT-' + company + ':')
      || ref.id.length > 200 || !hex(ref.sha256, 64)) throw Error('Pinned native terminal address and image hash required');
    return { kind, subject, ref };
  });
  const ids = references.filter(row => row.ref).map(row => row.ref.id);
  if (new Set(ids).size !== ids.length) throw Error('Each native proof must have its own retained terminal');
  async function authorize(owner) {
    const actor = await authenticateAdmin();
    if (actor?.isAdmin !== true || typeof actor.memberId !== 'string' || !actor.memberId
      || actor.memberId.length > 200 || owner && actor.memberId !== owner) throw Error('Same actual administrator required');
    return actor.memberId;
  }
  function scope(input) {
    if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'build,cohort,company'
      || input.cohort !== COHORT || input.company !== company || input.build !== build) throw Error('Exact server-owned evidence scope required');
  }
  function terminal(ref, row) {
    if (!row || row._id !== ref.ref.id || row.company !== company || typeof row.stockCommitVersion !== 'string'
      || !row.stockCommitVersion || !row.details || sha256({ _id: row._id, company: row.company,
        stockCommitVersion: row.stockCommitVersion, details: row.details }) !== ref.ref.sha256) return false;
    const d = row.details;
    return d.schema === 'R2_NATIVE_ACCEPTANCE_TERMINAL_V1' && d.cohort === COHORT && d.company === company
      && d.build === build && d.kind === ref.kind && d.subject === ref.subject && d.outcome === 'VERIFIED'
      && d.source === 'SERVER_NATIVE_PROCEDURE' && hex(d.procedureSha256, 64)
      && hex(d.observationsSha256, 64) && d.realInvoiceEnabled === false && d.physicalDispatchEnabled === false;
  }
  async function readImages() {
    if (!ids.length) return [];
    const rows = await readTerminalImages([...ids]);
    if (!Array.isArray(rows) || rows.length !== ids.length
      || new Set(rows.filter(Boolean).map(row => row._id)).size !== rows.filter(Boolean).length
      || rows.some((row, index) => row !== null && row?._id !== ids[index])) throw Error('Ordered exact native terminal observations required');
    return JSON.parse(JSON.stringify(rows));
  }
  async function inspect(input) {
    scope(input);
    const owner = await authorize(), before = await readImages(), gaps = [];
    // Existing native readers perform real metadata + query calls. Never turn
    // old empty-query reports or local tests into current populated semantics.
    const audit = await inspectAuditSchema({});
    const reads = [];
    for (const name of ['ORDERS', 'TASKS', 'JOURNAL', 'PURCHASE_ORDERS', 'PRODUCTS', 'POSITIONS', 'CLAIMS']) {
      await authorize(owner);
      const result = await inspectReadPrerequisites({ company, scope: name });
      if (result?.schema !== 'R2_NATIVE_READ_PREFLIGHT_V1' || result.cohort !== COHORT || result.company !== company
        || result.scope !== name || result.schemaMatches !== true || result.issues?.length !== 0
        || !hex(result.metadataSha256, 64) || !Array.isArray(result.queries) || result.queriesExecuted !== result.queries.length
        || result.queries.length < 2 || result.queries.some(q => !q?.name || !Number.isSafeInteger(q.totalCount)
          || q.totalCount < 0 || q.returnedRows !== Math.min(1, q.totalCount)) || result.mutationCapability !== false) {
        throw Error('Fresh native read prerequisites not verified: ' + name);
      }
      reads.push(result);
    }
    const empty = await inspectFreshBusiness({ cohort: COHORT, company });
    if (empty?.cohort !== COHORT || empty.company !== company || empty.emptyBusiness !== true
      || empty.pending !== false || empty.unknownRecords !== false) gaps.push('FRESH_BUSINESS_NOT_EMPTY');
    const auditMatches = audit?.schema === 'R2_ACTIVATION_AUDIT_SCHEMA_V1' && audit.cohort === COHORT
      && audit.activationAuditSchemaMatches === true && audit.issues?.length === 0 && audit.mutationCapability === false
      && Array.isArray(audit.rows) && audit.rows.length === 2
      && ['R2NCTActivity', 'R2NCTActivity1'].every(name => audit.rows.filter(row => row.collection === name
        && hex(row.metadataSha256, 64) && row.requiredFieldsReviewed === 14).length === 1);
    // Reuse the two completed employee terminals via their existing read-only
    // inspectors. No second RUN, copied receipt, new proof row or arming gate.
    const employee = await inspectEmployeeTerminals();
    const conditionalWrites = Array.isArray(employee) && employee.length === 2
      && ['PURCHASE','WAREHOUSE'].every(profile => employee.filter(row => row?.schema === 'R2_EMPLOYEE_TERMINAL_ACCEPTANCE_V1'
        && row.cohort === COHORT && row.profile === profile && row.step === 'INSPECT' && row.ok === true
        && row.stage === 'READ_ONLY_TERMINAL_INSPECTION' && row.authorityBuild === employeeProof.authorityBuild
        && row.probeSourceSha256 === employeeProof.probeSourceSha256 && row.retainedRecords === 4
        && row.terminalReceiptVerified === true && row.ordinaryStaffWriteAccepted === true && row.mutationAttempted === false
        && row.oldFixturesAccessed === false && row.businessAuthorizationAccepted === false
        && row.writerCoverageAccepted === false && row.activationAllowed === false).length === 1);
    const checks = { nativeSchema: auditMatches, nativeQueries: true, nativeConditionalWrites: conditionalWrites }, writers = {};
    if (!auditMatches) gaps.push('NATIVE_AUDIT_SCHEMA');
    if (!conditionalWrites) gaps.push('NATIVE_EMPLOYEE_METHODS_UNCONFIRMED');
    for (const reference of references) {
      const accepted = !!reference.ref && terminal(reference, before[ids.indexOf(reference.ref.id)]);
      if (reference.kind === 'CHECK') checks[reference.subject] = accepted;
      else writers[reference.subject] = { verified: accepted, build };
      if (!accepted) gaps.push(reference.kind + ':' + reference.subject + (reference.ref ? ':IMAGE_UNCONFIRMED' : ':NO_NATIVE_BINDING'));
    }
    await authorize(owner);
    const after = await readImages();
    if (stable(before) !== stable(after)) throw Error('Native terminal evidence changed during verification');
    await authorize(owner);
    const digest = sha256({ cohort: COHORT, company, build, bindings: fixed, images: before,
      audit, reads, empty, employeeProof, employee, checks, writers });
    return { schema: 'R2_NATIVE_ACTIVATION_EVIDENCE_V1', cohort: COHORT, company, build, digest, checks, writers,
      gaps, activationAllowed: gaps.length === 0, realInvoiceEnabled: false, physicalDispatchEnabled: false,
      mutationCapability: false, businessAcceptanceImplied: false };
  }
  async function verify(input) {
    const result = await inspect(input);
    if (!result.activationAllowed) throw Error('Native acceptance incomplete: ' + result.gaps.join(';'));
    return result;
  }
  return { inspect, verify };
}
async function authenticateAdmin(){const member=await currentMember.getMember({fieldsets:['FULL']});if(member?.status!=='APPROVED'||typeof member._id!=='string'||!member._id||member._id.length>200)throw Error('Actual approved administrator required');return{isAdmin:true,memberId:member._id};}
async function readTerminalImages(ids){if(!Array.isArray(ids)||!ids.length||ids.length>25||ids.some(id=>typeof id!=='string'||!/^SPT-R2ACCEPT-(NCT|GHR):/.test(id)))throw Error('Fixed native terminal scope required');const page=await items.query('StockProtocolTest').hasSome('_id',ids).limit(ids.length+1).find({consistentRead:true,returnTotalCount:true});if(!Array.isArray(page?.items)||!Number.isSafeInteger(page.totalCount)||page.totalCount!==page.items.length||page.totalCount>ids.length||new Set(page.items.map(row=>row._id)).size!==page.items.length||page.items.some(row=>!ids.includes(row._id)))throw Error('Complete native terminal read required');return ids.map(id=>page.items.find(row=>row._id===id)||null);}
async function inspectFreshBusiness({cohort,company}){if(cohort!==COHORT||!['NCT','GHR'].includes(company))throw Error('Fixed fresh business scope required');const result=await inspectFreshCohort({});if(result?.cohort!==COHORT||result.system!=='MASTER'||result.emptyBusiness!==true||!Array.isArray(result.rows)||result.rows.length!==12)throw Error('Native empty cohort not verified');return{cohort:COHORT,company,emptyBusiness:true,pending:false,unknownRecords:false};}
export const inspectNativeActivation=webMethod(Permissions.Admin,async input=>{if(!input||Array.isArray(input)||Object.keys(input).join(',')!=='company'||!['NCT','GHR'].includes(input.company))throw Error('Only a fixed company may be inspected');const company=input.company;const service=createNativeActivationEvidence({company,build:businessBuild,bindings:bindings[company],authenticateAdmin,readTerminalImages,inspectReadPrerequisites:inspectNativeReadPrerequisites,inspectAuditSchema:inspectActivationAuditSchema,inspectFreshBusiness,employeeContract,inspectEmployeeTerminals:()=>inspectRetainedEmployeeTerminals({items,contract:employeeContract,prefixes:terminalPrefixes})});const result=await service.inspect({cohort:COHORT,company,build:businessBuild});console.info('R2_NATIVE_ACTIVATION_RECEIPT '+JSON.stringify(result));return result;});
export const inspectRetainedEmployeeEvidence=webMethod(Permissions.Admin,async input=>{if(!input||Array.isArray(input)||Object.keys(input).length)throw Error('Empty fixed employee evidence request required');const owner=(await authenticateAdmin()).memberId;const profiles=await inspectRetainedEmployeeTerminals({items,contract:employeeContract,prefixes:terminalPrefixes});if((await authenticateAdmin()).memberId!==owner)throw Error('Same actual administrator required');const result={schema:'R2_RETAINED_EMPLOYEE_EVIDENCE_V1',cohort:COHORT,build:businessBuild,profiles,nativeMethodsVerified:profiles.every(row=>row.terminalReceiptVerified===true),digest:sha256(profiles),mutationCapability:false,writerCoverageAccepted:false,activationAllowed:false};console.info('R2_RETAINED_EMPLOYEE_RECEIPT '+JSON.stringify(result));return result;});
