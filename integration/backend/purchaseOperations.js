import { PURCHASE_COLLECTIONS, projectPurchaseWorkspace } from 'backend/purchaseProjection.js';
import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { taskEditVersion } from 'backend/purchaseTaskIdentity.js';
const fields=['supplierId','lpPc','lpCtn','disc1','disc2','disc3','ourPoNumber','rowPosition','purchaseStage','purchaseQtyInCtn','specialPurchase','specialPurchaseReason','risk','riskReason','manualCostField'];
const copy=value=>value==null?null:JSON.parse(JSON.stringify(value));
const prices=['lpPc','lpCtn','disc1','disc2','disc3'];
export function createPurchaseOperations({store,now=()=>new Date()}) {
  const journal=createOperationJournal({store,now});
  async function state(company,staff) {
    const names=PURCHASE_COLLECTIONS[company];if(!names)throw Error('Select NCT or GHR.');
    const [orders,tasks,activity,suppliers]=await Promise.all([store.all(names.orders),store.all(names.tasks),store.all(names.activity),store.all('SharedSuppliers')]);
    return {names,orders,tasks,activity,suppliers,workspace:projectPurchaseWorkspace({company,orders,tasks,activity,suppliers,staff})};
  }
  return async ({company,requestId,staff,operation,input})=>{
    if(!PURCHASE_COLLECTIONS[company] || !['EDIT','REORDER','PO','SPECIAL','QTY'].includes(operation))throw Error('Unsupported purchase operation.');
    const names=PURCHASE_COLLECTIONS[company];
    return journal({collection:names.activity,scope:company+'/PURCHASE',requestId,staff,input:{operation,input},prepare:async()=>{
      const s=await state(company,staff),updates=[],events=[];
      const verified=id=>{const row=s.workspace.tasks.find(row=>row.id===id);if(!row||row.archived)throw Error('Active accepted task required.');
        const task=s.tasks.find(task=>task.title===id);if(!task)throw Error('Task missing.');
        const order=s.orders.find(order=>order.title===task.description&&order.sourceLineId===task.imageAltText);if(!order||order.salesInvoiceNumber)throw Error('Customer invoice has locked this transaction.');return {row,task,order};};
      const edit=(task,patch)=>{const existing=updates.find(change=>change.id===task._id);if(existing)Object.assign(existing.patch,patch);else updates.push({id:task._id,expected:taskEditVersion(task),patch,orderId:task.description,lineId:task.imageAltText});};
      if(operation==='EDIT') {
        if(!Array.isArray(input.edits)||(!input.edits.length&&!input.taskIds)||input.edits.length>100||new Set(input.edits.map(row=>row.taskId)).size!==input.edits.length)throw Error('Select distinct task edits.');
        for(const item of input.edits) {
          const {task,order}=verified(item.taskId);if(taskEditVersion(task)!==item.version)throw Error('A task changed. Refresh before saving; your input is retained.');
          const patch={};if(!item.changes||!Object.keys(item.changes).length||Object.keys(item.changes).some(key=>!['supplierId',...prices].includes(key)))throw Error('Unsupported task field.');
          for(const [key,value] of Object.entries(item.changes)) {
            if(key==='supplierId') {if(task.ourPoNumber&&value!==task.supplierId)throw Error('Supplier is locked after assigning a P.O.');
              if(typeof value!=='string'||!s.suppliers.some(row=>row.title===value&&row.supplierStatus!=='INACTIVE'))throw Error('Select an active supplier.');patch[key]=value;continue;}
            if(typeof value!=='number'||!Number.isFinite(value)||value<0||(['disc1','disc2'].includes(key)&&value>1))throw Error('Check cost and discount values.');patch[key]=value;
          }
          if('lpPc' in patch && !('lpCtn' in patch)){if(!Number.isFinite(order.orderId)||order.orderId<=0)throw Error('EA is unavailable.');patch.lpCtn=Number((patch.lpPc*order.orderId).toFixed(2));}
          const combined={...task,...patch};if(prices.every(key=>typeof combined[key]==='number')&&combined.lpCtn*(1-combined.disc1)*(1-combined.disc2)-combined.disc3<0)throw Error('Net cost cannot be negative.');
          patch.manualCostField=[...new Set([...(task.manualCostField||[]),...Object.keys(patch).filter(key=>prices.includes(key))])];
          edit(task,patch);events.push({taskId:task.title,action:'PURCHASE_PRICE_SAVED',before:Object.fromEntries(Object.keys(patch).map(key=>[key,task[key]??null])),after:patch});
        }
        if(input.taskIds){const current=s.workspace.tasks.filter(row=>row.customerId===input.customerId&&!row.archived);
          if(!Array.isArray(input.taskIds)||input.taskIds.length!==current.length||new Set(input.taskIds).size!==current.length||current.some(row=>!input.taskIds.includes(row.id)))throw Error('Row order must include every active task for this customer.');
          input.taskIds.forEach((id,index)=>{const {task}=verified(id);if(input.versions?.[id]!==taskEditVersion(task))throw Error('Row order changed. Refresh before saving.');edit(task,{rowPosition:index+1});events.push({taskId:id,action:'PURCHASE_ROW_MOVED',before:task.rowPosition,after:index+1});});}
      } else if(operation==='REORDER') {
        const current=s.workspace.tasks.filter(row=>row.customerId===input.customerId&&!row.archived);
        if(!Array.isArray(input.taskIds)||input.taskIds.length!==current.length||new Set(input.taskIds).size!==current.length||current.some(row=>!input.taskIds.includes(row.id)))throw Error('Row order must include every active task for this customer.');
        if(current.some(row=>input.versions?.[row.id]!==taskEditVersion(s.tasks.find(task=>task.title===row.id))))throw Error('Row order changed. Refresh before saving.');
        input.taskIds.forEach((id,index)=>{const {task}=verified(id);edit(task,{rowPosition:index+1});events.push({taskId:id,action:'PURCHASE_ROW_MOVED',before:task.rowPosition,after:index+1});});
      } else if(operation==='QTY') {
        const {task,order}=verified(input.taskId),reason=String(input.reason||'').trim();
        if(task.specialPurchase)throw Error('Special Purchase quantity rules are not enabled.');
        if(taskEditVersion(task)!==input.version)throw Error('A task changed. Refresh before saving; your input is retained.');
        if(!task.supplierId||!s.suppliers.some(row=>row.title===task.supplierId&&String(row.supplierStatus||'').toUpperCase()!=='INACTIVE'))throw Error('Select and save an active supplier before editing quantity.');
        if(!Number.isSafeInteger(input.quantity)||input.quantity<0||input.quantity>9999||!Number.isSafeInteger(task.purchaseQtyInCtn)||input.quantity>=task.purchaseQtyInCtn)throw Error('Quantity can only be reduced from its current value.');
        if(!reason||reason.length>2000)throw Error('A quantity change reason is required.');
        let confirmed=order.orderQtyInCtn;
        const prior=s.activity.filter(event=>event.imageAltText===task.title&&event.action==='PURCHASE_QTY_REDUCED'&&event.result==='SAVED');
        while(prior.length){const matches=prior.filter(event=>event.details?.before===confirmed);if(matches.length!==1)throw Error('Previous quantity save requires confirmation. Retry the original save.');const event=matches[0];if(!Number.isSafeInteger(event.details.after)||event.details.after<0||event.details.after>=confirmed)throw Error('Quantity history requires review.');confirmed=event.details.after;prior.splice(prior.indexOf(event),1);}
        if(confirmed!==task.purchaseQtyInCtn)throw Error('Previous quantity save requires confirmation. Retry the original save.');
        edit(task,{purchaseQtyInCtn:input.quantity});
        events.push({taskId:task.title,action:'PURCHASE_QTY_REDUCED',before:task.purchaseQtyInCtn,after:input.quantity,reason,supplierId:task.supplierId,originalQty:order.orderQtyInCtn});
      } else if(operation==='PO') {
        const po=String(input.poNumber||'').trim().toUpperCase();if(!po||po.length>80||!Array.isArray(input.taskIds)||!input.taskIds.length||input.taskIds.length>100||new Set(input.taskIds).size!==input.taskIds.length)throw Error('P.O. number and distinct tasks are required.');
        const chosen=input.taskIds.map(verified),first=chosen[0];
        if(!first.task.supplierId||chosen.some(({task,row})=>task.supplierId!==first.task.supplierId||row.customerId!==first.row.customerId))throw Error('One P.O. must belong to one customer and one supplier.');
        if(!s.suppliers.some(row=>row.title===first.task.supplierId))throw Error('Supplier profile is missing. Select a registered supplier.');
        if(chosen.every(({task})=>task.ourPoNumber===po&&!['NEW_INCOMING','WAITING_FOR_PO'].includes(task.purchaseStage)))throw Error('P.O. number has not changed.');
        const used=s.workspace.tasks.filter(row=>row.po.trim().toUpperCase()===po);
        if(used.some(row=>row.customerId!==first.row.customerId||row.supplierId!==first.task.supplierId))throw Error('This P.O. is already assigned to another customer or supplier.');
        for(const {task} of chosen){if(input.versions?.[task.title]!==taskEditVersion(task))throw Error('A task changed. Refresh before saving.');
          const patch={ourPoNumber:po,purchaseStage:['NEW_INCOMING','WAITING_FOR_PO'].includes(task.purchaseStage)?'WAITING_FOR_SUPPLIER_INV':task.purchaseStage};
          edit(task,patch);events.push({taskId:task.title,action:'PURCHASE_PO_ASSIGNED',before:task.ourPoNumber||'',after:po});}
      } else {
        throw Error('Special Purchase quantity allocation is awaiting confirmation.');
        const {task,row}=verified(input.parentTaskId),reason=String(input.reason||'').trim();
        if(task.specialPurchase||taskEditVersion(task)!==input.version||!Number.isSafeInteger(input.extraQty)||input.extraQty<=0||input.extraQty>1000000||!reason||reason.length>2000)throw Error('Check Special Purchase source, Extra Qty and Reason.');
        const childId=operationId(company,requestId,staff.memberId,'SPECIAL'),patch=Object.fromEntries(fields.filter(key=>!['ourPoNumber','purchaseQtyInCtn','specialPurchase','specialPurchaseReason','purchaseStage','risk','riskReason','rowPosition'].includes(key)).map(key=>[key,task[key]??null]));
        Object.assign(patch,{title:childId,description:task.description,imageAltText:task.imageAltText,purchaseQtyInCtn:input.extraQty,receivedQtyInCtn:null,ourPoNumber:'',specialPurchase:true,specialPurchaseReason:reason,purchaseStage:'NEW_INCOMING',risk:false,riskReason:'',
          originalCostSnapshot:copy(task.originalCostSnapshot),latestCostReference:copy(task.latestCostReference),costStatus:task.costStatus,costErrorReason:task.costErrorReason,lastCostCaptureTime:task.lastCostCaptureTime});
        const sequence=s.workspace.tasks.filter(item=>item.customerId===row.customerId&&!item.archived).map(item=>item.id);sequence.splice(sequence.indexOf(task.title)+1,0,childId);
        sequence.forEach((id,index)=>{if(id===childId)patch.rowPosition=index+1;else edit(verified(id).task,{rowPosition:index+1});});
        updates.push({id:childId,expected:null,patch,orderId:task.description,lineId:task.imageAltText});
        events.push({taskId:childId,action:'SPECIAL_PURCHASE_ADDED',parentTaskId:task.title,submissionId:s.orders.find(order=>order.title===task.description&&order.sourceLineId===task.imageAltText).submissionId,
          extraQty:input.extraQty,reason,stockDestination:'AVATA',allocationPending:true});
      }
      return {operation,updates,events,time:now().toISOString()};
    },apply:async plan=>{
      const held=[];
      const started=now().getTime();
      const stillOwned=async taskId=>{const id=operationId(company,taskId,'COST_LOCK'),lock=await store.read(names.activity,id);if(started+90000<=now().getTime()||lock?.details?.requestId!==requestId||lock.details.actorMemberId!==staff.memberId)throw Error('Save time limit reached. Refresh and retry this same save.');};
      try {
        for(const change of [...plan.updates].sort((a,b)=>a.id.localeCompare(b.id))) {
          const lockId=operationId(company,change.patch.title||change.id,'COST_LOCK');
          if(await store.read(names.activity,lockId))throw Error('A task is busy. Retry this same save after refreshing.');
          await store.insert(names.activity,{_id:lockId,title:lockId,description:change.orderId,activityTime:now(),details:{requestId,actorMemberId:staff.memberId}});held.push(lockId);
        }
        for(const change of plan.updates) {
          await stillOwned(change.patch.title||change.id);
          const order=await store.one(names.orders,{title:change.orderId,sourceLineId:change.lineId});if(!order||order.salesInvoiceNumber)throw Error('Customer invoice has locked this transaction.');
          const current=await store.read(names.tasks,change.id),target={...current,...change.patch};
          if(change.expected===null) {if(current){if(taskEditVersion(current)!==taskEditVersion(change.patch))throw Error('Special Purchase identity conflict.');}else {const record={_id:change.id,...change.patch};if(record.lastCostCaptureTime)record.lastCostCaptureTime=new Date(record.lastCostCaptureTime);await store.insert(names.tasks,record);}}
          else if(!current)throw Error('Task missing.');
          else if(taskEditVersion(current)!==taskEditVersion(target)){if(taskEditVersion(current)!==change.expected)throw Error('Task changed while this save was pending.');await store.update(names.tasks,target);}
        }
        for(const event of plan.events) {
          await stillOwned(event.taskId);
          const change=plan.updates.find(change=>change.id===event.taskId),id=operationId(company,requestId,staff.memberId,event.taskId,event.action);
          if(!await store.read(names.activity,id))await store.insert(names.activity,{_id:id,title:id,description:change.orderId,image:change.lineId,imageAltText:event.taskId,action:event.action,
            activityTime:new Date(plan.time),actorType:'STAFF',initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,result:'SAVED',message:event.action.replaceAll('_',' '),details:{requestId,...event}});
        }
        return {ok:true,company,requestId,operation,savedAt:plan.time,taskIds:plan.updates.map(change=>change.id)};
      } finally {for(const id of held){const lock=await store.read(names.activity,id);if(lock?.details?.requestId===requestId&&lock.details.actorMemberId===staff.memberId)await store.remove(names.activity,id);}}
    }});
  };
}
