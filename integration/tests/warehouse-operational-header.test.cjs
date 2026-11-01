const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),load=require('./load-master-module.cjs');
const view=load('warehouseDeliveryView.js'),release=require('../prototypes/warehouse-operational-header-20261031/stage.cjs').plan();
test('Warehouse read and saved receipt omit customer PO while preserving current ETD and gate time',()=>{
 const input={id:'L',company:'NCT',desk:{number:1,references:{poNo:'CUSTOMER-PO',soNo:'SO-1'},shipment:{date:'2026-11-01',lastGateIn:'2026-10-31T16:00'}},currentDesk:{references:{poNo:'NEW-CUSTOMER-PO'},shipment:{date:'2026-11-03',lastGateIn:'2026-11-02T18:30'}},lines:[]},original=JSON.stringify(input);
 for(const result of [view.projectWarehouseDeliveryList(input),view.projectWarehouseDeliveryReceipt({ok:true,list:input}).list]){assert(!JSON.stringify(result).includes('CUSTOMER-PO'));assert.equal(result.currentDesk.shipment.date,'2026-11-03');assert.equal(result.currentDesk.shipment.lastGateIn,'2026-11-02T18:30');assert.equal(result.desk.references.soNo,'SO-1');}
 assert.equal(JSON.stringify(input),original);
});
test('Receiving continues to identify the supplier procurement PO and never exposes commercial documents',()=>{
 const input={id:'SUPPLIER-PO',company:'NCT',number:'NCT-PO-001',supplierName:'SUPPLIER',lines:[{taskId:'T',planned:100,accepted:20,netCostCtn:50}],documents:[{type:'PO',fileId:'COMMERCIAL-PO'},{type:'DO',fileId:'DELIVERY'}]},result=view.projectWarehouseReceivingOrder(input);
 assert.equal(result.number,'NCT-PO-001');assert.equal(result.lines[0].accepted,20);assert(!JSON.stringify(result).includes('netCostCtn'));assert.equal(result.documents.length,1);assert.equal(result.documents[0].type,'DO');
});
test('only the misleading customer PO span changes in shared frontend; ETD and gate time remain',()=>{
 const file='master-shared/desk-delivery.js',s=release.assets.get(file).toString(),old=release.baseline.get(file).toString();
 assert.equal(s,old.replace("<span>PO No. <b>'+esc(refs?.poNo||'—')+'</b></span>",''));assert(s.includes("<span>ETD <b>'+esc(shipment?.date"));assert(s.includes("<span>Last Gate In <b>'+esc(shipment?.lastGateIn"));assert(s.includes('number(line.resolution?.maximum??line.quantity)'));assert.equal(release.assets.size,99);assert.equal(release.changed.length,4);for(const[file,bytes]of release.assets)if(file.endsWith('.js'))new vm.Script(bytes.toString(),{filename:file});
});
