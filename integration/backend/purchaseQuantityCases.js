import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
const text=value=>String(value??'').trim();
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export const QUANTITY_CASE_ACTION='PURCHASE_QUANTITY_CASE_DECIDED';

// Sourcing decisions never double as receiving or financial clearance.
export function readQuantityCaseDecisions(activity){
 const groups=new Map(),states=new Map();
 for(const event of activity.filter(event=>event.action===QUANTITY_CASE_ACTION&&event.result==='SAVED')){
  const id=event.details?.caseId;if(!id)throw Error('Quantity case identity requires review.');
  if(!groups.has(id))groups.set(id,[]);groups.get(id).push(event);
 }
 for(const [id,pending] of groups){let revision='',state=null;
  while(pending.length){const next=pending.filter(event=>event.details.beforeRevision===revision);if(next.length!==1)throw Error('Quantity case decision history requires review.');
   const event=next[0],detail=event.details;
   if(!event.title||!detail.signature||!['UNPLACED','RECEIPT'].includes(detail.kind)||!['WAIT','STOP','PENDING'].includes(detail.customerDecision)||!text(detail.reason)||!event.initiatedByStaffId||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Quantity case decision requires review.');
   state={...detail,revision:event.title,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName,byStaffId:event.initiatedByStaffId};revision=event.title;pending.splice(pending.indexOf(event),1);
  }
  states.set(id,state);
 }
 return states;
}

export function projectQuantityCases(workspace,activity){
 const decisions=readQuantityCaseDecisions(activity),result=[];
 function add(row,kind,quantity,signature,extra={}){
  const id=operationId(workspace.company,row.id,'QUANTITY_CASE',kind),prior=decisions.get(id),decision=prior?.signature===signature?prior:null;
  const resolved=kind==='UNPLACED'&&decision?.customerDecision==='STOP';
  result.push({id,kind,company:workspace.company,taskId:row.id,customerDemandTaskId:row.customerDemandTaskId||row.id,customerId:row.customerId,barcode:row.barcode,name:row.name,po:row.po,supplierId:row.supplierId,quantity,signature,decision,revision:prior?.revision||'',financeRequired:kind==='RECEIPT',status:resolved?'RESOLVED':'OPEN',owner:resolved?null:kind==='UNPLACED'||!decision||decision.supplierDecision==='PENDING'?'PURCHASE':decision.supplierDecision==='REPLENISH'?'WAREHOUSE':decision.supplierDecision==='INTERNAL'?'ADMIN':'ACCOUNT',blocks:kind==='UNPLACED'?['SALES']:['PURCHASE','ACCOUNT'],...extra});
 }
 for(const row of workspace.tasks){
  if(row.archived||row.specialPurchase)continue;
  const sources=workspace.tasks.filter(source=>source.id===row.id||source.customerDemandTaskId===row.id);
  const ordered=sources.reduce((sum,source)=>sum+(source.procurement?.totalCtn||0),0),unplaced=Math.max(0,row.ord-ordered);
  if(!row.procurementSource&&row.po&&unplaced>0)add(row,'UNPLACED',unplaced,operationId(row.ord,sources.map(source=>[source.id,source.procurement?.revision,source.procurement?.totalCtn]).sort()));
  // Keep a receiving case after replenishment: only Finance's final verification clears the risk.
  const issues=activity.filter(event=>event.action==='WAREHOUSE_RECEIPT_SAVED'&&event.result==='SAVED'&&event.details?.lines?.some(line=>line.taskId===row.id&&line.issue));
  if(issues.length){
   const recordedPlans=issues.flatMap(event=>event.details.lines.filter(line=>line.taskId===row.id)).map(line=>line.planned).filter(integer);
   const planned=Math.max(row.procurement?.totalCtn||0,...recordedPlans),accepted=row.warehouse?.accepted||0,missing=Math.max(0,planned-accepted);
   const feedback=issues.slice().sort((a,b)=>String(a.activityTime||'').localeCompare(String(b.activityTime||''))||String(a.title).localeCompare(String(b.title))).at(-1)?.details.lines.find(line=>line.taskId===row.id&&line.issue);
   add(row,'RECEIPT',missing,operationId(row.id,planned,row.supplierId,issues.map(event=>event.title).sort()),{planned,accepted,receivingIssue:row.warehouse?.issue===true,...(text(feedback?.reason)?{warehouseFeedback:{reason:text(feedback.reason),kind:feedback.kind||'',at:issues.find(event=>event.details.lines.includes(feedback))?.activityTime||null}}:{}),referenceCostCents:Number.isFinite(row.netCostCtn)?Math.round(missing*row.netCostCtn*100):null,...(missing===0&&!row.warehouse?.issue?{owner:'ACCOUNT'}:{})});
  }
 }
 return result;
}
export function quantityCasesVersion(workspace,activity){return operationId(workspace.company,projectQuantityCases(workspace,activity));}
export function customerCaseFeedback(cases){
 if(!cases.length)return null;
 const unresolved=cases.filter(item=>item.quantity>0&&(!item.decision||item.decision.customerDecision!=='STOP'));
 const state=unresolved.find(item=>!item.decision||item.decision.customerDecision==='PENDING')||unresolved[0]||cases.at(-1);
 return {customerDecision:unresolved.length?(unresolved.some(item=>!item.decision||item.decision.customerDecision==='PENDING')?'PENDING':'WAIT'):'STOP',customerMessage:state.decision?.customerMessage||'',expectedDate:state.decision?.expectedDate||null,at:state.decision?.at||null};
}
export function createQuantityCaseOperations({store,names,readWorkspace,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||staff?.canDecideQuantityCase!==true||input?.action!=='DECIDE')throw Error('Quantity case decision is not authorized.');
  const collection=names[company].activity;
  return journal({collection,scope:company+'/PURCHASE',requestId,staff,input:{quantityCase:input},prepare:async()=>{
   const workspace=await readWorkspace(company,staff),activity=await store.all(collection),item=projectQuantityCases(workspace,activity).find(row=>row.id===input.id);
   if(workspace.company!==company||input.version!==quantityCasesVersion(workspace,activity)||!item)throw Error('Quantity case changed. Refresh before saving.');
   const supplierDeliveryDecision=input.supplierDeliveryDecision,compact=supplierDeliveryDecision!==undefined;
   if(compact&&(item.kind!=='RECEIPT'||!['WAIT','STOP'].includes(supplierDeliveryDecision)))throw Error('Select whether to wait for the supplier delivery.');
   const reason=text(input.reason),customerMessage=text(compact?item.decision?.customerMessage:input.customerMessage),customerDecision=compact?(item.decision?.customerDecision||'PENDING'):input.customerDecision;
   if(!reason||reason.length>2000||!customerMessage&&!compact||customerMessage.length>1000||!['WAIT','STOP','PENDING'].includes(customerDecision))throw Error('Enter an internal reason and a customer-safe update.');
   const supplierDecision=item.kind==='UNPLACED'?'NOT_APPLICABLE':input.supplierDecision;
   if(compact){if(supplierDeliveryDecision==='WAIT'?supplierDecision!=='PENDING':!['CN_PROMISED','FUTURE_DEDUCTION','SUPPLIER_REFUSED'].includes(supplierDecision))throw Error('Select exactly one supplier response.');}
   else if(item.kind==='RECEIPT'&&!['REPLENISH','REFUND','CREDIT','INTERNAL','PENDING'].includes(supplierDecision))throw Error('Select the supplier shortage resolution.');
   const expectedDate=compact?item.decision?.expectedDate:input.expectedDate;
   if((customerDecision==='WAIT'||supplierDecision==='REPLENISH')&&(!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate||'')||!Number.isFinite(Date.parse(expectedDate))||new Date(expectedDate).toISOString().slice(0,10)!==expectedDate))throw Error('Enter the expected replenishment date.');
   const id=operationId(company,requestId,staff.memberId,'QUANTITY_CASE_DECISION');
   return {version:input.version,event:{_id:id,title:id,description:item.customerDemandTaskId,imageAltText:item.taskId,action:QUANTITY_CASE_ACTION,result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:now().toISOString(),message:reason,details:{caseId:item.id,kind:item.kind,quantity:item.quantity,signature:item.signature,beforeRevision:item.revision,customerDecision,supplierDecision,customerMessage,reason,expectedDate:expectedDate||null,...(compact?{supplierDeliveryDecision,company}:{})}}};
  },apply:async plan=>{
   const saved=await store.read(collection,plan.event._id);
   if(!saved){const workspace=await readWorkspace(company,staff),activity=await store.all(collection);if(quantityCasesVersion(workspace,activity)!==plan.version)throw Error('Quantity case changed while saving.');await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});}
   else if(operationId(saved.details)!==operationId(plan.event.details))throw Error('Quantity case save identity conflict.');
   return {ok:true,company,requestId,caseId:plan.event.details.caseId};
  }});
 };
}
