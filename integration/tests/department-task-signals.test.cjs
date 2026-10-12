const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../master-shared/task-signals.js'),'utf8'),context);const project=context.masterTaskSignals.project;
const task={id:'T',barcode:'001',name:'Product',supplierId:'S',po:'P',ord:100,inc:90,procurement:{availableCtn:0},warehouse:{issue:true},shortage:{customerDecision:'STOP',supplierDecision:'CREDIT',financeRequired:true}};
test('customer stop and reading never clear supplier risk; only verified financial closure clears it',()=>{
 const input={tasks:[task],orders:[{id:'P',taskIds:['T'],invoiceChecked:false,financialRisk:true}]};const first=project('PURCHASE',input);assert.equal(first.categories.find(row=>row.key==='urgent').count,1);assert.equal(first.entries.find(row=>row.category==='urgent').owner,'ACCOUNT');assert.equal(JSON.stringify(project('PURCHASE',input)),JSON.stringify(first));input.orders[0].invoiceChecked=true;input.orders[0].financialRisk=false;const closed=project('PURCHASE',input);assert.equal(closed.categories.find(row=>row.key==='urgent').count,0);assert.equal(input.tasks[0].ord,100);
});
test('duplicate problems count one affected task and preserve each reason and blocked department',()=>{
 const result=project('PURCHASE',{tasks:[{...task,shortage:{customerDecision:'PENDING',supplierDecision:'PENDING',financeRequired:true},procurement:{availableCtn:90}}]});assert.equal(result.categories.find(row=>row.key==='urgent').count,1);assert.equal(result.categories.find(row=>row.key==='feedback').count,1);assert.equal(result.entries.filter(row=>row.category==='feedback').length,2);assert.ok(result.entries.some(row=>row.owner==='PURCHASE'&&row.blocked.includes('SALES')));
});
test('prepayment appears in work queue before final invoice and short closure does not falsely wait for full receipt',()=>{
 const po={id:'P',number:'P',supplierName:'S',state:'ACTIVE',prepaymentPending:true,creditorActive:true,documents:[],warehouse:{complete:false},finance:{receiptResolved:false}};let queue=project('ACCOUNT',{orders:[po]});assert.equal(queue.categories.find(row=>row.key==='partial').count,1);assert.ok(queue.entries.some(row=>row.category==='blocked'&&row.owner==='PURCHASE'));po.finance.receiptResolved=true;po.documents=[{type:'INV'}];queue=project('ACCOUNT',{orders:[po]});assert.equal(queue.categories.find(row=>row.key==='blocked').count,0);
});
test('warehouse issue points to Purchase until planner records supplier decision',()=>{
 const po={id:'P',number:'P',supplierName:'S',status:'ISSUE',lines:[{issue:true,shortage:null}]};let queue=project('WAREHOUSE',{orders:[po]});assert.equal(queue.entries.find(row=>row.category==='feedback').owner,'PURCHASE');po.lines[0].shortage={supplierDecision:'CREDIT'};queue=project('WAREHOUSE',{orders:[po]});assert.equal(queue.categories.find(row=>row.key==='feedback').count,0);
});
