'use strict';
const {projectCurrentWarehouseReady}=require('./current-warehouse-ready-context.cjs');
const {copy}=require('./segmented-plan.cjs');
// PRIVATE composition. Receipt PO/version remains ORIGINAL physical-source facts;
// customer availability and Ready use current ownership. Neither is stored twice.
function createCurrentWarehouseOrdersRead({company,protocol,authenticate,readCurrentContext,projectPurchaseOrders,
  projectWarehouseOrders,projectWarehouseCustomerReadiness,projectPreparation,currentReadyVersion,readAllocations,
  readCustomerShipments,readPreparation,warehouseCbm,readCustomerShortNames,now}){
  if(!['NCT','GHR'].includes(company)||typeof protocol?.readSnapshot!=='function'||currentReadyVersion!==2
    ||[authenticate,readCurrentContext,projectPurchaseOrders,projectWarehouseOrders,projectWarehouseCustomerReadiness,
      projectPreparation,readAllocations,readCustomerShipments,readPreparation,warehouseCbm,readCustomerShortNames,now].some(fn=>typeof fn!=='function'))throw Error('Paired original current Warehouse read dependencies required');
  return async selected=>{
    if(selected!==company)throw Error('Warehouse orders company conflict');
    const staff=await authenticate(company);if(!staff?.staffId||!staff.memberId||!staff.staffName)throw Error('Original Warehouse identity required');
    const snapshot=await protocol.readSnapshot(async control=>{
      if(control?.company!==company||control.mode!=='ACTIVE'||control.pending||control.schemaVersion!==1||control.transferIndexVersion!==2
        ||!control.writerBuild||!Number.isSafeInteger(control.generation)||control.generation<0)throw Error('Current Warehouse control required');
      const data=await readCurrentContext(company,staff,control),workspace=data?.workspace,original=data?.originalContext;
      if(workspace?.company!==company||workspace.stockAllocationView!=='CURRENT_V2'||original?.company!==company
        ||!Array.isArray(workspace.tasks)||!Array.isArray(original.tasks)||!Array.isArray(original.activity)
        ||!Array.isArray(data.tables?.PurchaseOrders)||!Array.isArray(data.states)
        ||data.states.some(state=>state.scope!=='CURRENT_ACTIVE_PRODUCT'||state.lifecycleVersion!==2)
        ||workspace.tasks.length!==original.tasks.length||new Set(workspace.tasks.map(row=>row.id)).size!==workspace.tasks.length
        ||workspace.tasks.some(row=>!original.tasks.some(task=>task.id===row.id&&task.customerId===row.customerId
          &&task.orderId===row.orderId&&task.sourceLineId===row.sourceLineId&&task.po===row.po&&task.ord===row.ord)))throw Error('Complete original and current Warehouse facts required');
      const context={...copy(workspace),activity:copy(original.activity)};
      const loaded=[...readPreparation(context.activity).values()].filter(state=>state.loaded>0).map(state=>state.taskId);
      const requiredTaskIds=[...new Set([...context.tasks.filter(task=>!task.archived&&!task.specialPurchase&&!task.procurementSource).map(task=>task.id),...loaded])];
      if(requiredTaskIds.some(id=>!context.tasks.some(task=>task.id===id)))throw Error('Loaded Warehouse task requires review');
      const deliveryTasks=projectCurrentWarehouseReady({context,states:data.states,requiredTaskIds,projectPreparation,currentReadyVersion,
        readAllocations,readCustomerShipments}).map(item=>{
        const task=context.tasks.find(row=>row.id===item.taskId);
        return {...item,sourceLineId:task?.sourceLineId,cbmPerCtn:task?warehouseCbm(company,task,context.activity):null};
      });
      // Never feed borrowed inc into original physical receipt bootstrap guard,
      // nor change original PO version just because customer ownership moved.
      const orders=projectWarehouseOrders({company,purchaseOrders:projectPurchaseOrders({company,workspace:original,records:data.tables.PurchaseOrders}),
        tasks:original.tasks,activity:original.activity});
      const customerLines=projectWarehouseCustomerReadiness(workspace);let names=[];
      try{names=await readCustomerShortNames([...new Set([...orders.flatMap(row=>row.customerIds||[row.customerId]),...customerLines.map(row=>row.customerId)])]);}catch(_){}
      if(!Array.isArray(names))throw Error('Original Warehouse customer names require review');
      return{company,staff:{staffId:staff.staffId,staffName:staff.staffName,memberId:staff.memberId},deliveryTasks,
        customerLines:customerLines.map(row=>({...row,fullCustomerName:row.customerName,customerName:names.find(item=>item.customerId===row.customerId)?.shortName||row.customerName})),
        orders:orders.map(row=>({...row,fullCustomerName:row.customerName,customerName:(row.customers||[{id:row.customerId,name:row.customerName}])
          .map(customer=>names.find(item=>item.customerId===customer.id)?.shortName||customer.name).join(' · ')})),
        readAt:now().toISOString(),stockCurrent:{schema:'CURRENT_WAREHOUSE_V2',stockProtocol:1,stockBuild:control.writerBuild,stockGeneration:control.generation,generation:control.generation}};
    });return snapshot.rows;
  };
}
module.exports={createCurrentWarehouseOrdersRead};
