import { webMethod, Permissions } from 'wix-web-module';
import { readManagedCompanyAccess } from 'backend/staffManagementAccess.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { capturePointbaseCosts } from 'backend/pointbaseCostClient.js';
import { applyMissingCbm, previewMissingCbm, sortByProductOrder } from 'backend/supportCbm.js';

function supportProductRequest({ readAccess, readContext, fetchPointbase, store }) {
 return async (company, requestId, input, reportStage) => {
  const sorting=input?.action==='SORT';
  if(!sorting&&!['CBM_PREVIEW','CBM_APPLY'].includes(input?.action))throw Error('Select a Support product action.');
  reportStage?.('access');
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
  if(input.action==='CBM_APPLY')return applyMissingCbm({company,taskId:input.taskId,preview:input.preview,staff,readContext:scopedContext,fetchPointbase,store});
  reportStage('tasks');
  const context=await scopedContext();
  reportStage('eligibility');
  return previewMissingCbm(context,input.taskId,async barcodes=>{
   reportStage('pointbase');
   const source=await fetchPointbase(barcodes);
   reportStage('result');
   return source;
  });
 };
}
const runSupportProductRequest=supportProductRequest({
 readAccess:readManagedCompanyAccess,readContext:readFulfilmentContext,fetchPointbase:capturePointbaseCosts,store:fulfilmentStore
});
export const handleSupportProduct=webMethod(Permissions.SiteMember,async (company,requestId,input)=>{
 if(input?.action!=='CBM_PREVIEW')return runSupportProductRequest(company,requestId,input);
 let stage='request';
 try{
  return await runSupportProductRequest(company,requestId,input,value=>{stage=value;});
 }catch(error){
  const expected={
   'CBM is still missing in Pointbase.':'CBM is still missing in Pointbase. Ask Super Admin to update it, then fetch again.',
   'Pointbase could not confirm a unique barcode.':'Pointbase could not confirm a unique barcode.',
   'This task no longer needs CBM.':'This task no longer needs CBM. Refresh the Desk and check again.'
  };
  const phase={request:'The selected task could not be validated.',access:'Support edit access could not be confirmed.',
   tasks:'Support could not read the current tasks.',eligibility:'Support could not check the task and invoice history.',
   pointbase:'Support could not read Pointbase.',result:'Support could not validate the Pointbase result.'};
  return {ok:false,error:Object.hasOwn(expected,error?.message)?expected[error.message]:phase[stage]};
 }
});
