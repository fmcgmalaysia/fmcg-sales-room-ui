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
