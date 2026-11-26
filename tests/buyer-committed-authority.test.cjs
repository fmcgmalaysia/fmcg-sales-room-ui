const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../buyer-room.html'),'utf8');
function ui(lines){
 const c=vm.createContext({state:{orders:[{orderId:'O',invoiceNo:'OLD-SI',lines}],orderDetails:{O:{lines}},my:[],removed:[]},window:{},num:v=>Number(v)||0,bySelectionOrder:v=>v,post:()=>assert.fail('No read from display'),Number,Math,Map,Set});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../master-shared/shipment-batches.js'),'utf8'),c);
 for(const name of ['completedLineQty','committedLineQty','effectiveRequestedQty','orderInvoiceNo','stageForLine','orderLines','allTrackingRows','trackingCommittedQty'])vm.runInContext(html.split(/\r?\n/).find(row=>row.startsWith('function '+name+'(')),c);
 return c;
}
test('received 190 and committed 200 displays committed 200 in amount and CBM basis',()=>{
 const c=ui([{lineId:'L',quantityCtn:200,committedQtyCtn:200,receivedQtyCtn:190}]),rows=c.allTrackingRows();
 assert.equal(rows.length,1);assert.equal(c.trackingCommittedQty(rows[0]),200);
 assert.equal(c.trackingCommittedQty(rows[0])*10,2000);
 assert.equal(c.trackingCommittedQty(rows[0])*.02,4);
});
test('a prior SI does not hide 30 cartons awaiting a new Desk',()=>{
 const c=ui([{lineId:'L',quantityContract:2,quantityCtn:200,effectiveRequestedQtyCtn:200,committedQtyCtn:170,uncommittedQtyCtn:30,loadedInvoicedQtyCtn:170,deskCommitments:[],invoiceNo:'OLD-SI'}]);
 const rows=c.allTrackingRows();assert.equal(rows.length,1);assert.equal(rows[0].activeQty,30);assert.equal(c.trackingCommittedQty(rows[0]),0);
});
test('confirmed zero stays zero; unknown commitment stays unknown despite received stock',()=>{
 const c=ui([]);
 assert.equal(c.trackingCommittedQty({line:{committedQtyCtn:0,receivedQtyCtn:100}}),0);
 assert.equal(c.trackingCommittedQty({line:{receivedQtyCtn:100}}),null);
});
test('remaining split rows use their own confirmed allocation and retain unarranged demand',()=>{
 const c=ui([{lineId:'L',quantityContract:2,quantityCtn:200,committedQtyCtn:170,uncommittedQtyCtn:30,loadedInvoicedQtyCtn:100,deskCommitments:[{desk:1,quantity:170,loaded:100}],masterCompletedInvoices:[{desk:1,loadedInvoicedQty:100}],deskPhysical:[{desk:1,receivedQtyCtn:160}]}]);
 const rows=c.allTrackingRows();assert.equal(rows.length,2);assert.deepEqual(Array.from(rows,row=>c.trackingCommittedQty(row)),[70,0]);assert.deepEqual(Array.from(rows,row=>row.activeQty),[70,30]);
});
test('fully invoiced or explicitly closed quantities leave the active list',()=>{
 const c=ui([{lineId:'L',quantityCtn:200,committedQtyCtn:190,loadedInvoicedQtyCtn:190,closedUnfulfilledQtyCtn:10}]);
 assert.equal(c.allTrackingRows().length,0);
});

test('shortfall updates the same Buyer row and its quantity, value and CBM totals together',()=>{
 const line={lineId:'L',quantityCtn:50,lockedPriceCtn:25.2,cbmPerCtn:.0169,committedQtyCtn:50,customerShipment:{currentQtyCtn:30,confirmedQtyCtn:0,pendingQtyCtn:20}};
 const c=ui([line]),nodes=new Map();
 Object.assign(c,{$:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)},document:{querySelectorAll:()=>[]},esc:String,money:value=>value.toFixed(2),cbmText:value=>value.toFixed(4),totalCbm:(rows,qty,cbm)=>rows.reduce((sum,row)=>sum+qty(row)*cbm(row),0),latestTrackShipment:()=>({date:'—'}),renderTrackingRail:()=>{},trackingLineHtml:()=>'',bindImagePreview:()=>{}});
 vm.runInContext(html.split(/\r?\n/).find(row=>row.startsWith('function renderTrackOrders(')),c);
 const totals=()=>['trackCommittedQty','trackCommittedValue','trackCommittedCbm'].map(id=>nodes.get(id).textContent);
 assert.equal(c.allTrackingRows()[0].requested,50);
 c.renderTrackOrders();assert.deepEqual(totals(),['0 Ctn','USD 0.00','0.0000 m³']);
 line.committedQtyCtn=30;line.customerShipment.confirmedQtyCtn=30;
 c.renderTrackOrders();assert.deepEqual(totals(),['30 Ctn','USD 756.00','0.5070 m³']);
 assert.equal(c.allTrackingRows().length,1);
});

test('the live Buyer entry marks a fully loaded current shipment while its balance stays unarranged',()=>{
 const live=fs.readFileSync(path.join(__dirname,'../buyer-room-20261125-company-entry.html'),'utf8');
 const line={lineId:'L',quantityCtn:2,committedQtyCtn:1,receivedQtyCtn:1,loadedQtyCtn:1,
  customerShipment:{currentQtyCtn:1,confirmedQtyCtn:1,pendingQtyCtn:1}};
 const c=ui([line]);
 c.esc=String;
 vm.runInContext(live.slice(live.indexOf('function currentShipmentLoaded('),live.indexOf('function requestTimestamp(')),c);
 vm.runInContext(live.slice(live.indexOf('function shortfallShipmentHtml('),live.indexOf('function customerFulfilmentHtml(')),c);
 vm.runInContext(live.split(/\r?\n/).find(row=>row.startsWith('function trackingDots(')),c);
 const before=JSON.stringify(line);
 const [row]=c.allTrackingRows();
 assert.deepEqual([row.requested,c.trackingCommittedQty(row),row.stage],[2,1,6]);
 assert.match(c.shortfallShipmentHtml(line),/This shipment: 1 CTN · Loaded.*1 CTN awaiting arrangement/);
 assert.match(c.trackingDots(row.order,line,row.stage),/aria-label="Loaded · Completed"/);
 assert.equal(JSON.stringify(line),before);

 line.loadedQtyCtn=0;
 assert.equal(c.allTrackingRows()[0].stage,4);
 assert.match(c.shortfallShipmentHtml(line),/This shipment: 1 CTN · Confirmed/);
 line.loadedQtyCtn=1;
 line.customerShipment.confirmedQtyCtn=0;
 assert.equal(c.allTrackingRows()[0].stage,4);
 assert.match(c.shortfallShipmentHtml(line),/Awaiting confirmation/);
 Object.assign(line,{quantityCtn:3,committedQtyCtn:2});
 Object.assign(line.customerShipment,{currentQtyCtn:2,confirmedQtyCtn:2});
 assert.equal(c.allTrackingRows()[0].stage,4);
 assert.doesNotMatch(c.shortfallShipmentHtml(line),/· Loaded/);
});
