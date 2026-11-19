'use strict';
// Dedicated new diagnostic only. Old occupied/UNKNOWN authority fixtures stay untouched.
const { createHash } = require('node:crypto');
const { COHORT } = require('./isolated-cohort.cjs');
const { stable } = require('./fresh-cohort-activation-schema.cjs');
const terminalPrefixes = Object.freeze({ PURCHASE:'SPT-R2TERMINAL-PURCHASE-20261025-d491:', WAREHOUSE:'SPT-R2TERMINAL-WAREHOUSE-20261025-b381:' });
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
module.exports = { terminalPrefixes, createEmployeeTerminalAcceptance };
