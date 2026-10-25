import { items } from '@wix/data';
import { auth } from '@wix/essentials';
import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { getPurchaseStaffContext } from 'backend/r2purchaseAccess.js';
import { requireWarehouseStaff } from 'backend/r2warehouseReceiving.js';
import { fulfilmentStore } from 'backend/r2customerFulfilmentService.js';
const elevate=auth.elevate;
// Fresh fixed retained records only. No production/employee/CMS ACL mutation.
async function verifyR2SdkAuthority({items,elevate,input,enabled=false,fixture='ADMIN',requireUnprivileged=false,now=()=>Date.now()}){
 if(!input||Array.isArray(input)||Object.keys(input).join(',')!=='step'||!['RUN','INSPECT'].includes(input.step))throw Error('Exact authority probe step required');
 const prefixes={ADMIN:'SPT-R2AUTH-20261024-c281:',PURCHASE:'SPT-R2AUTH-PURCHASE-20261025-a581:',WAREHOUSE:'SPT-R2AUTH-WAREHOUSE-20261025-f281:'};
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

const R2_EMPLOYEE_AUTHORITY_PROBE_ENABLED=false;
async function employeeProbe(profile,input){
 if(profile==='PURCHASE'){const staff=await getPurchaseStaffContext();if(!staff?.staffId||!staff.memberId)throw Error('Original Purchase identity required');}
 else if(profile==='WAREHOUSE'){const member=await currentMember.getMember({fieldsets:['FULL']});const staff=requireWarehouseStaff(member,await fulfilmentStore.all('StaffMasterAccess'));if(!member?._id||!staff?.staffId)throw Error('Original Warehouse identity required');}
 else throw Error('Fixed original employee profile required');
 const result=await verifyR2SdkAuthority({items,elevate,input,enabled:R2_EMPLOYEE_AUTHORITY_PROBE_ENABLED,fixture:profile,requireUnprivileged:true});
 console.info('R2EMPLOYEE_RECEIPT '+JSON.stringify({profile,...result}));return{profile,...result};
}
export const verifyPurchaseR2Authority=webMethod(Permissions.SiteMember,input=>employeeProbe('PURCHASE',input));
export const verifyWarehouseR2Authority=webMethod(Permissions.SiteMember,input=>employeeProbe('WAREHOUSE',input));
export const inspectEmployeeR2Authority=webMethod(Permissions.Admin,async()=>{const results=[];for(const profile of ['PURCHASE','WAREHOUSE'])results.push({profile,...await verifyR2SdkAuthority({items,elevate,input:{step:'INSPECT'},enabled:false,fixture:profile,requireUnprivileged:false})});console.info('R2EMPLOYEE_INSPECTION '+JSON.stringify(results));return results;});
