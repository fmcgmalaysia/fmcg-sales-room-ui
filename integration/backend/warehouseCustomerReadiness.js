// Read-only customer allocation view. Never expose original demand, costs or supplier financial data.
export function projectWarehouseCustomerReadiness(workspace){
 const customers=new Map(workspace.customers.map(row=>[row.id,row.name])),suppliers=new Map(workspace.suppliers.map(row=>[row.id,row.shortName||row.name]));
 return workspace.tasks.filter(row=>!row.archived&&!row.specialPurchase&&!row.procurementSource).map(row=>({id:row.id,customerId:row.customerId,customerName:customers.get(row.customerId)||row.customerId,supplierId:row.supplierId,supplierName:suppliers.get(row.supplierId)||'',po:row.po,barcode:row.barcode,name:row.name,packing:row.packing,estimatedShipmentDate:row.estimatedShipmentDate,shipmentDate:row.shipmentDate,requiredQty:row.ord,allocatedQty:row.inc,position:row.rowPosition,fulfilment:row.shortage?{decision:row.shortage.customerDecision,message:row.shortage.customerMessage,expectedDate:row.shortage.expectedDate}:null}));
}
