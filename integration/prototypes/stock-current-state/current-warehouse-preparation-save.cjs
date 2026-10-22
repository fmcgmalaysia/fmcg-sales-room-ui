'use strict';
const {createCurrentStockSave}=require('./current-stock-save.cjs');
const {currentWarehouseReadyContext}=require('./current-warehouse-ready-context.cjs');
const {validateOriginalPreparation}=require('./legacy-warehouse-preparation.cjs');
const {originalProductState}=require('./original-product-state.cjs');
const {preparePackingHoldTransition}=require('./borrowing-stock-plan.cjs');
const {hash}=require('./commit-proof.cjs');
// PRIVATE non-file co-writer. Original preparation rules/identity stay; it posts
// neither physical departure nor invoice and never allocates another customer's stock.
function createCurrentWarehousePreparationSave({company,store,protocol,coverage,authenticateOriginalWarehouse,
  readCurrentContext,createPreparationOperations,projectPreparation,currentReadyVersion,projectPurchaseOrders,
  readPreparation,readAllocations,readCustomerShipments,readPackingLists,packingHeld,now}){
  if(!['NCT','GHR'].includes(company)||protocol?.planFormat!=='SEGMENTED_V2'||typeof protocol.readSnapshot!=='function'||typeof store?.read!=='function'||currentReadyVersion!==2
    ||[authenticateOriginalWarehouse,readCurrentContext,createPreparationOperations,projectPreparation,projectPurchaseOrders,
      readPreparation,readAllocations,readCustomerShipments,readPackingLists,packingHeld,now].some(fn=>typeof fn!=='function'))throw Error('Paired private current Warehouse preparation dependencies required');
  return async request=>{
    // Refuse before any prepare/document callback. File protocol is separate.
    if(!['PACK','LOAD','UNPACK'].includes(request?.input?.action)
      ||request.input.photos!==undefined&&(!Array.isArray(request.input.photos)||request.input.photos.length))throw Error('Current non-photo Warehouse preparation required');
    let staff;
    const result=await createCurrentStockSave({company,writer:'WAREHOUSE_PREPARATION',protocol,coverage,
      authenticate:async()=>{
        const original=await authenticateOriginalWarehouse(company);
        if(!original?.staffId||!original.memberId||!original.staffName||original.customerId)throw Error('Original Warehouse preparation grant required');
        staff={...original,canPrepareWarehouse:true};return staff;
      },prepare:async command=>{
        const snapshot=await protocol.readSnapshot(async control=>{
          if(control?.company!==company||control.mode!=='ACTIVE'||control.schemaVersion!==1||control.transferIndexVersion!==2||control.pending)throw Error('Current Warehouse preparation checkpoint required');
          const data=await readCurrentContext(company,staff,control),workspace=data?.workspace,products=data?.products;
          if(workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'||data.originalContext?.company!==company
            ||typeof products?.values!=='function'||!Array.isArray(data.tables?.PurchaseOrders))throw Error('Complete current Warehouse preparation context required');
          const selectedProducts=[...products.values()];
          if(selectedProducts.some(product=>product.state?.scope!=='CURRENT_ACTIVE_PRODUCT'||product.state.lifecycleVersion!==2||!product.rows))throw Error('Scoped Warehouse preparation products required');
          const originalContext={...workspace,activity:data.originalContext.activity};
          const requiredTaskIds=[...new Set([...workspace.tasks.filter(task=>!task.archived&&!task.specialPurchase&&!task.procurementSource).map(task=>task.id),
            ...[...readPreparation(originalContext.activity).values()].filter(state=>state.loaded>0).map(state=>state.taskId)])];
          const context=currentWarehouseReadyContext({context:originalContext,states:selectedProducts.map(product=>product.state),requiredTaskIds,readAllocations,readCustomerShipments});
          const selected=projectPreparation(context).filter(row=>row.id===command.input.id);
          if(selected.length!==1)throw Error('Exact current Warehouse preparation batch required');
          const product=selectedProducts.filter(product=>product.state.tasks.some(task=>task.id===selected[0].taskId));
          if(product.length!==1)throw Error('Exact current Warehouse preparation product required');
          const validated=await validateOriginalPreparation({company,staff,requestId:command.requestId,input:command.input,context,createPreparationOperations,now}),event=validated.event;
          if(event.initiatedByStaffId!==staff.staffId||event.description!==selected[0].id||event.imageAltText!==selected[0].taskId
            ||event.image!==selected[0].customerId||validated.version!==command.input.version)throw Error('Original Warehouse preparation identity changed');
          const originalOrders=projectPurchaseOrders({company,workspace:data.originalContext,records:data.tables.PurchaseOrders});
          const after=originalProductState({company,context:{...context,activity:[...context.activity,event]},orders:originalOrders,
            identity:product[0].state,readAllocations,readCustomerShipments,readPackingLists,packingHeld,readPreparation,projectPreparation}).buildState(product[0].rows);
          return preparePackingHoldTransition({state:product[0].state,rows:product[0].rows,event,generation:control.generation,packingHolds:after.packingHolds}).plan;
        });return{plan:snapshot.rows,memberId:staff.memberId,generation:snapshot.generation};
      }})(request);
    if(result.ok!==true)return result;
    const id=hash(company,request.requestId,staff.memberId,'WAREHOUSE_PREPARATION');
    const snapshot=await protocol.readSnapshot(()=>store.read(company==='NCT'?'NCTActivity':'NCTActivity1',id)),event=snapshot.rows;
    if(!event?._version||event._id!==id||event.title!==id||event.company!==company||event.action!=='WAREHOUSE_PREPARATION_SAVED'||event.result!=='SAVED'
      ||event.initiatedByStaffId!==staff.staffId||event.description!==request.input.id||event.details?.state?.id!==request.input.id
      ||event.details.action!==request.input.action||typeof event.activityTime!=='string'||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Committed Warehouse preparation receipt requires review');
    return{...result,company,id:request.input.id,savedAt:event.activityTime};
  };
}
module.exports={createCurrentWarehousePreparationSave};
