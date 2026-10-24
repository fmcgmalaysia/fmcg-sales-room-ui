import { operationId } from 'backend/r2purchaseOperationJournal.js';
export const CBM_ACTION='WAREHOUSE_CBM_CAPTURED';
export const validCbm=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const key=(company,taskId)=>operationId(company,taskId,CBM_ACTION);
export function warehouseCbm(company,task,activity){
 if(validCbm(task.cbmPerCtn))return task.cbmPerCtn;
 const rows=activity.filter(e=>e.action===CBM_ACTION&&e.imageAltText===task.id);
 if(!rows.length)return null;
 if(rows.length!==1)throw Error('Warehouse CBM history requires review.');
 const e=rows[0],d=e.details;
 if(e._id!==key(company,task.id)||e.result!=='SAVED'||e.description!==task.orderId||d?.company!==company||d.sourceLineId!==task.sourceLineId||d.barcode!==task.barcode||!validCbm(d.cbmPerCtn))throw Error('Warehouse CBM identity requires review.');
 return d.cbmPerCtn;
}
export function createWarehouseCbmCapture({store,names,readData,captureCosts,now=()=>new Date()}){
 return async({company,staff,requestId,taskId})=>{
  if(!names[company]||!staff?.memberId||!staff.staffId||!staff.staffName||!/^[a-f0-9-]{36}$/i.test(requestId||'')||!/^[a-f0-9]{32}$/i.test(taskId||''))throw Error('Warehouse CBM request is invalid.');
  const active=async()=>{const data=await readData(company,staff),items=data.deliveryTasks.filter(i=>i.taskId===taskId&&!i.orphaned&&!i.dispatched);if(!items.length)throw Error('Warehouse active delivery task is unavailable.');return items[0];};
  let item=await active();
  if(validCbm(item.cbmPerCtn))return {ok:true,requestId,taskId,cbmPerCtn:item.cbmPerCtn,retained:true};
  const value=(await captureCosts([item.barcode]))?.[item.barcode];
  if(!value||value.unitBarcode!==item.barcode||!validCbm(value.cbmPerCtn)||!Number.isFinite(Date.parse(value.capturedAt))||!value.source||!Array.isArray(value.costIssues)||value.costIssues.some(s=>/BARCODE|READ_FAILED|ROW_READ|HEADER/.test(s)))throw Error('Warehouse CBM is still unavailable in POINTBASE. 请确认管理员已补齐 CBM。');
  const first=item;item=await active();
  if(item.orderId!==first.orderId||item.sourceLineId!==first.sourceLineId||item.barcode!==first.barcode)throw Error('Warehouse CBM task changed. Refresh before retrying.');
  if(validCbm(item.cbmPerCtn))return {ok:true,requestId,taskId,cbmPerCtn:item.cbmPerCtn,retained:true};
  const id=key(company,taskId),event={_id:id,title:id,description:item.orderId,imageAltText:taskId,action:CBM_ACTION,result:'SAVED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:'Missing CBM captured from POINTBASE',details:{company,sourceLineId:item.sourceLineId,barcode:item.barcode,cbmPerCtn:value.cbmPerCtn,capturedAt:value.capturedAt,source:value.source}};
  try{await store.insert(names[company].activity,event);}catch(error){const existing=await store.read(names[company].activity,id);if(!existing)throw error;}
  const confirmed=await active();
  if(!validCbm(confirmed.cbmPerCtn))throw Error('Warehouse CBM save is unconfirmed. Retry the same request.');
  return {ok:true,requestId,taskId,cbmPerCtn:confirmed.cbmPerCtn};
 };
}
