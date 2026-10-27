(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SupportWorkroom=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  const key=(...parts)=>JSON.stringify(parts);
  const orderDay=value=>{if(!value||!Number.isFinite(Date.parse(value)))return '';return new Date(Date.parse(value)+8*60*60*1000).toISOString().slice(0,10);};
  const sum=(rows,field)=>rows.reduce((n,row)=>n+(finite(row[field])??0),0);
  // Read-only presentation. Missing reconciliation is never treated as zero paid.
  function project(fulfilment,packing,bookingResult,invoiceState,documentResult,directory){
    if(!fulfilment||!['NCT','GHR'].includes(fulfilment.company)||!Array.isArray(fulfilment.lines)||!Array.isArray(fulfilment.customers))throw Error('Customer orders are unavailable.');
    if(packing&&packing.company!==fulfilment.company)throw Error('Company changed. Refresh the workroom.');
    if(bookingResult&&bookingResult.company!==fulfilment.company)throw Error('Company changed. Refresh the workroom.');
    if(invoiceState&&invoiceState.company!==fulfilment.company)throw Error("Company changed. Refresh the workroom.");
    if(documentResult&&documentResult.company!==fulfilment.company)throw Error("Company changed. Refresh the workroom.");
    if(directory&&(directory.company!==fulfilment.company||!Array.isArray(directory.customers)))throw Error('Customer directory could not be confirmed.');
    const directoryRows=directory?.customers||[];if(new Set(directoryRows.map(row=>row.id)).size!==directoryRows.length)throw Error('Duplicate customer directory identity.');const customerRows=new Map(fulfilment.customers.map(row=>[row.id,{...row}]));
    for(const row of directoryRows){if(!row.id||!row.name)throw Error('Customer directory identity requires review.');customerRows.set(row.id,{...customerRows.get(row.id),...row});}
    const customerNames=new Map([...customerRows.values()].map(row=>[row.id,row.name]));
    const shipments=(fulfilment.shipments||[]).filter(row=>row.status!=='CANCELLED');
    const orders=new Map(),seen=new Set();
    for(const source of fulfilment.lines){
      if(!source.taskId||seen.has(source.taskId)||!source.customerId||!source.orderId)throw Error('Order line identity requires review.');
      seen.add(source.taskId);
      const orderKey=key(source.customerId,source.orderId,source.currency||'');
      if(!orders.has(orderKey))orders.set(orderKey,{id:orderKey,customerId:source.customerId,customerName:customerNames.get(source.customerId)||source.customerId,orderId:source.orderId,currency:source.currency||'',country:customerRows.get(source.customerId)?.country||source.country||'',port:customerRows.get(source.customerId)?.port||source.port||'',orderDate:orderDay(source.orderDate),lines:[],shipments:[]});
      const loadedRecords=(packing?.lists||[]).filter(list=>list.status!=='CANCELLED'&&list.status!=='DRAFT').flatMap(list=>list.lines.filter(line=>line.taskId===source.taskId));
      const invoiceRecords=shipments.filter(row=>['INVOICED','DISPATCHED'].includes(row.status)).flatMap(row=>row.lines.filter(line=>line.taskId===source.taskId));
      const packingTask=packing?.tasks?.find(row=>row.taskId===source.taskId),ready=invoiceState?.lines?.find(row=>row.taskId===source.taskId);
      orders.get(orderKey).lines.push({...source,orderQty:finite(source.originalRequested)??finite(source.requested),committedQty:null,allocQty:finite(source.allocated),
        loadedQty:loadedRecords.length?sum(loadedRecords,'loaded'):finite(ready?.loadedQty),invoiceReadyQty:finite(ready?.maxInvoiceQty)??0,invoiceIssue:ready?.reason||'',invoicedQty:sum(invoiceRecords,'quantity'),shippedQty:sum(shipments.filter(row=>row.status==='DISPATCHED').flatMap(row=>row.lines.filter(line=>line.taskId===source.taskId)),'quantity'),
        pricePc:finite(source.sellingPricePc),priceCtn:finite(source.sellingPriceCtn),gp:finite(ready?.gpPercent),
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
    const result=[...orders.values()].map(order=>({...order,booking:bookingResult?.bookings?.find(row=>row.customerId===order.customerId&&row.orderId===order.orderId)||null,bookingAvailable:Boolean(bookingResult),items:new Set(order.lines.map(line=>key(line.barcode,line.packing))).size,
      orderQty:sum(order.lines,'orderQty'),loadedQty:order.lines.every(line=>finite(line.loadedQty)!==null)?sum(order.lines,'loadedQty'):null,
      progress:order.lines.length?'In Progress':order.shipments.length&&order.shipments.every(row=>row.status==='DISPATCHED')?'Dispatched':'Awaiting Shipment',
      eta:[...new Set(order.lines.map(line=>line.estimatedShipmentDate).filter(Boolean))].join(' · ')}));
    const invoices=shipments.filter(row=>row.invoice).map(row=>({...row,number:row.invoice.number,date:row.invoice.date,amountCents:row.invoice.amountCents,
      shipmentStatus:row.status==='DISPATCHED'?'Dispatched':'Awaiting Shipment',paymentStatus:'Awaiting Reconciliation',paidCents:null,balanceCents:null}));
    const workRows=result.filter(order=>order.lines.some(line=>(line.orderQty??0)>line.invoicedQty)).map(order=>({...order,lines:order.lines.filter(line=>(line.orderQty??0)>line.invoicedQty),items:new Set(order.lines.filter(line=>(line.orderQty??0)>line.invoicedQty).map(line=>key(line.barcode,line.packing))).size,shipments:[],progress:'To Invoice'})).concat(invoices.map(invoice=>{const order=result.find(row=>row.customerId===invoice.customerId&&invoice.lines.some(line=>line.orderId===row.orderId));return {...order,id:'INVOICE:'+invoice.id,bookingOrderId:order?.id,customerId:invoice.customerId,customerName:customerNames.get(invoice.customerId)||invoice.customerId,orderId:invoice.lines[0]?.orderId||'',currency:invoice.currency,lines:invoice.lines,items:new Set(invoice.lines.map(line=>key(line.barcode,line.packing))).size,shipments:[invoice],invoiceId:invoice.id,progress:invoice.shipmentStatus};}));
    const customers=[...customerRows.values()].map(customer=>({...customer,orders:result.filter(order=>order.customerId===customer.id),invoices:invoices.filter(row=>row.customerId===customer.id),
      openTaskCount:result.filter(order=>order.customerId===customer.id).reduce((total,order)=>total+order.lines.filter(line=>line.invoicedQty<(line.orderQty??0)).length,0),balanceCents:null,
      transactions:(fulfilment.customerAccount?.entries||[]).filter(row=>row.customerId===customer.id).concat((documentResult?.documents||[]).filter(row=>row.customerId===customer.id&&['$','CN'].includes(row.code)).map(row=>({...row,type:row.code==='$'?'PAYMENT_DOCUMENT':'CREDIT_NOTE_DOCUMENT',number:row.reference,date:row.at,pending:true})))}));
    return {company:fulfilment.company,staff:fulfilment.staff,orders:result,workRows,customers,invoices,directoryAvailable:Boolean(directory),invoiceVersion:invoiceState?.version||null,documents:documentResult?.documents||[],documentVersion:documentResult?.version||null,readAt:fulfilment.readAt};
  }
  return {project};
});
