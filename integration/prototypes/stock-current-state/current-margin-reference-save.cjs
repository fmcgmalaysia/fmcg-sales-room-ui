'use strict';

const { createCurrentStockSave } = require('./current-stock-save.cjs');
const { prepareMarginReferenceGroup } = require('./margin-reference-plan.cjs');
const { domainCollections } = require('./domain-scope.cjs');
const { hash } = require('./commit-proof.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
// Private ORIGINAL Purchase cache co-writer. Does not start automatic refreshes,
// expose rates/prices, replace GP formulas or install an endpoint. A workspace
// orchestrator must retain this request BEFORE calling it, including after reload.
function createCurrentMarginReferenceSave({ company, store, protocol, coverage, authorityDependencies:d }) {
  if (!['NCT','GHR'].includes(company) || protocol?.planFormat!=='SEGMENTED_V2' || typeof store?.read!=='function'
    || [d?.readMember,d?.readStaffRecords,d?.requirePurchaseStaff,d?.readMarginContext,d?.createPurchaseMarginRefresh,d?.readRates,d?.now]
      .some(fn=>typeof fn!=='function')) throw Error('Private original margin reference dependencies required');
  const [orders,tasks]=domainCollections(company),journal=company==='NCT'?'NCTActivity':'NCTActivity1';
  function validateResults(results, allowed) {
    if (!Array.isArray(results) || new Set(results.map(row=>row?.[0])).size!==results.length
      || results.some(row=>!Array.isArray(row)||row.length!==2||!allowed.has(row[0])
        || row[1]!==null&&(typeof row[1]!=='number'||!Number.isFinite(row[1])))) throw Error('Known original margin results required');
  }
  return async request=>{
    if (!request?.input || Object.keys(request.input).some(key=>key!=='taskId') || typeof request.input.taskId!=='string'
      || !request.input.taskId || request.input.taskId.length>128) throw Error('Exact original margin demand required');
    let staff;
    const result=await createCurrentStockSave({company,writer:'MARGIN_REFERENCE',protocol,coverage,
      authenticate:async()=>{
        const member=await d.readMember();
        if (!member?._id||!member.loginEmail||member.status!=='APPROVED')d.requirePurchaseStaff(member,[]);
        staff={...d.requirePurchaseStaff(member,await d.readStaffRecords()),memberId:member._id};
        return {memberId:staff.memberId};
      },prepare:async command=>{
        if (command.memberId!==staff.memberId)throw Error('Margin actor changed');
        const snapshot=await protocol.readSnapshot(async control=>{
          const context=await d.readMarginContext(company,staff,control),workspace=context?.workspace;
          if (workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'
            || workspace.staff?.staffId!==staff.staffId||workspace.staff?.memberId!==staff.memberId
            || !context.tables||[orders,tasks,journal].some(collection=>!Array.isArray(context.tables[collection]))) throw Error('Original authenticated current margin workspace required');
          const group=workspace.tasks?.filter(row=>row.id===command.input.taskId&&!row.procurementSource);
          if (group?.length!==1)throw Error('Exact original margin demand group required');
          const members=workspace.tasks.filter(row=>row.id===command.input.taskId||row.customerDemandTaskId===command.input.taskId);
          const allowed=new Set([command.input.taskId,...members.map(row=>'SOURCE:'+row.id)]);
          const prepared=await prepareMarginReferenceGroup({company,targetTaskId:command.input.taskId,
            tables:Object.fromEntries([orders,tasks,journal].map(collection=>[collection,context.tables[collection]])),workspace,
            createPurchaseMarginRefresh:d.createPurchaseMarginRefresh,readRates:d.readRates,now:d.now});
          validateResults(prepared.results,allowed);
          const id=hash(company,command.input.taskId,command.requestId,staff.memberId,'MARGIN_RESULT');
          const instant=new Date(prepared.plan.writes.find(write=>write.after.action==='GP_RECALCULATED')?.after.activityTime||d.now());
          if (!Number.isFinite(instant.getTime()))throw Error('Original margin receipt time required');
          const at=instant.toISOString();
          // Stable, immutable per-request receipt retains ORIGINAL calculation
          // results for replay. Only explicit refresh saves create it; ordinary
          // unchanged reads must not call this save merely to create a receipt.
          const receipt={_id:id,title:id,company,description:group[0].orderId,image:group[0].sourceLineId,
            imageAltText:command.input.taskId,action:'MARGIN_REFERENCE_RESULT',result:'RECORDED',actorType:'SYSTEM',activityTime:at,
            initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,
            details:{requestId:command.requestId,actorMemberId:staff.memberId,baseGeneration:control.generation,
              targetTaskId:command.input.taskId,allowedResultIds:[...allowed],results:copy(prepared.results)}};
          return {writes:[...prepared.plan.writes,{collection:journal,before:null,after:receipt}]};
        });
        return {plan:snapshot.rows,generation:snapshot.generation,memberId:staff.memberId};
      }})(request);
    if (result.ok!==true)return result;
    const id=hash(company,request.input.taskId,request.requestId,staff.memberId,'MARGIN_RESULT');
    const event=(await protocol.readSnapshot(()=>store.read(journal,id))).rows,detail=event?.details;
    const key=hash(company+'/PURCHASE',request.requestId,staff.memberId);
    if (event?.company!==company||event._id!==id||event.title!==id||event._version!==hash(key,journal,id)
      || event.action!=='MARGIN_REFERENCE_RESULT'||event.result!=='RECORDED'||event.imageAltText!==request.input.taskId
      || event.initiatedByStaffId!==staff.staffId||detail?.actorMemberId!==staff.memberId||detail.requestId!==request.requestId
      || detail.targetTaskId!==request.input.taskId||detail.baseGeneration+1!==result.stockGeneration
      || !Array.isArray(detail.allowedResultIds)||new Set(detail.allowedResultIds).size!==detail.allowedResultIds.length
      || !detail.allowedResultIds.includes(request.input.taskId))throw Error('Committed original margin receipt requires review');
    validateResults(detail.results,new Set(detail.allowedResultIds));
    // These are the RECEIPT's values, not a claim that later current GP stayed
    // unchanged. Re-read an authorized fresh workspace before updating live UI.
    return {...result,marginReceipt:{taskId:request.input.taskId,generation:result.stockGeneration,results:copy(detail.results)}};
  };
}
module.exports={createCurrentMarginReferenceSave};
