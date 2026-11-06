import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { getPurchaseStaffContext } from 'backend/r2purchaseAccess.js';
import { requireWarehouseStaff } from 'backend/r2warehouseReceiving.js';
import { fulfilmentStore } from 'backend/r2customerFulfilmentService.js';
import { createHash } from 'crypto';
const COHORT="MASTER_20261024_R2";
const stable=value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const terminalPrefixes=Object.freeze({"PURCHASE":"SPT-R2TERMINAL-PURCHASE-20261025-d491:","WAREHOUSE":"SPT-R2TERMINAL-WAREHOUSE-20261025-b381:"});
// Fresh fixed retained records only. No production/employee/CMS ACL mutation.
async function verifyR2SdkAuthority({items,elevate,input,enabled=false,fixture='ADMIN',requireUnprivileged=false,now=()=>Date.now()}){
 if(!input||Array.isArray(input)||Object.keys(input).join(',')!=='step'||!['RUN','INSPECT'].includes(input.step))throw Error('Exact authority probe step required');
 const prefixes={ADMIN:'SPT-R2TERMINAL-UNEXPORTED-ADMIN-20261025-fd09:',PURCHASE:'SPT-R2TERMINAL-PURCHASE-20261025-d491:',WAREHOUSE:'SPT-R2TERMINAL-WAREHOUSE-20261025-b381:'};
 if(!Object.hasOwn(prefixes,fixture)||fixture!=='ADMIN'&&input.step!=='INSPECT'&&requireUnprivileged!==true)throw Error('Fixed original employee authority fixture required');
 const table='StockProtocolTest',prefix=prefixes[fixture],ids=['CONDITIONAL','BULK-A','BULK-B'].map(id=>prefix+id);
 const started=now(),operations={queries:0,inserts:0,bulkInserts:0,patchAttempts:0};let mutationAttempted=false,stage='PREFLIGHT';
 const report=(ok,extra={})=>({ok,schema:'R2_SDK_AUTHORITY_PROBE_V1',step:input.step,stage,elapsedMs:now()-started,operations:{...operations},mutationAttempted,
  fixedCollection:table,fixedRecordCount:3,ordinaryStaffAuthorizationAccepted:false,businessAuthorizationAccepted:false,activationReady:false,...extra});
 if(!enabled&&input.step!=='INSPECT')return report(false,{stage:'CLOSED',blocked:true});
 const query=elevate(items.query),insert=elevate(items.insert),bulkInsert=elevate(items.bulkInsert),patch=elevate(items.patch);
 const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 const data=(value)=>({probe:'R2_AUTHORITY_V1',value,zero:0,absent:null,tags:['same','request']});
 const expected=ids.map((id,index)=>({_id:id,company:'NCT',stockCommitVersion:index?'AUTH-BULK':'AUTH-V1',details:data(index?index:17)}));
 async function read(){operations.queries++;const page=await (await query(table)).hasSome('_id',ids).limit(4).find({consistentRead:true,returnTotalCount:true});
  if(!Array.isArray(page?.items)||!Number.isSafeInteger(page.totalCount)||page.totalCount>3||page.items.length!==page.totalCount
   ||new Set(page.items.map(row=>row._id)).size!==page.items.length||page.items.some(row=>!ids.includes(row._id)||row.company!=='NCT'))throw Error('Exact complete authority read required');return page.items;}
 function complete(rows){return rows.length===3&&expected.every(wanted=>{const row=rows.find(row=>row._id===wanted._id);return row?.stockCommitVersion===wanted.stockCommitVersion
  &&JSON.stringify(stable(row.details))===JSON.stringify(stable(wanted.details));});}
 try{
  if(requireUnprivileged){
   stage='ORDINARY_PERMISSION_BASELINE';operations.queries++;let denied=false;
   try{await items.query(table).hasSome('_id',ids).limit(4).find({consistentRead:true,returnTotalCount:true});}
   catch(error){denied=/\bWDE0027\b/.test(String(error?.message||''))||error?.code==='PERMISSION_DENIED'||error?.details?.applicationError?.code==='PERMISSION_DENIED';if(!denied)throw error;}
   if(!denied)return report(false,{stage:'PRIVILEGED_CONTEXT',blocked:true,error:'Ordinary SDK read denial required; administrator context is not employee acceptance'});
  }
  const before=await read();if(input.step==='INSPECT'){stage='READ_ONLY_INSPECTION';return report(true,{retainedRecords:before.length,complete:complete(before),ordinaryStaffReadAccepted:requireUnprivileged,ordinaryReadDenied:requireUnprivileged,versions:before.map(row=>({id:row._id,version:row.stockCommitVersion}))});}
  if(before.length)throw Error('Occupied dedicated authority fixture; no reset, adoption or retry');
  stage='INSERT';mutationAttempted=true;operations.inserts++;await insert(table,{...expected[0],stockCommitVersion:'AUTH-V0',details:data(10)});
  stage='BULK_INSERT';operations.bulkInserts++;await bulkInsert(table,expected.slice(1));
  stage='CONDITIONAL_PATCH';operations.patchAttempts++;await (await patch(table,ids[0])).setField('details',data(17)).setField('stockCommitVersion','AUTH-V1')
   .run({condition:{company:{$eq:'NCT'},stockCommitVersion:{$eq:'AUTH-V0'}}});
  if(!complete(await read()))throw Error('Elevated conditional after-image unconfirmed');
  stage='STALE_CONDITION';operations.patchAttempts++;let staleRejected=false;
  try{await (await patch(table,ids[0])).setField('details',data(999)).setField('stockCommitVersion','FORBIDDEN-STALE')
   .run({condition:{company:{$eq:'NCT'},stockCommitVersion:{$eq:'AUTH-V0'}}});}
  catch(error){staleRejected=/WDE0193|[Cc]ondition (?:not met|mismatch)/.test(String(error?.message||''));if(!staleRejected)throw error;}
  if(!staleRejected||!complete(await read()))throw Error('Elevated stale version was not safely rejected');
  stage='NATIVE_METHODS_CONFIRMED';return report(true,{retainedRecords:3,elevatedQueryConfirmed:true,elevatedInsertConfirmed:true,elevatedBulkInsertConfirmed:true,
   elevatedPatchConfirmed:true,staleConditionRejected:true,finalValue:17,deletions:0,permissionsChanged:false,
   ordinaryStaffAuthorizationAccepted:requireUnprivileged,ordinaryReadDenied:requireUnprivileged});
 }catch(error){return report(false,{error:error.message,retainRecords:true,noAutomaticRetryResetOrCleanup:true});}
}

function createEmployeeTerminalAcceptance({ profile, authorityBuild, probeSourceSha256, probe, items, elevate, authenticate, enabled = false }) {
  if (!Object.hasOwn(terminalPrefixes, profile) || !/^[a-f0-9]{40}$/.test(authorityBuild || '')
    || !/^[a-f0-9]{64}$/.test(probeSourceSha256 || '') || typeof probe !== 'function' || typeof elevate !== 'function'
    || typeof authenticate !== 'function' || ['query','insert'].some(name => typeof items?.[name] !== 'function')) throw Error('Fixed employee terminal dependencies required');
  const prefix = terminalPrefixes[profile], table = 'StockProtocolTest';
  const ids = ['CONDITIONAL','BULK-A','BULK-B','TERMINAL'].map(name => prefix + name), terminalId = ids[3];
  const digest = value => createHash('sha256').update(stable(value)).digest('hex');
  const data = value => ({ probe:'R2_AUTHORITY_V1',value,zero:0,absent:null,tags:['same','request'] });
  const expected = ids.slice(0,3).map((id,index) => ({ _id:id,company:'NCT',stockCommitVersion:index?'AUTH-BULK':'AUTH-V1',details:data(index?index:17) }));
  const evidence = Object.freeze({ elevatedQueryConfirmed:true,elevatedInsertConfirmed:true,elevatedBulkInsertConfirmed:true,
    elevatedPatchConfirmed:true,staleConditionRejected:true,ordinaryStaffAuthorizationAccepted:true,ordinaryReadDenied:true,finalValue:17 });
  async function authorize(owner) {
    const actor = await authenticate();
    if (typeof actor?.memberId !== 'string' || !actor.memberId || actor.memberId.length > 200
      || typeof actor.staffId !== 'string' || !actor.staffId || actor.staffId.length > 200) throw Error('Original employee identity required');
    const key = digest([profile,actor.memberId,actor.staffId]);
    if (owner && owner !== key) throw Error('Same original employee required');
    return key;
  }
  function completeData(rows) {
    return expected.every(wanted => { const row=rows.find(row=>row._id===wanted._id);
      return row && row.stockCommitVersion===wanted.stockCommitVersion && stable(row.details)===stable(wanted.details); });
  }
  const receiptDetails = actorHash => ({ schema:'R2_EMPLOYEE_TERMINAL_RECEIPT_V1',cohort:COHORT,profile,authorityBuild,probeSourceSha256,actorHash,evidence:{...evidence} });
  function complete(rows, owner) {
    const receipt = rows.find(row => row._id === terminalId), details = receiptDetails(owner);
    return rows.length===4 && completeData(rows) && receipt?.company==='NCT'
      && stable(receipt.details)===stable(details) && receipt.stockCommitVersion===digest(details).slice(0,32);
  }
  async function execute(input) {
    if (!input || Array.isArray(input) || Object.keys(input).join(',')!=='step' || !['RUN','INSPECT'].includes(input.step)) throw Error('Exact terminal probe step required');
    const owner = await authorize();
    const base = { schema:'R2_EMPLOYEE_TERMINAL_ACCEPTANCE_V1',cohort:COHORT,profile,authorityBuild,probeSourceSha256,
      step:input.step,oldFixturesAccessed:false,businessAuthorizationAccepted:false,writerCoverageAccepted:false,activationAllowed:false };
    if (input.step==='RUN' && !enabled) return { ...base,ok:false,stage:'CLOSED',mutationAttempted:false };
    const query=elevate(items.query), insert=elevate(items.insert);
    async function read() {
      const page=await (await query(table)).hasSome('_id',ids).limit(5).find({consistentRead:true,returnTotalCount:true});
      if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.totalCount) || page.totalCount<0 || page.totalCount>4
        || page.items.length!==page.totalCount || new Set(page.items.map(row=>row?._id)).size!==page.items.length
        || page.items.some(row=>!ids.includes(row?._id)||row.company!=='NCT')) throw Error('Complete fixed terminal fixture read required');
      return page.items;
    }
    const before=await read(); await authorize(owner);
    if (input.step==='INSPECT') return { ...base,ok:true,stage:'READ_ONLY_TERMINAL_INSPECTION',retainedRecords:before.length,
      terminalReceiptVerified:complete(before,owner),ordinaryStaffWriteAccepted:complete(before,owner),mutationAttempted:false };
    if (before.length) throw Error('Occupied terminal fixture; no replay/reset/adoption');
    const result=await probe({ items,elevate,input:{step:'RUN'},enabled:true,fixture:profile,requireUnprivileged:true });
    if (result?.ok!==true || result.stage!=='NATIVE_METHODS_CONFIRMED' || result.fixedCollection!==table || result.fixedRecordCount!==3
      || result.retainedRecords!==3 || result.mutationAttempted!==true || result.deletions!==0 || result.permissionsChanged!==false
      || Object.entries(evidence).some(([key,value])=>result[key]!==value)
      || stable(result.operations)!==stable({queries:4,inserts:1,bulkInserts:1,patchAttempts:2})) {
      throw Error('Native employee methods not terminally verified; retain fixed records without retry');
    }
    await authorize(owner);
    const observed=await read();
    if (observed.length!==3 || !completeData(observed)) throw Error('Native terminal after-images unconfirmed; no receipt');
    await authorize(owner);
    const details=receiptDetails(owner);
    // One immutable terminal insert AFTER all native assertions. A lost reply
    // propagates: only INSPECT may read it; RUN never adopts an occupied fixture.
    await insert(table,{_id:terminalId,company:'NCT',stockCommitVersion:digest(details).slice(0,32),details});
    const after=await read();await authorize(owner);
    if (!complete(after,owner)) throw Error('Terminal receipt unconfirmed; inspect fixed request without replay');
    return { ...base,ok:true,stage:'NATIVE_EMPLOYEE_WRITE_TERMINAL_CONFIRMED',retainedRecords:4,
      terminalReceiptVerified:true,ordinaryStaffWriteAccepted:true,mutationAttempted:true,
      probeOperations:result.operations,terminalReceiptInserts:1,deletions:0,permissionsChanged:false };
  }
  return { execute };
}
const R2_EMPLOYEE_TERMINAL_ENABLED=false;
const authorityBuild="03ca8d21023736f45e2526f0d503989ab29bcea6",probeSourceSha256="93f04d5946b74481eff770786c958ffe53488955df15e2d3aa280bea3306ec9a";
async function authenticatePurchase(){const staff=await getPurchaseStaffContext();if(!staff?.staffId||!staff.memberId)throw Error('Original Purchase identity required');return{staffId:staff.staffId,memberId:staff.memberId};}
async function authenticateWarehouse(){const member=await currentMember.getMember({fieldsets:['FULL']});const staff=requireWarehouseStaff(member,await fulfilmentStore.all('StaffMasterAccess'));if(!member?._id||!staff?.staffId)throw Error('Original Warehouse identity required');return{staffId:staff.staffId,memberId:member._id};}
const service=profile=>createEmployeeTerminalAcceptance({profile,authorityBuild,probeSourceSha256,probe:verifyR2SdkAuthority,items,elevate:auth.elevate,authenticate:profile==='PURCHASE'?authenticatePurchase:authenticateWarehouse,enabled:R2_EMPLOYEE_TERMINAL_ENABLED});
export const verifyPurchaseTerminal=webMethod(Permissions.SiteMember,async input=>{const result=await service('PURCHASE').execute(input);console.info('R2_EMPLOYEE_TERMINAL_RECEIPT '+JSON.stringify(result));return result;});
export const verifyWarehouseTerminal=webMethod(Permissions.SiteMember,async input=>{const result=await service('WAREHOUSE').execute(input);console.info('R2_EMPLOYEE_TERMINAL_RECEIPT '+JSON.stringify(result));return result;});
