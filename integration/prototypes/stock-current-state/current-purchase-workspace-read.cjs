'use strict';

const { prepareMarginReferenceGroup, collectMarginCurrencies } = require('./margin-reference-plan.cjs');
const { createPurchaseTransferWorkspace } = require('./purchase-transfer-workspace.cjs');
const { domainCollections } = require('./domain-scope.cjs');
const { copy } = require('./segmented-plan.cjs');
const {readArrangements,projectArrangementLinks}=require('./purchase-arrangement.cjs');
// READ ONLY. Refresh suggestions contain no draft GP/rate/order data. The caller
// must durably retain an original authenticated save request BEFORE acting on one.
function createCurrentPurchaseWorkspaceRead({ company, protocol, authenticate, readCurrentContext, readRates,
  createPurchaseMarginRefresh, readCustomerShortNames, projectPurchaseOrders, applyPurchaseProgress, readOutstanding, now }) {
  if (!['NCT','GHR'].includes(company) || typeof protocol?.readSnapshot!=='function'
    || [authenticate,readCurrentContext,readRates,createPurchaseMarginRefresh,readCustomerShortNames,projectPurchaseOrders,
      applyPurchaseProgress,readOutstanding,now].some(fn=>typeof fn!=='function')) throw Error('Original current Purchase workspace dependencies required');
  const [orders,tasks]=domainCollections(company),journal=company==='NCT'?'NCTActivity':'NCTActivity1';
  return async selectedCompany=>{
    if (selectedCompany!==company)throw Error('Purchase workspace company conflict');
    const staff=await authenticate(company);
    if (!staff?.staffId||!staff.memberId)throw Error('Original Purchase workspace authorization required');
    const snapshot=await protocol.readSnapshot(async control=>{
      if (control?.company!==company||control.mode!=='ACTIVE'||control.schemaVersion!==1||control.pending
        || !control.writerBuild||control.transferIndexVersion!==2||!Number.isSafeInteger(control.generation)||control.generation<0) throw Error('Verified current Purchase workspace required');
      const data=await readCurrentContext(company,staff,control),workspace=data?.workspace,tables=data?.tables;
      if (workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'||workspace.staff?.staffId!==staff.staffId
        || workspace.staff?.memberId!==staff.memberId||!Array.isArray(workspace.tasks)||new Set(workspace.tasks.map(row=>row.id)).size!==workspace.tasks.length
        || !tables||[orders,tasks,journal,'PurchaseOrders'].some(collection=>!Array.isArray(tables[collection]))) throw Error('Original complete current Purchase workspace required');
      const currencies=await collectMarginCurrencies({company,tables,workspace,createPurchaseMarginRefresh,now});
      let rates;
      const currentRates=()=>rates||(rates=Promise.resolve().then(()=>readRates(currencies)));
      const margins=new Map();let refreshTaskId=null;
      for (const target of workspace.tasks.filter(row=>!row.procurementSource)) {
        const group=workspace.tasks.filter(row=>row.id===target.id||row.customerDemandTaskId===target.id);
        const allowed=new Set([target.id,...group.map(row=>'SOURCE:'+row.id)]);
        const prepared=await prepareMarginReferenceGroup({company,targetTaskId:target.id,workspace,
          tables:Object.fromEntries([orders,tasks,journal].map(collection=>[collection,tables[collection]])),
          createPurchaseMarginRefresh,readRates:currentRates,now});
        if (prepared.results.some(row=>!allowed.has(row[0])||row[1]!==null&&(typeof row[1]!=='number'||!Number.isFinite(row[1])))) throw Error('Known original Purchase margins required');
        if (prepared.mustCommit) {refreshTaskId=target.id;break;}
        for (const [id,gp] of prepared.results) {
          if(margins.has(id))throw Error('Ambiguous original Purchase margin group');margins.set(id,gp);
        }
      }
      let customerNamesError='',names=[];
      try {names=await readCustomerShortNames(workspace.customers.map(row=>row.id));}
      catch (_) {customerNamesError='客户 Short Name 暂时无法读取，请核对客户资料。';}
      if(!Array.isArray(names))throw Error('Original customer short names required');
      const arrangements=projectArrangementLinks(company,readArrangements(company,tables[journal]),tables[journal]);
      const result={...copy(workspace),customerNamesError,
        customers:workspace.customers.map(row=>({...copy(row),shortName:names.find(item=>item.customerId===row.id)?.shortName||''})),
        tasks:workspace.tasks.map(row=>({...copy(row),stockArrangements:arrangements.filter(a=>a.taskId===row.id),gp:refreshTaskId?null:margins.get(row.id)??null,sourceGp:refreshTaskId?null:margins.get('SOURCE:'+row.id)??null}))};
      const purchaseOrders=projectPurchaseOrders({company,workspace:result,records:tables.PurchaseOrders});
      applyPurchaseProgress(result,tables[journal],purchaseOrders);
      // Original archived/stage decisions above remain untouched; relation loading
      // is independent and may still put halos on either archived participant.
      const completed=await createPurchaseTransferWorkspace({company,protocol,authenticate:async()=>staff,
        readWorkspace:async()=>result,readOutstanding:(c,input)=>readOutstanding(c,input,staff)})(company);
      if(refreshTaskId)return {schema:'PURCHASE_MARGIN_REFRESH_REQUIRED_V1',company,taskId:refreshTaskId,
        staff:{staffId:staff.staffId,memberId:staff.memberId,staffName:staff.staffName},stockCurrent:completed.stockCurrent,
        // Not renderable/actionable. Only ORIGINAL draft reconciliation may use
        // these current public fields after its exact completed save receipt.
        reconciliationWorkspace:{...completed,stockReconciliationOnly:true}};
      return completed;
    });
    return snapshot.rows;
  };
}
module.exports={createCurrentPurchaseWorkspaceRead};
