import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';

const qty=value=>Number.isSafeInteger(value)&&value>=0&&value<=9999;
export function readAllocations(activity){
  const pending=activity.filter(event=>event.action==='PLANNER_ALLOCATION_SAVED'&&event.result==='SAVED'),sources=new Map();
  while(pending.length){
    const candidates=pending.filter(event=>(sources.get(event.imageAltText)?.revision||'')===event.details?.beforeRevision);
    if(!candidates.length||new Set(candidates.map(event=>event.imageAltText)).size!==candidates.length)throw Error('Allocation history requires review.');
    for(const event of candidates){
      const detail=event.details;
      if(!event.title||!event.imageAltText||!Array.isArray(detail.targets)||new Set(detail.targets.map(row=>row.taskId)).size!==detail.targets.length||detail.targets.some(row=>!row.taskId||!qty(row.quantity)))throw Error('Allocation identity requires review.');
      sources.set(event.imageAltText,{sourceTaskId:event.imageAltText,revision:event.title,targets:detail.targets,at:new Date(event.activityTime).toISOString(),by:event.initiatedByStaffName});
      pending.splice(pending.indexOf(event),1);
    }
  }
  return [...sources.values()];
}
export function allocatedTo(taskId,activity){
  const sources=readAllocations(activity).filter(source=>source.targets.some(row=>row.taskId===taskId));
  return {quantity:sources.reduce((total,source)=>total+(source.targets.find(row=>row.taskId===taskId)?.quantity||0),0),at:sources.map(source=>source.at).sort().at(-1)||null,sources};
}
export function allocationVersion(workspace,activity){
  return operationId(workspace.company,workspace.tasks.map(row=>[row.id,row.editVersion,row.ord,row.warehouse,row.salesInvoiceNumber]),readAllocations(activity));
}
export function createPlannerAllocationOperations({store,names,readWorkspace,now=()=>new Date()}){
  const journal=createOperationJournal({store,now});
  return async({company,staff,requestId,input})=>{
    if(!names[company]||input?.action!=='ALLOCATE')throw Error('Select a receiving line to allocate.');
    const collection=names[company].activity;
    return journal({collection,scope:company+'/PURCHASE',requestId,staff,input:{allocation:input},prepare:async()=>{
      const workspace=await readWorkspace(company,staff),activity=await store.all(collection),version=allocationVersion(workspace,activity);
      if(input.version!==version)throw Error('Stock or allocations changed. Refresh before allocating.');
      const source=workspace.tasks.find(row=>row.id===input.sourceTaskId),reason=String(input.reason||'').trim();
      if(!source?.warehouse||!source.po||!source.supplierId)throw Error('Warehouse receipt and source P.O. are required.');
      if(!reason||reason.length>2000)throw Error('Enter an allocation reason.');
      if(!Array.isArray(input.targets)||input.targets.length>300||new Set(input.targets.map(row=>row.taskId)).size!==input.targets.length)throw Error('Select distinct customer task allocations.');
      const prior=readAllocations(activity),old=prior.find(row=>row.sourceTaskId===source.id);
      const targets=input.targets.map(entry=>{
        const target=workspace.tasks.find(row=>row.id===entry.taskId);
        if(!target||target.archived||target.specialPurchase||target.barcode!==source.barcode||target.packing!==source.packing||target.ea!==source.ea||!qty(entry.quantity))throw Error('Allocate only matching products to active customer tasks.');
        const other=prior.filter(row=>row.sourceTaskId!==source.id).reduce((total,row)=>total+(row.targets.find(item=>item.taskId===target.id)?.quantity||0),0);
        if(other+entry.quantity>target.ord)throw Error('Allocated cartons exceed customer demand.');
        if(target.salesInvoiceNumber&&(old?.targets.find(row=>row.taskId===target.id)?.quantity||0)!==entry.quantity)throw Error('Invoiced allocation must be corrected through Support.');
        return {taskId:target.id,orderId:target.orderId,sourceLineId:target.sourceLineId,customerId:target.customerId,quantity:entry.quantity};
      });
      for(const entry of old?.targets||[]){if(!targets.some(row=>row.taskId===entry.taskId)&&workspace.tasks.find(row=>row.id===entry.taskId)?.salesInvoiceNumber)throw Error('Invoiced allocation cannot be removed.');}
      if(targets.reduce((total,row)=>total+row.quantity,0)>source.warehouse.accepted)throw Error('Allocate no more than the actual accepted cartons.');
      if(operationId(targets)===operationId(old?.targets||[]))throw Error('Allocation has not changed.');
      const id=operationId(company,requestId,staff.memberId,'ALLOCATION'),at=now().toISOString();
      return {expectedVersion:version,event:{_id:id,title:id,description:source.orderId,image:source.customerId,imageAltText:source.id,action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,activityTime:at,message:'Received stock allocated',details:{beforeRevision:old?.revision||'',sourceTaskId:source.id,targets,reason,accepted:source.warehouse.accepted}}};
    },apply:async plan=>{
      const existing=await store.read(collection,plan.event._id);
      if(!existing){
        const workspace=await readWorkspace(company,staff),activity=await store.all(collection);
        if(allocationVersion(workspace,activity)!==plan.expectedVersion)throw Error('Stock or allocations changed while saving.');
        await store.insert(collection,{...plan.event,activityTime:new Date(plan.event.activityTime)});
      }else if(operationId(existing.details)!==operationId(plan.event.details))throw Error('Allocation receipt conflict.');
      return {ok:true,company,requestId,sourceTaskId:plan.event.imageAltText,savedAt:plan.event.activityTime};
    }});
  };
}
