import { operationId } from 'backend/purchaseOperationJournal.js';
import { projectPreparation } from 'backend/warehousePreparation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';

export function requirePackingStaff(member,records,department){
 if(!['SUPPORT','WAREHOUSE'].includes(department)||!member?._id||member.status!=='APPROVED'||!member.loginEmail)throw Error('Sign in with an approved Master staff account.');
 const matches=records.filter(row=>String(row.staffEmail||'').trim().toLowerCase()===member.loginEmail.trim().toLowerCase()),row=matches.length===1?matches[0]:null;
 if(!row||row.description!==member._id||String(row.staffStatus).toUpperCase()!=='ACTIVE'||!row.title||!row.staffName)throw Error('Master staff access is not configured.');
 if(String(row.role).toUpperCase()!=='SUPER ADMIN'&&!(row.departments||[]).map(value=>String(value).toUpperCase()).includes(department))throw Error('This packing department is not authorized.');
 return {memberId:member._id,staffId:row.title,staffName:row.staffName,packingDepartment:department};
}
export function projectPackingContext(context){
 const preparation=projectPreparation(context),shipments=readCustomerShipments(context.activity),customers=new Map((context.customers||[]).map(row=>[row.id,row.name]));
 const tasks=context.tasks.filter(task=>!task.procurementSource&&!task.specialPurchase&&!task.archived).map(task=>{
  const rows=preparation.filter(row=>row.taskId===task.id),sent=shipments.filter(row=>row.status==='DISPATCHED').flatMap(row=>row.lines).filter(line=>line.taskId===task.id).reduce((sum,line)=>sum+line.quantity,0);
  const legacy=shipments.some(row=>row.status!=='CANCELLED'&&row.status!=='DISPATCHED'&&row.lines.some(line=>line.taskId===task.id));
  const remaining=Math.max(0,(task.requested??task.ord)-sent),ready=rows.reduce((sum,row)=>sum+(Number.isSafeInteger(row.readyStock)?row.readyStock:0),0);
  return {taskId:task.id,company:context.company,customerId:task.customerId,customerName:customers.get(task.customerId)||task.customerId,currency:task.transactionCurrency,barcode:task.barcode||'',name:task.name||'',packing:task.packing||'',remaining,ready:Math.min(remaining,ready),cbm:null,weight:null,review:legacy||rows.some(row=>row.stale||row.orphaned||row.prepared||row.loaded>0)};
 });
 return {company:context.company,tasks,lists:readPackingLists(context.activity,context.company),sourceVersion:operationId(context.tasks,context.allocations||[],preparation,shipments),readAt:new Date().toISOString()};
}
