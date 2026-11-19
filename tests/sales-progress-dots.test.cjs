const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),get=name=>html.split(/\r?\n/).find(line=>line.startsWith('function '+name+'('));
test('Sales uses the five current stages and preserves partial receipt status', () => {
  const context = vm.createContext({
    salesProgressRequested: line => line.quantityCtn,
    salesProgressNum: value => Number(value) || 0,
    esc: value => String(value), Math, Number
  });
  for (const name of ['salesProgressStages', 'salesProgressStageZh']) {
    vm.runInContext(html.split(/\r?\n/).find(line => line.startsWith('const ' + name + '=')), context);
  }
  vm.runInContext(get('salesLineProgressDots'), context);
  const dots = context.salesLineProgressDots({}, { quantityCtn: 200, committedQtyCtn: 190, receivedQtyCtn: 90 }, 3);
  assert.equal((dots.match(/role="img"/g) || []).length, 5);
  assert.equal((dots.match(/sales-line-dot complete/g) || []).length, 2);
  assert.equal((dots.match(/sales-line-dot partial/g) || []).length, 1);
  assert.match(dots, /Ready to Load/);
  assert.match(dots, />5<\/span>/);
  assert.doesNotMatch(dots, /Request Sent|Repacking|Shipped/);
});
test('only Sales with a confirmed active Master date can edit it after transfer; PO lock stays unchanged',()=>{const h=vm.createContext({String});vm.runInContext(get('salesPlanningEditable'),h);vm.runInContext(get('salesShipmentEditable'),h);const order={status:'SUBMITTED TO NCT',destination:'NCT',submittedAt:'2026-10-14',masterReceipt:{submissionId:'S'},shipmentDateRevision:'',shipmentDateLocked:false};assert.equal(h.salesPlanningEditable(order),false);assert.equal(h.salesShipmentEditable(order),true);assert.equal(h.salesShipmentEditable({...order,shipmentDateLocked:true}),false);assert.equal(h.salesShipmentEditable({...order,shipmentDateRevision:undefined}),false);});
