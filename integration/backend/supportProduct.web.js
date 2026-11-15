import { webMethod, Permissions } from 'wix-web-module';
import { readManagedCompanyAccess } from 'backend/staffManagementAccess.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { capturePointbaseCosts } from 'backend/pointbaseCostClient.js';
import { applyMissingCbm, previewMissingCbm, sortByProductOrder } from 'backend/supportCbm.js';

function supportProductRequest({ readAccess, readContext, fetchPointbase, store }) {
 return async (company, requestId, input) => {
  const sorting=input?.action==='SORT';
  if(!sorting&&!['CBM_PREVIEW','CBM_APPLY'].includes(input?.action))throw Error('Select a Support product action.');
  const level=sorting?'VIEW':'EDIT',access=await readAccess(company);
  if(!access.enter('SUPPORT',level))throw Error('Support product access is unavailable.');
  const staff={...access.staff,packingDepartment:'SUPPORT'};
  const scopedContext=async ()=>{
   const context=await readContext(company,staff,{includeSuppliers:false});
   if(context.company!==company)throw Error('The company changed.');
   return {...context,tasks:context.tasks.filter(row=>access.can('SUPPORT',level,row.customerId))};
  };
  if(sorting){
   const ids=input.taskIds;
   if(!Array.isArray(ids)||!ids.length||ids.length>300||new Set(ids).size!==ids.length||
      ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{32}$/i.test(id)))throw Error('Select up to 300 Support task rows.');
   const context=await scopedContext(),byId=new Map(context.tasks.map(row=>[row.id,row]));
   const rows=ids.map(id=>byId.get(id));
   if(rows.some(row=>!row||row.archived||row.procurementSource||row.specialPurchase)||
      new Set(rows.map(row=>row.customerId)).size!==1)throw Error('The selected customer tasks are unavailable.');
   const barcodes=[...new Set(rows.map(row=>row.barcode).filter(Boolean))];
   if(!barcodes.length)return {taskIds:ids,matched:0};
   const source=await fetchPointbase(barcodes);
   const metadata=new Map(barcodes.flatMap(barcode=>{
    const row=source?.[barcode];
    return row?.unitBarcode===barcode&&row.sortNo&&row.source?.sheetName?[ [barcode,{category:row.source.sheetName,sortNo:row.sortNo}] ]:[];
   }));
   return {taskIds:sortByProductOrder(rows,metadata).map(row=>row.id),matched:metadata.size};
  }
  if(!/^[a-f0-9]{32}$/i.test(input.taskId||''))throw Error('Select an active Support task.');
  return input.action==='CBM_PREVIEW'
   ? previewMissingCbm(await scopedContext(),input.taskId,fetchPointbase)
   : applyMissingCbm({company,taskId:input.taskId,preview:input.preview,staff,readContext:scopedContext,fetchPointbase,store});
 };
}
const runSupportProductRequest=supportProductRequest({
 readAccess:readManagedCompanyAccess,readContext:readFulfilmentContext,fetchPointbase:capturePointbaseCosts,store:fulfilmentStore
});
export const handleSupportProduct=webMethod(Permissions.SiteMember,async (company,requestId,input)=>
 runSupportProductRequest(company,requestId,input));
