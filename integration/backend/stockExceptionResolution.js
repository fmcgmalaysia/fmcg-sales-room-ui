import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { readStockExceptions, stockExceptionVersion } from 'backend/inventoryExceptions.js';
import { sourceCost } from 'backend/stockValuationService.js';
const text=value=>String(value??'').trim();
const money=value=>Number.isSafeInteger(value)&&value>=0&&value<=999999999999;
const quantity=value=>Number.isSafeInteger(value)&&value>0&&value<=9999;
export function stockResolutionVersion(context,purchaseOrders){return operationId(stockExceptionVersion(context),readStockExceptions(context.activity),purchaseOrders.map(row=>[row.id,row.version]));}
export function stockTakePeriod(value,at,reportedAt){
 const period=text(value),today=new Date(new Date(at).getTime()+8*60*60*1000).toISOString().slice(0,10);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Select the Stock Take month.');
 const [year,month]=period.split('-').map(Number),end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
 if(end>today||new Date(new Date(reportedAt).getTime()+8*60*60*1000).toISOString().slice(0,10)>end)throw Error('Stock loss closes at month-end Stock Take, in a period containing this report.');
 return period;
}
export function createStockResolutionOperations({store,names,readContext,listOrders,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  const permission={DECIDE:'canPlanStockResolution',APPROVE_LOSS:'canApproveStockLoss',APPROVE_VARIANCE:'canApproveStockLoss',APPROVE_RELEASE:'canApproveStockLoss',RETURN:'canReportStockException',REPLACEMENT:'canReportStockException',DISPOSE:'canReportStockException',CLOSE:'canCloseStockException'}[input?.action];
  if(!names[company]||!permission||staff?.[permission]!==true)throw Error('Stock resolution action is not authorized.');
  if(input.action==='APPROVE_LOSS')throw Error('Finance records inventory loss once at month-end Stock Take; a separate Admin approval is not used.');
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{stockResolution:input},prepare:async()=>{
   const context=await readContext(company,staff),orders=await listOrders(company,staff),version=stockResolutionVersion(context,orders),cases=readStockExceptions(context.activity),item=cases.find(row=>row.id===input.id);
   if(context.company!==company||input.version!==version||!item||item.company!==company)throw Error('Stock case changed. Refresh before saving.');
   if(item.status==='RESOLVED'&&input.action!=='DISPOSE')throw Error('Resolved stock cases require a separate correction.');
   const matches=orders.filter(po=>po.taskIds.includes(item.sourceTaskId));if(matches.length!==1)throw Error('Stock case requires one supplier purchase order.');
   const po=matches[0],reason=text(input.reason);if(!reason||reason.length>2000)throw Error('Enter the stock resolution reason.');
   const identity={at:now().toISOString(),by:staff.staffName,byStaffId:staff.staffId},state={...(item.resolution||{}),caseId:item.id};delete state.revision;
   if(input.action==='DECIDE'){
    if(state.adminApproval)throw Error('Admin stock release is awaiting Finance verification; supplier movement is blocked.');
    if(item.kind==='INTERNAL_DAMAGE'||!['PENDING','REFUND','CREDIT','REPLACE'].includes(input.decision))throw Error('Select a supplier resolution for supplier-related stock.');
    if((state.returns||[]).length||(state.replacements||[]).length)throw Error('Physical return or replacement already started; retain its agreed resolution.');
    if(input.decision!=='PENDING'&&(!['RETURN','SUPPLIER_NO_RETURN'].includes(input.disposition)||!text(input.supplierReference)))throw Error('Record supplier instructions and whether goods must be returned.');
    if(input.decision==='REPLACE'&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedDate||'')||!Number.isFinite(Date.parse(input.expectedDate))||new Date(input.expectedDate).toISOString().slice(0,10)!==input.expectedDate))throw Error('Enter a valid replacement date.');
    state.decision={value:input.decision,disposition:input.decision==='PENDING'?null:input.disposition,supplierReference:text(input.supplierReference),expectedDate:input.decision==='REPLACE'?input.expectedDate:null,reason,...identity};
   }
   if(input.action==='APPROVE_RELEASE'){
    if(state.adminApproval||(state.returns||[]).length||(state.replacements||[]).length)throw Error('This stock approval or physical movement is already recorded.');
    state.adminApproval={outcome:'RELEASED',quantity:item.quantity,reason,...identity};
   }
   if(input.action==='APPROVE_VARIANCE'){
    if(item.kind==='INTERNAL_DAMAGE'||!money(item.referenceCostCents)||!money(input.cents)||input.cents===0||input.cents>item.referenceCostCents)throw Error('Confirm the unrecovered supplier claim amount.');
    state.varianceApproval={cents:input.cents,reason,...identity};
   }
   if(['RETURN','REPLACEMENT'].includes(input.action)){
    if(state.adminApproval)throw Error('Admin stock release is awaiting Finance verification; supplier movement is blocked.');
    const decision=state.decision;
    if(!decision||decision.value==='PENDING'||input.action==='RETURN'&&decision.disposition!=='RETURN'||input.action==='REPLACEMENT'&&decision.value!=='REPLACE')throw Error('Purchase must confirm the supplier resolution first.');
    const field=input.action==='RETURN'?'returns':'replacements',prior=state[field]||[],reference=text(input.reference);
    if(!quantity(input.quantity)||prior.reduce((sum,row)=>sum+row.quantity,0)+input.quantity>item.quantity||!reference||reference.length>120||prior.some(row=>row.reference===reference))throw Error('Enter distinct movement reference and remaining whole cartons.');
    if(input.action==='REPLACEMENT'&&input.acceptedGood!==true)throw Error('Confirm replacement goods have passed warehouse inspection.');
    state[field]=[...prior,{quantity:input.quantity,reference,reason,...identity}];
   }
   if(input.action==='CLOSE'){
    const outcome=input.outcome,approval={outcome,reason,...identity};
    if(outcome==='LOSS'){
     if(state.adminApproval?.outcome==='RELEASED')throw Error('Stock release is awaiting Finance verification; loss cannot replace it.');
     const period=stockTakePeriod(input.period,identity.at,item.at),cost=item.referenceCostCents;
     if(!money(cost)||input.cents!==cost)throw Error('Confirm the original source cost before recording inventory loss.');
     if(state.decision&&state.decision.value!=='PENDING'||(state.returns||[]).length||(state.replacements||[]).length)throw Error('Stock loss cannot replace an existing supplier claim or movement.');
     if(input.stockTakeConfirmed!==true||!['PRESENT','DISPOSED'].includes(input.goodsStatus))throw Error('Confirm Stock Take and whether the isolated goods remain physically present.');
     const source=context.tasks.find(row=>row.id===item.sourceTaskId),stock=source?.warehouse?.stock;
     if(!stock||!Number.isSafeInteger(stock.availablePhysical)||!Number.isSafeInteger(stock.held)||stock.held<item.quantity)throw Error('Stock Take requires the current isolated source position.');
     const valuation=sourceCost(source);
     if(valuation.status!=='CONFIRMED'||Math.round(valuation.unit*item.quantity*100)!==cost)throw Error('Stock source cost changed or is unconfirmed. Finance must review it before recording loss.');
     Object.assign(approval,{period,quantity:item.quantity,cents:cost,currency:'MYR',sourceTaskId:item.sourceTaskId,poNumber:source.po,goodsStatus:input.goodsStatus,stockTakeConfirmed:true,before:{received:stock.received,shipped:stock.shipped,usable:stock.availablePhysical,isolated:stock.held},after:{received:stock.received,shipped:stock.shipped,usable:stock.availablePhysical,isolated:stock.held-item.quantity}});
    }else if(outcome==='RELEASED'){
     if(state.adminApproval?.outcome!==outcome||state.adminApproval.quantity!==item.quantity)throw Error('Super Admin approval is required before Finance closes this stock adjustment.');
     if(state.adminApproval.byStaffId===staff.staffId)throw Error('A different Finance employee must verify the Admin stock approval.');
    }else{
     if(!['REFUND','CREDIT','REPLACED'].includes(outcome)||state.decision?.value!==(outcome==='REPLACED'?'REPLACE':outcome))throw Error('Finance outcome must match Purchase supplier resolution.');
     if(state.decision.disposition==='RETURN'&&(state.returns||[]).reduce((sum,row)=>sum+row.quantity,0)!==item.quantity)throw Error('Warehouse must confirm all required supplier returns.');
     if(outcome==='REPLACED'){
      if((state.replacements||[]).reduce((sum,row)=>sum+row.quantity,0)!==item.quantity||input.noExtraCharge!==true)throw Error('Verify complete good replacement and no additional supplier charge.');
     }else{
      if(!money(input.cents)||input.cents===0||!Array.isArray(input.cnAllocations)||!input.cnAllocations.length||new Set(input.cnAllocations.map(row=>row.fileId)).size!==input.cnAllocations.length)throw Error('Allocate the actual supplier CN amount to this stock case.');
      const others=cases.filter(row=>row.id!==item.id&&po.taskIds.includes(row.sourceTaskId)&&row.resolution?.financeApproval).map(row=>row.resolution.financeApproval).concat(po.finance.quantityClaims||[]);
      let total=0;
      for(const allocation of input.cnAllocations){
       const doc=po.documents.find(row=>row.type==='CN'&&row.linked&&!row.superseded&&row.fileId===allocation.fileId),amount=po.finance.amounts.find(row=>row.fileId===allocation.fileId&&row.sha256===doc?.sha256);
       const used=others.flatMap(row=>row.cnAllocations||[]).filter(row=>row.fileId===allocation.fileId).reduce((sum,row)=>sum+row.cents,0);
       if(!doc||!amount||!money(allocation.cents)||allocation.cents===0||used+allocation.cents>amount.cents)throw Error('CN amount is missing, unverified or already assigned to another stock case.');total+=allocation.cents;
      }
      if(total!==input.cents)throw Error('CN allocations must equal this case amount.');
      if(!money(item.referenceCostCents))throw Error('Stock cost reference requires Admin review before claim settlement.');
      const unrecoveredCents=Math.max(0,item.referenceCostCents-input.cents);
      if(unrecoveredCents&&(state.varianceApproval?.cents!==unrecoveredCents||state.varianceApproval.byStaffId===staff.staffId))throw Error('Supplier claim shortfall requires separate Super Admin approval.');
      approval.cents=input.cents;approval.currency='MYR';approval.cnAllocations=input.cnAllocations.map(row=>({fileId:row.fileId,cents:row.cents}));
      approval.unrecoveredCents=unrecoveredCents;
      if(outcome==='CREDIT'){
       const already=others.filter(row=>row.outcome==='CREDIT').reduce((sum,row)=>sum+row.cents,0);
       if(!Number.isSafeInteger(po.finance.balanceCents)||already+input.cents>Math.max(0,-po.finance.balanceCents))throw Error('Supplier credit must be supported by actual overpayment.');
      }else{
       if(!Array.isArray(input.refundAllocations)||new Set(input.refundAllocations.map(row=>row.paymentId)).size!==input.refundAllocations.length)throw Error('Select actual received refund proofs.');
       let refunded=0;for(const allocation of input.refundAllocations){const payment=po.finance.payments.find(row=>row.id===allocation.paymentId&&row.direction==='REFUND'&&row.confirmed&&row.proof?.linked),used=others.flatMap(row=>row.refundAllocations||[]).filter(row=>row.paymentId===allocation.paymentId).reduce((sum,row)=>sum+row.cents,0);if(!payment||!money(allocation.cents)||allocation.cents===0||used+allocation.cents>payment.cents)throw Error('Refund proof is unavailable or already assigned.');refunded+=allocation.cents;}
       if(refunded!==input.cents)throw Error('Received refunds must cover this stock claim.');approval.refundAllocations=input.refundAllocations.map(row=>({paymentId:row.paymentId,cents:row.cents}));
      }
     }
    }
    state.financeApproval=approval;
   }
   if(input.action==='DISPOSE'){
    const approval=state.financeApproval,reference=text(input.reference);
    if(approval?.outcome!=='LOSS'||approval.stockTakeConfirmed!==true||approval.goodsStatus!=='PRESENT'||state.disposal||input.quantity!==item.quantity||!reference||reference.length>120)throw Error('Warehouse may confirm disposal only for the complete written-off quantity awaiting disposal.');
    state.disposal={quantity:item.quantity,reference,reason,...identity};
   }
   const id=operationId(company,requestId,staff.memberId,'STOCK_RESOLUTION');
   return {version,event:{_id:id,title:id,description:item.id,imageAltText:item.sourceTaskId,action:'STOCK_EXCEPTION_RESOLUTION_SAVED',result:'SAVED',activityTime:identity.at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:reason,details:{action:input.action,beforeRevision:item.resolution?.revision||'',state}}};
  },apply:async plan=>{const existing=await store.read(names[company].activity,plan.event._id);if(!existing){const context=await readContext(company,staff),orders=await listOrders(company,staff);if(stockResolutionVersion(context,orders)!==plan.version)throw Error('Stock resolution changed while saving.');await store.insert(names[company].activity,{...plan.event,activityTime:new Date(plan.event.activityTime)});}else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Stock resolution identity conflict.');return {ok:true,company,requestId,caseId:plan.event.description};}});
 };
}
