import { operationId, createOperationJournal } from 'backend/purchaseOperationJournal.js';
import { changePackingList, packingAvailability } from 'backend/packingListModel.js';
import { Buffer } from 'buffer';

export const PACKING_CURRENT='SUPPORT_PACKING_LIST_CURRENT';
export function readPackingLists(activity,company){
 const records=activity.filter(row=>row.action===PACKING_CURRENT);
 const ids=new Set();
 return records.map(row=>{const list=row.details?.list;
  if(!list||row._id!==operationId(company,list.id,'PACKING_CURRENT')||row.description!==list.id||list.company!==company||ids.has(list.id)||!list.revision||!list.customerId||!list.currency||!['DRAFT','SENT','PROCESSING','COMPLETED','CANCELLED'].includes(list.status)||!Array.isArray(list.lines)||list.lines.length<1||list.lines.length>300||new Set(list.lines.map(line=>line.taskId)).size!==list.lines.length||list.lines.some(line=>!line.taskId||![line.quantity,line.packed,line.loaded].every(value=>Number.isSafeInteger(value)&&value>=0&&value<=9999)||line.quantity===0||line.loaded>line.packed||line.packed>line.quantity))throw Error('Packing list identity requires review.');
  if(list.change&&(!Array.isArray(list.change.lines)||!list.change.lines.length||list.change.lines.length>300||new Set(list.change.lines.map(line=>line.taskId)).size!==list.change.lines.length||list.change.lines.some(line=>!line.taskId||!Number.isSafeInteger(line.quantity)||line.quantity<=0||line.quantity>9999)))throw Error('Packing change requires review.');
  ids.add(list.id);return JSON.parse(JSON.stringify(list));
 });
}
export function packingVersion(context){return operationId(context.company,context.sourceVersion,context.tasks,context.lists);}
export function projectPackingWorkroom(context,department){
 if(!['SUPPORT','WAREHOUSE'].includes(department))throw Error('Packing department is not authorized.');
 return {company:context.company,version:packingVersion(context),tasks:department==='SUPPORT'?packingAvailability(context):[],lists:context.lists.filter(list=>department==='SUPPORT'||list.status!=='DRAFT'),readAt:context.readAt||null};
}
// Adapter intentionally has no Wix binding yet. Shared Sales/planner/legacy loading
// guards must be integrated and verified before a production endpoint enables it.
export function createPackingListOperations({store,names,readContext,now=()=>new Date()}){
 const journal=createOperationJournal({store,now});
 return async({company,staff,requestId,input})=>{
  const department=staff?.packingDepartment;
  if(!names[company]||!['SUPPORT','WAREHOUSE'].includes(department)||!input)throw Error('Packing access is not authorized.');
  const collection=names[company].activity;
  return journal({collection,scope:company+'/PURCHASE',requestId,staff,input:{packing:input},prepare:async()=>{
   const context=await readContext(company,staff);
   if(context.company!==company||packingVersion(context)!==input.version)throw Error('Packing workroom changed. Refresh before saving.');
   const id=input.action==='CREATE'?operationId(company,requestId,staff.memberId,'PACKING'):input.id;
   const current=context.lists.find(list=>list.id===id);
   if(input.action!=='CREATE'&&!current)throw Error('Packing list is unavailable.');
   const revision=operationId(company,requestId,staff.memberId,'PACKING_REVISION'),at=now().toISOString();
   const next=changePackingList({list:current,input:{...input,company},context,actor:department,id,revision,at});
   next.updatedBy=staff.staffName;next.updatedByStaffId=staff.staffId;
   if(Buffer.byteLength(JSON.stringify(next),'utf8')>200000)throw Error('Packing list is too large. Use a smaller packing list.');
   return {expectedVersion:input.version,beforeRevision:current?.revision||'',record:{_id:operationId(company,id,'PACKING_CURRENT'),title:id,description:id,image:next.customerId,action:PACKING_CURRENT,result:'SAVED',actorType:'STAFF',activityTime:at,initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,details:{list:next}}};
  },apply:async plan=>{
   const existing=await store.read(collection,plan.record._id),list=plan.record.details.list;
   if(existing?.details?.list?.revision===list.revision){
    if(operationId(existing.details)!==operationId(plan.record.details))throw Error('Packing receipt conflict.');
   }else{
    if((existing?.details?.list?.revision||'')!==plan.beforeRevision)throw Error('Packing list changed while saving.');
    if(packingVersion(await readContext(company,staff))!==plan.expectedVersion)throw Error('Stock or packing workroom changed while saving.');
    const row={...plan.record,activityTime:new Date(plan.record.activityTime)};
    if(existing)await store.update(collection,row);else await store.insert(collection,row);
   }
   return {ok:true,company,requestId,id:list.id,revision:list.revision,status:list.status};
  }});
 };
}
