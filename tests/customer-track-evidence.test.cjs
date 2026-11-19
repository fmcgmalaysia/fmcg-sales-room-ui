const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const ctx=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(path.join(root,'master-shared/shipment-batches.js'),'utf8'),ctx);
for(const [file,name] of [['index.html','salesProgressStage'],['buyer-room.html','stageForLine']]){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 vm.runInContext(html.split(/\r?\n/).find(s=>s.startsWith('function '+name+'(')),ctx);
}
function check(order,line,stage){
 assert.equal(ctx.salesProgressStage(order,line),stage);
 assert.equal(ctx.stageForLine(order,line),stage+1);
}
test('both rooms use the same five operational stages; Buyer retains its order receipt',()=>{
 for(const [order,fields,stage] of [[{},{status:'SHIPPED',packedAt:'old'},0],[{masterReceipt:{submissionId:'S'}},{},1],[{},{purchaseStarted:true},2],[{},{receivedQtyCtn:90},3],[{},{readyToLoad:true},4],[{},{loadedQtyCtn:100},5]])check(order,{quantityCtn:100,...fields},stage);
});
test('one Desk cannot inherit another Desk’s loaded quantity or release',()=>{
 const line={quantityContract:2,committedQtyCtn:100,deskCommitments:[{id:'A',desk:1,quantity:80,loaded:80},{id:'B',desk:2,quantity:20,loaded:0}],uncommittedQtyCtn:10,deskReadiness:[{desk:1,remaining:0,ready:false},{desk:2,remaining:20,ready:false}],purchaseStarted:true,readyToLoad:true,loadedQtyCtn:80};
 const [first,second,unassigned]=ctx.window.customerShipmentBatches.lines(line);
 check({},first,5);check({},second,2);check({},unassigned,2);
 line.deskReadiness[1].ready=true;check({},ctx.window.customerShipmentBatches.lines(line)[1],4);
});
test('old invoiced cartons cannot complete a later batch in the same Desk',()=>{
 const line={quantityCtn:105,loadedInvoicedQtyCtn:100,loadedQtyCtn:100,receivedQtyCtn:105};
 check({},line,3);check({},{...line,loadedQtyCtn:105},5);
});
