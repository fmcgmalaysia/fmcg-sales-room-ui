const test = require('node:test'), assert = require('node:assert/strict');
const load = require('./load-master-module.cjs');
const { createNctIntake } = load('nctIntake.js');
const { createPurchaseOperations } = load('purchaseOperations.js');
const { projectPurchaseWorkspace, PURCHASE_COLLECTIONS } = load('purchaseProjection.js');
const { createPurchaseOrderOperations } = load('purchaseOrderWorkflow.js');
const { createWarehouseOperations, projectWarehouseOrders } = load('warehouseReceiving.js');
const { createPlannerAllocationOperations, allocationVersion } = load('plannerAllocation.js');
const { createShortageOperations, shortageVersion } = load('purchaseShortage.js');
const { createAccountSettlementOperations } = load('accountSettlement.js');
const { createCustomerFulfilmentOperations, shipmentVersion } = load('customerFulfilment.js');
const { customerCompletion } = load('customerCompletionProjection.js');
const { applyPurchaseProgress } = load('purchaseProgress.js');
const { projectCustomerAccount } = load('customerDebtor.js');
const { createStockExceptionOperations, stockExceptionVersion } = load('inventoryExceptions.js');
const { createStockResolutionOperations, stockResolutionVersion } = load('stockExceptionResolution.js');
const { createShipmentPlanOperations, shipmentPlanVersion, readShipmentPlans } = load('customerShipmentPlan.js');
const { createPurchaseSourceOperations, purchaseSourcesVersion } = load('purchaseSources.js');
const { projectPurchaseQuantities } = load('purchaseQuantityProjection.js');
const { createQuantityCaseOperations, quantityCasesVersion } = load('purchaseQuantityCases.js');

async function scenario(company = 'NCT', demand = 100, productCount = 1) {
  const rows = new Map(), clone = value => JSON.parse(JSON.stringify(value));
  const store = {
    all: async c => [...rows].filter(([key]) => key.startsWith(c + '/')).map(([, row]) => clone(row)),
    read: async (c, id) => clone(rows.get(c + '/' + id) || null),
    one: async (c, criteria) => (await store.all(c)).find(row => Object.entries(criteria).every(([k,v]) => row[k] === v)) || null,
    insert: async (c, row) => { if (rows.has(c + '/' + row._id)) throw Error('duplicate'); rows.set(c + '/' + row._id, clone(row)); return clone(row); },
    update: async (c, row) => { rows.set(c + '/' + row._id, clone(row)); return clone(row); },
    remove: async (c, id) => rows.delete(c + '/' + id)
  };
  const names = PURCHASE_COLLECTIONS, n = names[company], now = () => new Date('2026-10-12T03:00:00Z');
  let sequence = 0, fileSequence = 0;
  const staff = name => ({ memberId: name, staffId: name, staffName: name, role: name === 'ADMIN' ? 'SUPER ADMIN' : name });
  const request = (who, input) => ({ company, staff: staff(who), requestId: String(++sequence).padStart(8,'0') + '-1111-4111-8111-111111111111', input });
  const documents = async input => input.action === 'ALLOCATE' ? { fileId: 'test-file-' + ++fileSequence } : { ...input, ok: true };
  const pdf = label => Buffer.from('%PDF-1.4\nTEST ONLY ' + label).toString('base64');
  await store.insert('SharedSuppliers', { _id: 'S', title: 'S', companyName: 'TEST SUPPLIER', shortName: 'TEST', supplierStatus: 'ACTIVE' });
  const receive = createNctIntake({ store, now, captureCosts: async barcodes => Object.fromEntries(barcodes.map(unitBarcode => [unitBarcode, { unitBarcode, capturedAt: now().toISOString(), costCurrency: 'MYR', costStatus: 'CAPTURED', costIssues: [], lpPc: 10, lpCtn: 100, disc1: 0, disc2: 0, disc3: 0, netCostCtn: 100, cbmPerCtn: .01 }])) });
  const receipt = await receive({ sourceSiteId: '5292b63a-30e5-4c0e-8762-a1b127bbc651', destination: company, orderId: 'SCENARIO-' + company, customerId: 'C', customerCompanyName: 'TEST CUSTOMER', submissionId: 'SUB-' + company, submittedByStaffId: 'SALES', submittedByStaffName: 'SALES', submittedAt: now().toISOString(), transactionCurrency: 'MYR', fxRate: 1, lines: Array.from({length:productCount},(_,index)=>({sourceLineId:'L'+index,unitBarcode:'00'+(index+1),itemName:['CHOCOLATE BISCUITS','VANILLA BISCUITS','SOFT DRINK'][index],packingSize:'10 x 1',eaPerCtn:10,qtyCtn:demand,sellingPricePc:15})) });
  const id = receipt.taskIds[0];
  const workspace = async () => projectPurchaseWorkspace({ company, orders: await store.all(n.orders), tasks: await store.all(n.tasks), activity: await store.all(n.activity), suppliers: await store.all('SharedSuppliers'), staff: staff('PURCHASE') });
  const task = async () => (await workspace()).tasks.find(row=>row.id===id);
  const purchase = createPurchaseOperations({ store, now });
  await purchase({ ...request('PURCHASE', { edits: (await workspace()).tasks.map(row=>({taskId:row.id,version:row.editVersion,changes:{supplierId:'S'}})) }), operation: 'EDIT' });
  await purchase({ ...request('PURCHASE', { taskIds: receipt.taskIds, versions: Object.fromEntries((await workspace()).tasks.map(row=>[row.id,row.editVersion])), poNumber: company + '-PO-TEST' }), operation: 'PO' });
  const poOps = createPurchaseOrderOperations({ store, readWorkspace: workspace, names, documentService: documents, now });
  const po = async () => (await poOps.list(company, staff('PURCHASE'))).find(row=>row.taskIds.includes(id));
  const upload = async (type, cents) => poOps.save(request('PURCHASE', { id: (await po()).id, version: (await po()).version, action: 'DOCUMENT', type, date: '2026-10-12', number: type + '-TEST', reason: 'Scenario document', base64: pdf(type), ...(cents ? { declaredCents: cents } : {}) }));
  const financeOps = createAccountSettlementOperations({ store, names, listOrders: poOps.list, documentService: documents, now });
  const finance = async input => financeOps.save(request('ACCOUNT', { id: (await po()).id, version: (await po()).version, reason: 'Scenario reconciliation', ...input }));
  const pay = async (cents, number, direction = 'PAYMENT') => finance({ action: 'DOCUMENT_UPLOAD', type: 'PAYMENT', date: '2026-10-12', number, cents, direction, base64: pdf(number) });
  const acknowledge=async paymentId=>{const current=await po(),req=request('PURCHASE',{id:current.id,version:current.version,action:'ACK_PAYMENT',paymentId,reason:'Payment proof received'}),result=await poOps.save(req);assert.deepEqual(await poOps.save(req),result);return result;};
  const warehouseOrders = async () => projectWarehouseOrders({ company, purchaseOrders: await poOps.list(company, staff('WAREHOUSE')), tasks: (await workspace()).tasks, activity: await store.all(n.activity) });
  const warehouseOps = createWarehouseOperations({ store, names, readOrders: warehouseOrders, now });
  const delivery = async (accepted, kind, resolveIssue = false) => warehouseOps.save(request('WAREHOUSE', { action: 'RECEIVE', id: (await po()).id, version: (await warehouseOrders()).find(row=>row.taskIds?.includes(id)||row.lines.some(line=>line.taskId===id)).version, lines: [{ taskId: id, accepted, rejected: 0, kind, resolveIssue, reason: 'Scenario delivery' }] }));
  const allocator = createPlannerAllocationOperations({ store, names, readWorkspace: workspace, now });
  const allocate = async quantity => allocator(request('PURCHASE', { action: 'ALLOCATE', sourceTaskId: id, version: allocationVersion(await workspace(), await store.all(n.activity)), targets: [{ taskId: id, quantity }], reason: 'Allocate actual cartons' }));
  const shortageOps = createShortageOperations({ store, names, readWorkspace: workspace, now });
  const shortage = async (customerDecision, supplierDecision) => decideQuantity((await task()).quantityCases.some(item=>item.kind==='RECEIPT')?'RECEIPT':'UNPLACED',customerDecision,supplierDecision);
  const context = async () => ({ ...await workspace(), activity: await store.all(n.activity), tasks: (await workspace()).tasks.map(row => ({ ...row, sellingPricePc: 15 })) });
  const stockOps=createStockExceptionOperations({store,names,readContext:context,now});
  const quantityCaseOps=createQuantityCaseOperations({store,names,readWorkspace:workspace,now});
  const decideQuantity=async(kind,customerDecision,supplierDecision='PENDING')=>{const current=await workspace(),item=current.tasks.find(row=>row.id===id).quantityCases.find(item=>item.kind===kind);return quantityCaseOps({...request('PURCHASE',{action:'DECIDE',id:item.id,version:quantityCasesVersion(current,await store.all(n.activity)),customerDecision,supplierDecision,expectedDate:'2026-10-15',reason:'Internal supplier finding',customerMessage:'Available quantity confirmed'}),staff:{...staff('PURCHASE'),canDecideQuantityCase:true}});};
  const sourceOps=createPurchaseSourceOperations({store,names,readWorkspace:workspace,now});
  const source=async quantity=>{if(!await store.read('SharedSuppliers','B'))await store.insert('SharedSuppliers',{_id:'B',title:'B',companyName:'SUPPLIER B',shortName:'B',supplierStatus:'ACTIVE'});const req={...request('PURCHASE',{action:'ADD_SOURCE',parentTaskId:id,version:purchaseSourcesVersion(await workspace()),quantity,supplierId:'B',poNumber:company+'-PO-B',prices:{lpPc:12,lpCtn:120,disc1:0,disc2:0,disc3:0},reason:'Find remaining cartons'}),staff:{...staff('PURCHASE'),canAddPurchaseSource:true}};const result=await sourceOps(req);assert.deepEqual(await sourceOps(req),result,'same save must not add a second supplier source');return result.sourceTaskId;};
  const sourceDelivery=async(sourceId,accepted,kind)=>{const order=(await warehouseOrders()).find(po=>po.lines.some(line=>line.taskId===sourceId));return warehouseOps.save(request('WAREHOUSE',{action:'RECEIVE',id:order.id,version:order.version,lines:[{taskId:sourceId,accepted,rejected:0,kind,reason:'Supplier source delivery'}]}));};
  const sourceAllocate=async(sourceId,quantity)=>allocator(request('PURCHASE',{action:'ALLOCATE',sourceTaskId:sourceId,version:allocationVersion(await workspace(),await store.all(n.activity)),targets:[{taskId:id,quantity}],reason:'Allocate supplier source to original demand'}));
  const otherDeliveries=async()=>{for(const taskId of receipt.taskIds.filter(taskId=>taskId!==id)){await sourceDelivery(taskId,demand,'DELIVERY');await allocator(request('PURCHASE',{action:'ALLOCATE',sourceTaskId:taskId,version:allocationVersion(await workspace(),await store.all(n.activity)),targets:[{taskId,quantity:demand}],reason:'Allocate other ordered product'}));}};
  const quarantine=async(quantity,kind)=>stockOps({...request('WAREHOUSE',{action:'QUARANTINE',sourceTaskId:id,version:stockExceptionVersion(await context()),quantity,kind,reason:'Internal stock finding'}),staff:{...staff('WAREHOUSE'),canReportStockException:true}});
  const resolutionOps=createStockResolutionOperations({store,names,readContext:context,listOrders:poOps.list,now});
  const resolve=async(who,input)=>resolutionOps({...request(who,{version:stockResolutionVersion(await context(),await poOps.list(company,staff(who))),reason:'Stock resolution scenario',...input}),staff:{...staff(who),canReportStockException:who==='WAREHOUSE',canPlanStockResolution:who==='PURCHASE',canApproveStockLoss:who==='ADMIN',canCloseStockException:who==='ACCOUNT'}});
  const plan=async totalCtn=>purchase({...request('PURCHASE',{taskId:id,version:(await task()).editVersion,planRevision:(await task()).procurement.revision,totalCtn,supplierConfirmed:true,reason:'Supplier confirmed available cartons'}),operation:'PLAN'});
  const fulfilment = createCustomerFulfilmentOperations({ store, names, readContext: context, readRates: async () => [{ currency: 'MYR', rateToMyr: 1 }], now });
  const planOps=createShipmentPlanOperations({store,names,readContext:context,now});
  const split=async quantities=>planOps({...request('SALES',{action:'PLAN',customerId:'C',orderId:(await task()).orderId,version:shipmentPlanVersion(await context()),reason:'Customer requested split shipment',batches:quantities.map((quantity,index)=>({label:'Shipment '+(index+1),lines:[{taskId:id,quantity}]}))}),staff:{...staff('SALES'),customerId:'C',canSelectShipment:true}});
  const shipAction = async (who, input) => { const r = request(who, { version: shipmentVersion(await context()), reason: 'Scenario shipment', ...input }); r.staff = { ...r.staff, canSelectShipment: who === 'SALES', canInvoiceShipment: who === 'SUPPORT', canDispatchShipment: who === 'WAREHOUSE' }; return fulfilment(r); };
  const invoice = async quantity => { const selected = await shipAction('SALES', { action: 'SELECT', customerId: 'C', lines: [{ taskId: id, quantity }] }); await shipAction('SUPPORT', { action: 'INVOICE', id: selected.shipmentId, number: 'SI-' + sequence, date: '2026-10-12', amountCents: quantity * 15000 }); return selected.shipmentId; };
  const dispatch = async shipmentId => shipAction('WAREHOUSE', { action: 'DISPATCH', id: shipmentId, reference: 'TEST-CONTAINER' });
  const amounts = async () => finance({ action: 'AMOUNTS', amounts: (await po()).documents.filter(doc => ['INV','CN'].includes(doc.type)).map(doc => ({ fileId: doc.fileId, cents: doc.declaredCents, ...(doc.type === 'CN' ? { treatment: 'DEDUCT' } : {}) })) });
  const claim=async cents=>{const current=await po(),item=current.quantityCases.find(item=>item.quantity>0),cn=current.documents.find(doc=>doc.type==='CN'),refund=current.finance.payments.find(payment=>payment.direction==='REFUND');return finance({action:'SHORTAGE_CLAIM',caseId:item.id,signature:item.signature,quantity:item.quantity,outcome:item.decision.supplierDecision,cents,cnAllocations:[{fileId:cn.fileId,cents}],refundAllocations:refund?[{paymentId:refund.id,cents}]:[]});};
  const completion = async () => customerCompletion(id, await store.all(n.activity), await poOps.list(company, staff('ACCOUNT')));
  const progress=async()=>applyPurchaseProgress(await workspace(),await store.all(n.activity),await poOps.list(company,staff('PURCHASE'))).tasks;
  return { store, names: n, company, id, task, po, upload, finance, pay, acknowledge, delivery, allocate, shortage, invoice, dispatch, amounts, claim, completion, context, quarantine, plan, resolve, split, source, sourceDelivery, sourceAllocate, otherDeliveries, decideQuantity, progress, allPos:()=>poOps.list(company,staff('PURCHASE')) };
}

test('payment handoff records paper review, partial payments and per-proof acknowledgement without financial clearance',async()=>{
 const f=await scenario();await f.upload('PI');
 await f.finance({action:'PAYMENT_REVIEW',stage:'RECEIVED',paperReceived:true,requestedCents:1000000});assert.equal((await f.po()).paymentHandoff.status,'RECEIVED');
 await f.finance({action:'PAYMENT_REVIEW',stage:'REVIEWING',paperReceived:true,requestedCents:1000000});assert.equal((await f.po()).paymentHandoff.review.by,'ACCOUNT');
 await f.pay(300000,'FIRST-PAY');let current=await f.po();assert.equal(current.paymentHandoff.status,'PARTLY_PAID');assert.equal(current.paymentHandoff.unreadCount,1);assert.equal(current.invoiceChecked,false);
 await f.acknowledge(current.paymentHandoff.notices[0].paymentId);current=await f.po();assert.equal(current.paymentHandoff.unreadCount,0);assert.equal(current.paymentHandoff.notices[0].acknowledgement.by,'PURCHASE');assert.equal(current.finance.paidCents,300000);assert.equal(current.invoiceChecked,false);
 await f.pay(700000,'SECOND-PAY');current=await f.po();assert.equal(current.paymentHandoff.status,'PAID');assert.equal(current.paymentHandoff.unreadCount,1);assert.equal(current.finance.paymentCompleted,false,'paid PI is not final invoice reconciliation');
 await f.upload('INV',1000000);current=await f.po();assert.equal(current.paymentHandoff.reviewStale,true);assert.equal(current.paymentHandoff.review,null);
});

test('A180+B10: stopping unplaced ten never clears later short-receipt ten or publishes internal notes',async()=>{
 const f=await scenario('NCT',200);await f.plan(180);const sourceId=await f.source(10);await f.decideQuantity('UNPLACED','STOP');
 assert.equal((await f.task()).shortage.customerDecision,'STOP');assert.equal((await f.task()).shortage.financeRequired,false);
 await f.pay(1800000,'PREPAY-A');await f.delivery(170,'SHORT');await f.allocate(170);await f.sourceDelivery(sourceId,10,'DELIVERY');await f.sourceAllocate(sourceId,10);
 let row=await f.task();assert.equal(row.quantityCases.length,2);assert.equal(row.quantityCases.find(item=>item.kind==='UNPLACED').status,'RESOLVED');assert.equal(row.quantityCases.find(item=>item.kind==='RECEIPT').quantity,10);assert.equal(row.shortage.customerDecision,'PENDING');assert.equal((await f.po()).financialRisk,true);
 await f.decideQuantity('RECEIPT','STOP','REFUND');
 const workspace=await f.context(),requests=[{orderId:row.orderId,submissionId:'SUB-NCT'}];
 const customer=projectPurchaseQuantities({customerId:'C',requests,workspace,orders:await f.store.all(f.names.orders),tasks:await f.store.all(f.names.tasks),activity:workspace.activity,purchaseOrders:await f.allPos()});
 assert.equal(customer.orders[0].lines[0].committedQtyCtn,200);assert.equal(customer.orders[0].lines[0].receivedQtyCtn,180);assert.equal(customer.orders[0].lines[0].fulfilment.decision,'STOP');assert.doesNotMatch(JSON.stringify(customer),/Internal supplier finding|REFUND|SUPPLIER B/);
 await f.upload('INV',1800000);await f.upload('DO');await f.upload('CN',100000);await f.amounts();await assert.rejects(f.finance({action:'CHECK',enabled:true}),/overpayment|shortage/);
 await f.pay(100000,'REFUND-A','REFUND');await f.claim(100000);await f.finance({action:'CHECK',enabled:true});assert.equal((await f.po()).invoiceChecked,true);assert.equal((await f.task()).ord,200);
});

for (const company of ['NCT','GHR']) test(company + ': prepay in two instalments, receive in two deliveries, allocate, invoice, dispatch and close', async () => {
  const f = await scenario(company);
  await f.upload('PI'); await f.pay(300000, 'PAY-1');
  assert.equal((await f.po()).creditorActive, true); assert.equal((await f.po()).prepaymentPending, true);
  await f.pay(700000, 'PAY-2'); await f.delivery(60, 'PARTIAL');
  assert.equal((await f.task()).inc, 0, 'warehouse receipt waits for planner allocation');
  await f.allocate(60); assert.equal((await f.task()).inc, 60); assert.equal((await f.task()).ord, 100);
  await f.delivery(40, 'DELIVERY'); await f.allocate(100);
  await f.upload('INV', 1000000); await f.upload('DO'); await f.amounts();
  assert.notEqual((await f.po()).documentStatus, 'COMPLETE');
  await f.finance({ action: 'CN_NOT_APPLICABLE', enabled: true }); await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.po()).documentStatus, 'COMPLETE'); assert.equal((await f.po()).state, 'ACTIVE');
  const shipment = await f.invoice(100); assert.equal((await f.completion()).completedQty, 0);
  assert.equal((await f.progress())[0].stage,'WAITING_FOR_SHIPMENT');assert.equal((await f.progress())[0].archived,false);
  await f.dispatch(shipment); assert.equal((await f.completion()).completedQty, 100);
  assert.equal((await f.po()).state, 'HISTORY'); assert.equal((await f.po()).creditorActive, false);
  assert.equal((await f.progress())[0].stage,'SHIPPED');assert.equal((await f.progress())[0].archived,true);
  assert.equal(projectCustomerAccount(await f.context()).balances[0].balanceCents, 1500000);
});

test('100 prepaid / 90 received: stop waiting never clears liability; CN and actual refund need Finance Checked', async () => {
  const f = await scenario(); await f.upload('PI'); await f.pay(1000000, 'PREPAY');
  await f.delivery(90, 'SHORT'); await f.allocate(90); await f.shortage('STOP', 'REFUND');
  assert.equal((await f.task()).ord, 100); assert.equal((await f.po()).financialRisk, true);
  await f.upload('INV', 1000000); await f.upload('DO'); await f.upload('CN', 100000); await f.amounts();
  await assert.rejects(f.finance({ action: 'CHECK', enabled: true }), /overpayment|shortage/);
  const shipment = await f.invoice(90); await f.dispatch(shipment);
  assert.equal((await f.completion()).completedQty, 0, 'dispatch does not hide unresolved supplier loss');
  await f.pay(100000, 'REFUND', 'REFUND'); assert.equal((await f.po()).financialRisk, true);
  await assert.rejects(f.finance({action:'CHECK',enabled:true}),/Reconcile each/);await f.claim(100000);
  await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.po()).financialRisk, false); assert.equal((await f.po()).state, 'HISTORY');
  assert.equal((await f.completion()).completedQty, 90); assert.equal((await f.task()).ord, 100);
});

test('short first delivery and later replacement preserve the first partial invoice and clear risk only after reconciliation', async () => {
  const f = await scenario(); await f.pay(1000000, 'PREPAY');
  await f.delivery(90, 'SHORT'); await f.allocate(90); await f.shortage('WAIT', 'REPLENISH');
  const first = await f.invoice(90); await f.dispatch(first);
  assert.equal((await f.po()).financialRisk, true); assert.equal((await f.task()).ord, 100);
  await f.delivery(10, 'DELIVERY', true); await f.allocate(100);
  assert.equal((await f.task()).inc, 100); assert.equal((await f.po()).financialRisk, true);
  const second = await f.invoice(10); await f.dispatch(second);
  await f.upload('INV', 1000000); await f.upload('DO'); await f.amounts();
  await f.finance({ action: 'CN_NOT_APPLICABLE', enabled: true }); await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.completion()).completedQty, 100); assert.equal((await f.completion()).invoices.length, 2);
  assert.equal((await f.po()).state, 'HISTORY'); assert.equal((await f.po()).financialRisk, false);
});

test('credit-term supplier does not block customer dispatch but remains active until final payment', async () => {
  const f = await scenario(); await f.delivery(100, 'DELIVERY'); await f.allocate(100);
  await f.upload('INV', 1000000); await f.upload('DO'); await f.amounts();
  await f.finance({ action: 'CN_NOT_APPLICABLE', enabled: true }); await f.finance({ action: 'CHECK', enabled: true });
  const shipment = await f.invoice(100); await f.dispatch(shipment);
  assert.equal((await f.completion()).dispatchedQty, 100); assert.equal((await f.completion()).completedQty, 0);
  assert.equal((await f.po()).state, 'ACTIVE'); assert.equal((await f.po()).creditorActive, true);
  assert.equal((await f.progress())[0].stage,'WAITING_FOR_PAYMENT');assert.equal((await f.progress())[0].archived,false);
  await f.pay(1000000, 'TERM-PAYMENT');
  assert.equal((await f.po()).invoiceChecked, false, 'changed financial record requires final recheck');
  assert.equal((await f.progress())[0].stage,'WAITING_FOR_ACC_REVIEW');
  await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.completion()).completedQty, 100); assert.equal((await f.po()).state, 'HISTORY');
});

test('CN kept for next purchase remains a supplier credit and never becomes customer Debtor credit', async () => {
  const f = await scenario(); await f.pay(1000000, 'PREPAY'); await f.delivery(90, 'SHORT');
  await f.allocate(90); await f.shortage('STOP', 'CREDIT');
  await f.upload('INV', 1000000); await f.upload('DO'); await f.upload('CN', 100000); await f.amounts();
  await f.claim(100000);await f.finance({ action: 'RECOGNIZE_CREDIT', cents: 100000 }); assert.equal((await f.po()).financialRisk, true);
  await f.finance({ action: 'CHECK', enabled: true });
  assert.equal((await f.po()).finance.supplierCreditCents, 100000);
  assert.equal(projectCustomerAccount(await f.context()).entries.length, 0);
  const shipment = await f.invoice(90); await f.dispatch(shipment);
  assert.equal((await f.po()).state, 'HISTORY'); assert.equal((await f.po()).finance.supplierCreditCents, 100000);
  assert.equal(projectCustomerAccount(await f.context()).balances[0].balanceCents, 1350000);
});

test('500 requested / 480 received / 300 shipped: quarantine 5 + 3 + 2 blocks 180 and permits planner-confirmed 170', async () => {
  const f=await scenario('NCT',500);await f.split([300,200]);
  assert.equal(projectCustomerAccount(await f.context()).entries.length,0,'split intent does not create an invoice or receivable');
  assert.equal((await f.task()).inc,null,'split intent cannot create received or allocated stock');
  await assert.rejects(f.split([300,170]),/original customer quantity/);
  await f.plan(480);await f.pay(4800000,'PREPAY');
  await f.delivery(480,'DELIVERY');await f.allocate(480);
  const first=await f.invoice(300);await f.dispatch(first);
  await f.quarantine(5,'INTERNAL_DAMAGE');await f.quarantine(3,'WRONG_ITEM');await f.quarantine(2,'SHORT_EXPIRY');
  let row=await f.task();assert.equal(row.ord,500);assert.equal(row.warehouse.accepted,480);
  assert.equal(row.warehouse.stock.held,10);assert.equal(row.warehouse.stock.shipped,300);assert.equal(row.warehouse.stock.availablePhysical,170);
  assert.deepEqual(Array.from(row.warehouse.stock.cases,item=>item.owner),['ADMIN','PURCHASE','PURCHASE']);
  await assert.rejects(f.invoice(180),/Available stock changed/);
  await assert.rejects(f.allocate(480),/quarantined stock/);
  await f.allocate(470);await f.shortage('STOP','PENDING',false);const second=await f.invoice(170);await f.dispatch(second);
  row=await f.task();assert.equal(row.ord,500);assert.equal(row.inc,470);assert.equal(row.warehouse.accepted,480);
  assert.equal((await f.completion()).dispatchedQty,470);assert.equal((await f.po()).financialRisk,true);
  await f.upload('INV',4800000);await f.upload('DO');await f.amounts();await f.finance({action:'CN_NOT_APPLICABLE',enabled:true});
  await assert.rejects(f.finance({action:'CHECK',enabled:true}),/quarantined stock/);
  assert.equal((await f.po()).state,'ACTIVE');
  const [damage,wrong,expiry]=(await f.task()).warehouse.stock.cases;
  await assert.rejects(f.resolve('ACCOUNT',{action:'CLOSE',id:damage.id,outcome:'LOSS',cents:50000}),/Super Admin/);
  await f.resolve('ADMIN',{action:'APPROVE_LOSS',id:damage.id});
  await f.resolve('ACCOUNT',{action:'CLOSE',id:damage.id,outcome:'LOSS',cents:50000});
  for(const item of [wrong,expiry]){
    await f.resolve('PURCHASE',{action:'DECIDE',id:item.id,decision:'REFUND',disposition:'RETURN',supplierReference:'Supplier accepted claim'});
    await f.resolve('WAREHOUSE',{action:'RETURN',id:item.id,quantity:item.quantity,reference:'RETURN-'+item.kind});
  }
  await f.upload('CN',50000);await f.amounts();await f.pay(50000,'CLAIM-REFUND','REFUND');
  const po=await f.po(),cn=po.documents.find(doc=>doc.type==='CN'),refund=po.finance.payments.find(row=>row.direction==='REFUND');
  for(const item of [wrong,expiry])await f.resolve('ACCOUNT',{action:'CLOSE',id:item.id,outcome:'REFUND',cents:item.quantity*10000,cnAllocations:[{fileId:cn.fileId,cents:item.quantity*10000}],refundAllocations:[{paymentId:refund.id,cents:item.quantity*10000}]});
  assert.equal((await f.po()).financialRisk,false,'no unresolved stock claims remain, final Checked still required');
  await f.finance({action:'CHECK',enabled:true});
  assert.equal((await f.po()).state,'HISTORY');assert.equal((await f.po()).finance.stockLossCents,50000);
  assert.equal((await f.po()).finance.payableCents,4750000);assert.equal((await f.po()).finance.paidCents,4750000);
  assert.equal((await f.completion()).completedQty,470);assert.equal((await f.task()).warehouse.accepted,480);
  assert.deepEqual(Array.from(readShipmentPlans((await f.context()).activity)[0].batches,batch=>batch.lines[0].quantity),[300,200],'actual 300+170 dispatch preserves original split intent');
});

test('supplier replacement received in two batches restores usable stock without rewriting the original receipt', async () => {
  const f=await scenario();await f.delivery(100,'DELIVERY');await f.allocate(100);await f.quarantine(5,'WRONG_ITEM');
  const item=(await f.task()).warehouse.stock.cases[0];
  await assert.rejects(f.resolve('WAREHOUSE',{action:'DECIDE',id:item.id,decision:'REPLACE'}),/not authorized/);
  await f.resolve('PURCHASE',{action:'DECIDE',id:item.id,decision:'REPLACE',disposition:'RETURN',supplierReference:'Supplier exchange',expectedDate:'2026-10-15'});
  await f.resolve('WAREHOUSE',{action:'RETURN',id:item.id,quantity:5,reference:'RETURN-5'});
  await f.resolve('WAREHOUSE',{action:'REPLACEMENT',id:item.id,quantity:3,reference:'REPLACE-3',acceptedGood:true});
  assert.equal((await f.task()).warehouse.stock.usableReceived,98);
  await assert.rejects(f.resolve('ACCOUNT',{action:'CLOSE',id:item.id,outcome:'REPLACED',noExtraCharge:true}),/complete good replacement/);
  await f.resolve('WAREHOUSE',{action:'REPLACEMENT',id:item.id,quantity:2,reference:'REPLACE-2',acceptedGood:true});
  await f.resolve('ACCOUNT',{action:'CLOSE',id:item.id,outcome:'REPLACED',noExtraCharge:true});
  const stock=(await f.task()).warehouse.stock;
  assert.equal(stock.received,100);assert.equal(stock.replacementReceived,5);assert.equal(stock.usableReceived,100);
  assert.equal(stock.cases[0].status,'RESOLVED');
  await assert.rejects(f.resolve('WAREHOUSE',{action:'REPLACEMENT',id:item.id,quantity:1,reference:'EXTRA',acceptedGood:true}),/Resolved stock/);
});

test('a supplier refund below lost stock cost stays red until Admin approves the unrecovered difference', async () => {
  const f=await scenario();await f.pay(1000000,'PREPAY');await f.delivery(100,'DELIVERY');await f.quarantine(5,'SHORT_EXPIRY');
  const item=(await f.task()).warehouse.stock.cases[0];
  await f.resolve('PURCHASE',{action:'DECIDE',id:item.id,decision:'REFUND',disposition:'SUPPLIER_NO_RETURN',supplierReference:'Supplier accepts RM400 only'});
  await f.upload('INV',1000000);await f.upload('DO');await f.upload('CN',40000);await f.amounts();await f.pay(40000,'REFUND','REFUND');
  const po=await f.po(),cn=po.documents.find(doc=>doc.type==='CN'),refund=po.finance.payments.find(row=>row.direction==='REFUND');
  const close={action:'CLOSE',id:item.id,outcome:'REFUND',cents:40000,cnAllocations:[{fileId:cn.fileId,cents:40000}],refundAllocations:[{paymentId:refund.id,cents:40000}]};
  await assert.rejects(f.resolve('ACCOUNT',close),/shortfall requires separate Super Admin/);
  assert.equal((await f.po()).financialRisk,true);
  await f.resolve('ADMIN',{action:'APPROVE_VARIANCE',id:item.id,cents:10000});
  await f.resolve('ACCOUNT',close);
  assert.equal((await f.po()).finance.stockLossCents,10000);
  assert.equal((await f.task()).warehouse.stock.usableReceived,95);
});

test('releasing an incorrect quarantine blocks supplier replacement from creating extra usable stock', async () => {
  const f=await scenario();await f.delivery(100,'DELIVERY');await f.quarantine(5,'WRONG_ITEM');
  const item=(await f.task()).warehouse.stock.cases[0];
  await f.resolve('PURCHASE',{action:'DECIDE',id:item.id,decision:'REPLACE',disposition:'RETURN',supplierReference:'Reviewing exchange',expectedDate:'2026-10-15'});
  await f.resolve('ADMIN',{action:'APPROVE_RELEASE',id:item.id});
  await assert.rejects(f.resolve('WAREHOUSE',{action:'REPLACEMENT',id:item.id,quantity:5,reference:'BAD-REPLACE',acceptedGood:true}),/release is awaiting/);
  await assert.rejects(f.resolve('PURCHASE',{action:'DECIDE',id:item.id,decision:'REFUND'}),/release is awaiting/);
  await f.resolve('ACCOUNT',{action:'CLOSE',id:item.id,outcome:'RELEASED'});
  assert.equal((await f.task()).warehouse.stock.usableReceived,100);
  assert.equal((await f.task()).warehouse.stock.replacementReceived,0);
});
test('awaiting supplier response records a persistent stock issue without inventing return instructions',async()=>{
 const f=await scenario();await f.delivery(100,'DELIVERY');await f.quarantine(3,'WRONG_ITEM');const item=(await f.task()).warehouse.stock.cases[0];
 await f.resolve('PURCHASE',{action:'DECIDE',id:item.id,decision:'PENDING'});
 const saved=(await f.task()).warehouse.stock.cases[0];assert.equal(saved.owner,'PURCHASE');assert.equal(saved.status,'OPEN');assert.equal(saved.resolution.decision.disposition,null);assert.equal((await f.task()).warehouse.stock.usableReceived,97);
 await assert.rejects(f.resolve('ACCOUNT',{action:'CLOSE',id:item.id,outcome:'REPLACED',noExtraCharge:true}),/match Purchase/);
});

test('Sales split revisions retain audit history and do not grant Support or another customer planning rights', async () => {
 const f=await scenario('GHR',500);await f.split([300,200]);await f.split([250,250]);
 const context=await f.context(),events=context.activity.filter(row=>row.action==='CUSTOMER_SHIPMENT_PLAN_SAVED');
 assert.equal(events.length,2);assert.equal(readShipmentPlans(context.activity).length,1);
 assert.deepEqual(Array.from(events[0].details.plan.batches,batch=>batch.lines[0].quantity),[300,200]);
 assert.deepEqual(Array.from(readShipmentPlans(context.activity)[0].batches,batch=>batch.lines[0].quantity),[250,250]);
 const operate=createShipmentPlanOperations({store:f.store,names:{GHR:f.names},readContext:f.context});
 const input={action:'PLAN',customerId:'C',orderId:(await f.task()).orderId,version:shipmentPlanVersion(context),reason:'Planning',batches:events[0].details.plan.batches};
 await assert.rejects(operate({company:'GHR',staff:{canSelectShipment:false},input}),/Only authorized Sales/);
 await assert.rejects(operate({company:'GHR',staff:{canSelectShipment:true,staffId:'OTHER',staffName:'OTHER',memberId:'OTHER',customerId:'OTHER'},requestId:'11111111-2222-4333-8444-555555555555',input}),/customer is not authorized/);
 assert.equal((await f.task()).ord,500);assert.equal((await f.task()).inc,null);
});

for(const company of ['NCT','GHR'])test(company+': demand 200 stays one customer line across A180+B10, A170 received then B10, and independent source costs',async()=>{
 const f=await scenario(company,200,3);await f.plan(180);
 await assert.rejects(f.source(21),/exceed customer demand/);
 const b=await f.source(10),before=await f.task();
 assert.equal(before.ord,200);assert.equal(before.sourcing.orderedCtn,190);assert.equal(before.sourcing.unplacedCtn,10);
 const context=await f.context();assert.equal(context.tasks.length,4);assert.equal(context.tasks.reduce((sum,row)=>sum+row.ord,0),600);
 assert.equal(context.tasks.find(row=>row.id===b).requested,0);
 assert.equal((await f.allPos()).length,2);assert.equal((await f.po()).amount,58000);
 assert.equal((await f.allPos()).find(po=>po.taskIds.includes(b)).amount,1200);
 await f.delivery(170,'SHORT');await f.allocate(170);
 await f.otherDeliveries();
 assert.equal((await f.task()).sourcing.receivedCtn,170);assert.equal((await f.task()).inc,170);
 await f.sourceDelivery(b,10,'DELIVERY');await f.sourceAllocate(b,10);
 assert.equal((await f.task()).sourcing.receivedCtn,180);assert.equal((await f.task()).inc,180);assert.equal((await f.task()).ord,200);
 const order=(await f.store.all(f.names.orders))[0],payload=projectPurchaseQuantities({customerId:'C',requests:[{orderId:order.title,submissionId:order.submissionId}],orders:await f.store.all(f.names.orders),tasks:await f.store.all(f.names.tasks),activity:(await f.context()).activity,purchaseOrders:await f.allPos()});
 assert.equal(JSON.stringify(payload).includes('SUPPLIER B'),false,'customer projection excludes supplier internals');
 assert.equal(payload.orders[0].lines.length,3);assert.equal(payload.orders[0].lines.reduce((sum,row)=>sum+row.committedQtyCtn,0),600);assert.equal(payload.orders[0].lines.reduce((sum,row)=>sum+row.receivedQtyCtn,0),580);
 const shipment=await f.invoice(180);await f.dispatch(shipment);
 const activity=(await f.context()).activity;
 const fulfilment=load('customerShipmentLedger.js').readCustomerShipments(activity)[0];
 assert.equal(fulfilment.lines[0].costSources.reduce((sum,row)=>sum+row.quantity*row.netCostCtn,0),18200);
 assert.equal((await f.po()).warehouse.receivedCtn,570);
 assert.equal((await f.allPos()).find(po=>po.taskIds.includes(b)).warehouse.receivedCtn,10);
});
