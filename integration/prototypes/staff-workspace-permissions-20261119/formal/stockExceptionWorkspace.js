import { readStockExceptions, stockExceptionVersion } from 'backend/inventoryExceptions.js';
import { stockResolutionVersion } from 'backend/stockExceptionResolution.js';
const text=value=>String(value??'').trim();
export function requireStockStaff(member,records){
 const email=text(member?.loginEmail).toLowerCase(),matches=records.filter(row=>text(row.staffEmail).toLowerCase()===email),row=matches.length===1?matches[0]:null;
 if(!member?._id||member.status!=='APPROVED'||!email||!row||row.description!==member._id||text(row.staffStatus).toUpperCase()!=='ACTIVE'||!text(row.title)||!text(row.staffName))throw Error('Approved Master staff access is required.');
 const role=text(row.role).toUpperCase(),departments=Array.isArray(row.departments)?row.departments.map(value=>text(value).toUpperCase()):[],admin=role==='SUPER ADMIN';
 const permissions={canReportStockException:admin||departments.includes('WAREHOUSE'),canPlanStockResolution:admin||departments.includes('PURCHASE'),canApproveStockLoss:admin,canCloseStockException:admin||departments.includes('ACCOUNT')};
 if(!admin&&!departments.some(value=>['PURCHASE','ACCOUNT','WAREHOUSE','SUPPORT'].includes(value)))throw Error('Stock workspace access is not authorized.');
 return {memberId:member._id,staffId:row.title,staffName:row.staffName,role,...permissions};
}
export function projectStockWorkspace(context,orders,staff){
 const financial=staff.canCloseStockException||staff.canApproveStockLoss;
 const sources=context.tasks.filter(row=>row.warehouse?.hasPhysicalReceipt&&row.po).map(row=>({id:row.id,barcode:row.barcode,name:row.name,packing:row.packing,po:row.po,supplierName:context.suppliers.find(supplier=>supplier.id===row.supplierId)?.name||row.supplierId,availablePhysical:row.warehouse.stock?.availablePhysical??Math.max(0,row.warehouse.accepted),received:row.warehouse.accepted}));
 const cases=readStockExceptions(context.activity).filter(row=>row.company===context.company).map(item=>{
  const source=sources.find(row=>row.id===item.sourceTaskId),po=orders.find(row=>row.taskIds.includes(item.sourceTaskId));
  if(!source||!po)throw Error('Stock case supplier source requires review.');
  const result={...item,source};
  if(financial)result.finance={poId:po.id,amounts:po.finance.amounts,quantityClaims:po.finance.quantityClaims,stockCases:po.stockCases,documents:po.documents.filter(doc=>doc.type==='CN'&&doc.linked&&!doc.superseded),refunds:po.finance.payments.filter(payment=>payment.direction==='REFUND'&&payment.confirmed&&payment.proof?.linked),balanceCents:po.finance.balanceCents};
  return result;
 });
 return {company:context.company,version:stockExceptionVersion(context),resolutionVersion:stockResolutionVersion(context,orders),sources,cases,permissions:{report:staff.canReportStockException,decide:staff.canPlanStockResolution,approve:staff.canApproveStockLoss,close:staff.canCloseStockException},staff:{staffName:staff.staffName},readAt:new Date().toISOString()};
}
