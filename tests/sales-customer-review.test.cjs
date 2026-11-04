const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8'),buyer=fs.readFileSync(require('node:path').join(__dirname,'../buyer-room.html'),'utf8');
const line=name=>html.split(/\r?\n/).find(row=>row.startsWith(name));
test('refresh failure preserves customers; identical successful response clears the warning',()=>{
  const notice={hidden:true,textContent:''},list={innerHTML:'SCOMM'},records=[{customerId:'C1'}],fingerprint=JSON.stringify({customers:records,summary:{}});
  const h=vm.createContext({customerRecords:records,customerRenderFingerprint:fingerprint,customerRefreshPending:true,pendingSelectionLimits:new Map(),stabilizeQuoteWork:x=>x,document:{getElementById:id=>id==='customerRefreshStatus'?notice:id==='customerListArea'?list:(()=>{throw Error('Cached dashboard must remain unchanged: '+id)})()}});
  vm.runInContext(line('customerLoadError=function'),h);vm.runInContext(line('function renderCustomers('),h);
  h.customerLoadError('Request failed');assert.equal(list.innerHTML,'SCOMM');assert.equal(h.customerRecords,records);assert.equal(notice.hidden,false);assert.equal(h.customerRefreshPending,false);
  h.renderCustomers({customers:records,summary:{}});assert.equal(notice.hidden,true);assert.equal(list.innerHTML,'SCOMM');assert.equal(h.customerRecords,records);
});
test('review saves PO and shipment using the existing API; failed save preserves values and retry identity',()=>{
  const handlers={},elements=Object.fromEntries(['salesCustomerPo','salesReviewShipment','saveReviewPlanning','cancelReviewPlanning','salesQtyStatus'].map(id=>[id,{value:'',disabled:false,readOnly:false,blur(){},classList:{toggle(){}},checkValidity:()=>true}]));elements.salesCustomerPo.value='PO-OLD';elements.salesReviewShipment.value='2026-10-20';let sent;
  const h=vm.createContext({pendingSalesPoEdit:{orderId:'O1',value:'PO-OLD',date:'2026-10-20',expectedRevision:2,dirty:false,saving:false},pendingSalesQtyEdit:null,salesProgressCustomerId:'',lastSalesQtyFeedback:null,crypto:{randomUUID:()=> 'TEST-ID'},salesQtyBusy(){},document:{getElementById:id=>elements[id],querySelectorAll:()=>[]},window:{parent:{postMessage:message=>sent=message},addEventListener:(type,handler)=>handlers[type]=handler}});
  vm.runInContext(line('function wireSalesReviewPlanning('),h);vm.runInContext(html.split(/\r?\n/).find(row=>row.startsWith("window.addEventListener('message',event=>{const message=event.data||{},pending=pendingSalesPoEdit")),h);
  h.wireSalesReviewPlanning({orderId:'O1'},true);elements.salesCustomerPo.value='PO-NEW';elements.salesReviewShipment.value='2026-10-23';elements.salesCustomerPo.oninput();elements.saveReviewPlanning.onclick();assert.equal(sent.type,'SALES_ROOM_ORDER_PLANNING_UPDATE');assert.equal(sent.expectedRevision,2);assert.equal(sent.estimatedShipmentDate,'2026-10-23');
  handlers.message({source:h.window.parent,data:{type:'SALES_ROOM_ORDER_PLANNING_RESULT',requestId:'TEST-ID',ok:false,error:'Temporary failure'}});assert.equal(elements.salesCustomerPo.value,'PO-NEW');assert.equal(elements.salesReviewShipment.value,'2026-10-23');assert.equal(h.pendingSalesPoEdit.dirty,true);assert.equal(elements.saveReviewPlanning.disabled,false);
  elements.saveReviewPlanning.onclick();assert.equal(sent.requestId,'TEST-ID');
});
test('transferred orders cannot edit planning from Review',()=>{
  const elements=Object.fromEntries(['salesCustomerPo','salesReviewShipment','saveReviewPlanning','cancelReviewPlanning','salesQtyStatus'].map(id=>[id,{value:'',classList:{toggle(){}},checkValidity:()=>true}]));
  const h=vm.createContext({pendingSalesPoEdit:{value:'',date:'',dirty:false},pendingSalesQtyEdit:null,document:{getElementById:id=>elements[id],querySelectorAll:()=>[]},window:{parent:{postMessage:()=>{throw Error('Locked order sent update')}}}});vm.runInContext(line('function wireSalesReviewPlanning('),h);h.wireSalesReviewPlanning({orderId:'LOCKED'},false);elements.salesCustomerPo.value='EDIT';elements.salesCustomerPo.oninput();elements.saveReviewPlanning.onclick();assert.equal(elements.salesCustomerPo.readOnly,true);assert.equal(elements.salesReviewShipment.readOnly,true);assert.equal(elements.saveReviewPlanning.disabled,true);
});
test('Buyer latest active order date is not earliest shipment or an older nonblank date',()=>{
  const h=vm.createContext({state:{orderDetails:{}},Intl,Date,Map});vm.runInContext(buyer.split(/\r?\n/).find(row=>row.startsWith('function latestTrackShipment(')),h);
  const rows=[{order:{orderId:'OLD',confirmedAt:'2026-10-12T12:00:00Z',estimatedShipmentDate:'2026-10-16'}},{order:{orderId:'NEW',confirmedAt:'2026-10-14T12:00:00Z',estimatedShipmentDate:'2026-10-28',revision:2}}];assert.equal(h.latestTrackShipment(rows).date,'28 Oct 2026');rows[1].order.estimatedShipmentDate='';assert.equal(h.latestTrackShipment(rows).date,'—');h.state.orderDetails.NEW={revision:3,estimatedShipmentDate:'2026-10-30'};assert.equal(h.latestTrackShipment(rows).date,'30 Oct 2026');assert.equal(h.latestTrackShipment([]).date,'—');
});
