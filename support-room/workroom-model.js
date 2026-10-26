(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SupportWorkroom=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  const key=(...parts)=>JSON.stringify(parts);
  const sum=(rows,field)=>rows.reduce((n,row)=>n+(finite(row[field])??0),0);
  // Read-only presentation. Missing reconciliation is never treated as zero paid.
  function project(fulfilment,packing){
    if(!fulfilment||!['NCT','GHR'].includes(fulfilment.company)||!Array.isArray(fulfilment.lines)||!Array.isArray(fulfilment.customers))throw Error('Customer orders are unavailable.');
    if(packing&&packing.company!==fulfilment.company)throw Error('Company changed. Refresh the workroom.');
    const customerNames=new Map(fulfilment.customers.map(row=>[row.id,row.name]));
    const shipments=(fulfilment.shipments||[]).filter(row=>row.status!=='CANCELLED');
    const orders=new Map(),seen=new Set();
    for(const source of fulfilment.lines){
      if(!source.taskId||seen.has(source.taskId)||!source.customerId||!source.orderId)throw Error('Order line identity requires review.');
      seen.add(source.taskId);
      const orderKey=key(source.customerId,source.orderId,source.currency||'');
      if(!orders.has(orderKey))orders.set(orderKey,{id:orderKey,customerId:source.customerId,customerName:customerNames.get(source.customerId)||source.customerId,orderId:source.orderId,currency:source.currency||'',country:source.country||'',port:source.port||'',lines:[],shipments:[]});
      const loadedRecords=(packing?.lists||[]).filter(list=>list.status!=='CANCELLED'&&list.status!=='DRAFT').flatMap(list=>list.lines.filter(line=>line.taskId===source.taskId));
      const invoiceRecords=shipments.filter(row=>['INVOICED','DISPATCHED'].includes(row.status)).flatMap(row=>row.lines.filter(line=>line.taskId===source.taskId));
      const packingTask=packing?.tasks?.find(row=>row.taskId===source.taskId);
      orders.get(orderKey).lines.push({...source,orderQty:finite(source.originalRequested)??finite(source.requested),committedQty:null,
        loadedQty:packing?sum(loadedRecords,'loaded'):null,invoicedQty:sum(invoiceRecords,'quantity'),
        pricePc:finite(source.sellingPricePc),priceCtn:finite(source.sellingPriceCtn),gp:finite(source.gp),
        cbm:finite(source.cbmPerCtn)??finite(packingTask?.cbm)});
    }
    // Include invoiced/archived orders even when absent from the active task list.
    for(const shipment of shipments){
      for(const orderId of new Set(shipment.lines.map(line=>line.orderId))){
        const id=key(shipment.customerId,orderId,shipment.currency||'');
        if(!orders.has(id))orders.set(id,{id,customerId:shipment.customerId,customerName:customerNames.get(shipment.customerId)||shipment.customerId,orderId,currency:shipment.currency||'',country:'',port:'',lines:[],shipments:[]});
        orders.get(id).shipments.push(shipment);
      }
    }
    const result=[...orders.values()].map(order=>({...order,items:new Set(order.lines.map(line=>key(line.barcode,line.packing))).size,
      orderQty:sum(order.lines,'orderQty'),loadedQty:packing?sum(order.lines,'loadedQty'):null,
      progress:order.lines.length?'In Progress':order.shipments.length&&order.shipments.every(row=>row.status==='DISPATCHED')?'Dispatched':'Awaiting Shipment',
      eta:[...new Set(order.lines.map(line=>line.estimatedShipmentDate).filter(Boolean))].join(' · ')}));
    const invoices=shipments.filter(row=>row.invoice).map(row=>({...row,number:row.invoice.number,date:row.invoice.date,amountCents:row.invoice.amountCents,
      shipmentStatus:row.status==='DISPATCHED'?'Dispatched':'Awaiting Shipment',paymentStatus:'Awaiting Reconciliation',paidCents:null,balanceCents:null}));
    const customers=fulfilment.customers.map(customer=>({...customer,orders:result.filter(order=>order.customerId===customer.id),invoices:invoices.filter(row=>row.customerId===customer.id),
      transactions:(fulfilment.customerAccount?.entries||[]).filter(row=>row.customerId===customer.id)}));
    return {company:fulfilment.company,staff:fulfilment.staff,orders:result,customers,invoices,readAt:fulfilment.readAt};
  }
  return {project};
});
