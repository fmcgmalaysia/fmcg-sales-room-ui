import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { calculatePlanCosting, readPurchasePlan, readPurchaseShares, planPurchaseShares } from 'backend/purchasePlan.js';
import { taskEditVersion } from 'backend/purchaseTaskIdentity.js';
const text=value=>String(value??'').trim();
export function acceptedPurchaseSource(task,order,receipt,event,parent){
 return task.procurementSource===true&&task.purchaseQtyInCtn===0&&!task.specialPurchase&&event?.action==='PURCHASE_SOURCE_ADDED'&&event.result==='SAVED'&&event.imageAltText===task.title&&event.description===task.description&&event.image===task.imageAltText&&event.details?.parentTaskId===task.customerDemandTaskId&&receipt.ids.has(task.customerDemandTaskId)&&parent?.title===task.customerDemandTaskId&&parent.description===task.description&&parent.imageAltText===task.imageAltText&&event.details.submissionId===order.submissionId&&receipt.submissionId===order.submissionId;
}
export function purchaseSourcesVersion(workspace){return operationId(workspace.company,workspace.tasks.map(row=>[row.id,row.editVersion,row.procurement?.revision,row.procurement?.totalCtn,row.customerDemandTaskId,row.warehouse]));}
export function attachPurchaseSourceTotals(rows){
 for(const row of rows.filter(row=>!row.procurementSource&&!row.specialPurchase)){
  const sources=rows.filter(source=>source.id===row.id||source.customerDemandTaskId===row.id),orderedCtn=sources.reduce((sum,source)=>sum+(source.procurement?.totalCtn||0),0),receivedCtn=sources.reduce((sum,source)=>sum+(source.warehouse?.accepted||0),0);
  row.sourcing={orderedCtn,receivedCtn,hasReceipt:sources.some(source=>source.warehouse?.hasPhysicalReceipt===true),unplacedCtn:Math.max(0,row.ord-orderedCtn),sourceIds:sources.map(source=>source.id),sources:sources.map(source=>({taskId:source.id,supplierId:source.supplierId,po:source.po,orderedCtn:source.procurement?.totalCtn,receivedCtn:source.warehouse?.accepted??null}))};
 }
}
export function createPurchaseSourceOperations({store,names,readWorkspace,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  if(!names[company]||input?.action!=='ADD_SOURCE'||staff?.canAddPurchaseSource!==true)throw Error('Adding a supplier source requires Purchase authorization.');
  return journal({collection:names[company].activity,scope:company+'/PURCHASE',requestId,staff,input:{purchaseSource:input},prepare:async()=>{
   const workspace=await readWorkspace(company,staff),parent=workspace.tasks.find(row=>row.id===input.parentTaskId),reason=text(input.reason),po=text(input.poNumber).toUpperCase();
   if(workspace.company!==company||input.version!==purchaseSourcesVersion(workspace))throw Error('Purchase sources changed. Refresh before saving.');
   const draftPlan=input.draftPlan===true;
   if(!parent||parent.archived||parent.procurementSource||parent.specialPurchase||(!draftPlan&&!parent.po)||!parent.procurement?.totalCtn)throw Error('Select an existing customer demand with a saved first supplier purchase.');
   if(!Number.isSafeInteger(input.quantity)||input.quantity<1||input.quantity>9999||!reason||reason.length>2000)throw Error('Enter whole cartons and the additional purchase reason.');
   const ordered=workspace.tasks.filter(row=>row.id===parent.id||row.customerDemandTaskId===parent.id).reduce((sum,row)=>sum+(row.procurement?.totalCtn||0),0);
   if(!input.costing&&ordered+input.quantity>parent.ord)throw Error('Additional supplier quantities exceed customer demand.');
   const suppliers=await store.all('SharedSuppliers');if(!suppliers.some(row=>row.title===input.supplierId&&String(row.supplierStatus).toUpperCase()==='ACTIVE'))throw Error('Select an active supplier.');
   if(draftPlan&&po)throw Error('Save the source plan first, then select its P.O. association.');
   if(!draftPlan&&(!po||po.length>80||/^(NCT|GHR)-PO-?$/.test(po)||workspace.tasks.some(row=>row.po.toUpperCase()===po)))throw Error('Enter a new distinct supplier P.O. number.');
   const costing=input.costing?calculatePlanCosting(input.costing,input.quantity,parent.ea):null;
   const prices=costing?{lpPc:costing.averageCostCtn/costing.ea,lpCtn:costing.averageCostCtn,disc1:0,disc2:0,disc3:0}:input.prices;if(!prices||!['lpPc','lpCtn','disc1','disc2','disc3'].every(key=>typeof prices[key]==='number'&&Number.isFinite(prices[key])&&prices[key]>=0)||prices.disc1>1||prices.disc2>1||prices.lpCtn*(1-prices.disc1)*(1-prices.disc2)-prices.disc3<0)throw Error('Confirm the supplier prices and discounts.');
   const raw=await store.read(names[company].tasks,parent.id),order=await store.one(names[company].orders,{title:parent.orderId,sourceLineId:parent.sourceLineId});
   if(!raw||!order||order.salesInvoiceNumber)throw Error('Source order is unavailable or invoice locked.');
   const id=operationId(company,requestId,staff.memberId,'PURCHASE_SOURCE'),at=now().toISOString();
   const activity=await store.all(names[company].activity),allocation=costing||readPurchaseShares(parent.id,activity).shares?planPurchaseShares(workspace,activity,parent.id,id,input.quantity):null;
   if(allocation?.extraCtn>0&&input.confirmExtra!==true)throw Error('Confirm surplus cartons retained as stock. Customer demand stays unchanged.');
   const task={_id:id,title:id,description:raw.description,imageAltText:raw.imageAltText,customerDemandTaskId:parent.id,procurementSource:true,purchaseQtyInCtn:0,receivedQtyInCtn:null,supplierId:input.supplierId,ourPoNumber:po,purchaseStage:draftPlan?'WAITING_FOR_PO':'WAITING_FOR_SUPPLIER_INV',specialPurchase:false,rowPosition:raw.rowPosition,...Object.fromEntries(['lpPc','lpCtn','disc1','disc2','disc3'].map(key=>[key,prices[key]])),originalCostSnapshot:raw.originalCostSnapshot||null,latestCostReference:raw.latestCostReference||null,costStatus:'CAPTURED',costErrorReason:'',risk:false,riskReason:''};
   const event=(action,details)=>{const eventId=operationId(id,action);return {_id:eventId,title:eventId,description:raw.description,image:raw.imageAltText,imageAltText:id,action,result:'SAVED',activityTime:at,actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:reason,details};};
   return {version:input.version,task,allocation,sourceVersions:allocation?workspace.tasks.map(row=>({id:row.id,editVersion:row.editVersion,planRevision:row.procurement?.revision||''})):null,events:[event('PURCHASE_PLAN_SAVED',{beforeRevision:'',totalCtn:input.quantity,customerQty:0,...(costing?{costing}:{}),...(allocation?{extraCtn:allocation.extraCtn,extraKind:allocation.extraCtn?'PROCUREMENT_SURPLUS':''}:{}),draftPlan,supplierId:input.supplierId,poNumber:po,supplierConfirmed:!draftPlan,reason}),...(!draftPlan?[event('PURCHASE_PO_ASSIGNED',{before:'',after:po})]:[]),...(allocation?[{...event('PURCHASE_SOURCE_SHARES_SAVED',{beforeRevision:allocation.beforeRevision,shares:allocation.shares,reason}),imageAltText:parent.id}]:[]),event('PURCHASE_SOURCE_ADDED',{parentTaskId:parent.id,submissionId:order.submissionId,quantity:input.quantity,reason})]};
  },apply:async plan=>{
   const existing=await store.read(names[company].tasks,plan.task._id),accepted=await store.read(names[company].activity,plan.events.at(-1)._id);
   const result={ok:true,company,requestId,sourceTaskId:plan.task.title,parentTaskId:plan.task.customerDemandTaskId};
   if(accepted){if(!existing||existing.customerDemandTaskId!==plan.task.customerDemandTaskId||operationId(accepted.details)!==operationId(plan.events.at(-1).details))throw Error('Purchase source receipt conflict.');return result;}
   if(plan.allocation&&existing){const activity=await store.all(names[company].activity);for(const prior of plan.sourceVersions){const current=await store.read(names[company].tasks,prior.id);if(!current||taskEditVersion(current)!==prior.editVersion||readPurchasePlan(current,activity).revision!==prior.planRevision)throw Error('Purchase sources changed while saving.');}}
   else if(!accepted&&purchaseSourcesVersion(await readWorkspace(company,staff))!==plan.version)throw Error('Purchase sources changed while saving.');
   if(plan.allocation){const shareEvent=plan.events.find(event=>event.action==='PURCHASE_SOURCE_SHARES_SAVED');if(!await store.read(names[company].activity,shareEvent._id)&&readPurchaseShares(plan.task.customerDemandTaskId,await store.all(names[company].activity)).revision!==plan.allocation.beforeRevision)throw Error('Supplier allocations changed while saving.');}
   if(existing){if(operationId(Object.fromEntries(Object.keys(plan.task).map(key=>[key,existing[key]])))!==operationId(plan.task))throw Error('Purchase source identity conflict.');}else await store.insert(names[company].tasks,plan.task);
   for(const event of plan.events){const saved=await store.read(names[company].activity,event._id);if(!saved)await store.insert(names[company].activity,{...event,activityTime:new Date(event.activityTime)});else if(operationId(saved.details)!==operationId(event.details))throw Error('Purchase source event conflict.');}
   return result;
  }});
 };
}
