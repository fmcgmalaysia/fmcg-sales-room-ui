const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const load=require('./load-master-module.cjs'),clone=x=>JSON.parse(JSON.stringify(x));
function fixture(file,name='fixture',gate){
 const full=path.join(__dirname,file+'.test.cjs'),req=createRequire(full),wrappedLoad=(module,cache)=>{
  const exports=load(module,cache);if(!gate||!exports[gate.factory])return exports;
  return {...exports,[gate.factory]:args=>exports[gate.factory]({...args,[gate.reader]:async(...params)=>{
   const value=await args[gate.reader](...params);if(!gate.pending)return value;
   const out=clone(value);if(Array.isArray(out)){for(const row of out)row.procurementSavePending=true;}
   else for(const row of (out.physicalContext||out).tasks||[])row.procurementSavePending=true;
   return out;
  }})};
 };
 return vm.runInNewContext(fs.readFileSync(full,'utf8')+'\n'+name+';',{require:n=>n==='node:test'?()=>{}:n==='./load-master-module.cjs'?wrappedLoad:req(n),Map,Set,Buffer,structuredClone,Date,console});
}
for(const stage of ['prepare','apply'])test('Warehouse '+stage+' rejects pending PO; prior confirmed receipt remains replayable',async()=>{
 const f=fixture('warehouse-receiving')(),request={...f.base,input:await f.input(80)};
 if(stage==='apply'){const insert=f.store.insert;f.store.insert=async(c,row)=>{const result=await insert(c,row);if(row.action==='PURCHASE_OPERATION_PREPARED')throw Error('CUT');return result;};await assert.rejects(f.operations.save(request),/CUT/);f.store.insert=insert;}
 f.po.procurementSavePending=true;await assert.rejects(f.operations.save(request),/Procurement save pending/);assert.equal((await f.readOrders('NCT'))[0].lines[0].accepted,0);
 delete f.po.procurementSavePending;await f.operations.save(request);f.po.procurementSavePending=true;await f.operations.save(request);assert.equal((await f.readOrders('NCT'))[0].lines[0].accepted,80);
});
for(const stage of ['prepare','apply'])test('Purchase document workflow '+stage+' blocks only pending business, original completion retained',async()=>{
 const f=fixture('purchase-order-workflow')(),row=(await f.operations.list('NCT',f.staff))[0],request={...f.base,input:{id:row.id,version:row.version,action:'TERM',termDays:7,reason:'Supplier term'}};
 if(stage==='apply'){const insert=f.store.insert;f.store.insert=async(c,row)=>{const out=await insert(c,row);if(row.action==='PURCHASE_OPERATION_PREPARED')throw Error('CUT');return out;};await assert.rejects(f.operations.save(request),/CUT/);f.store.insert=insert;}
 f.workspace.tasks[0].procurementSavePending=true;await assert.rejects(f.operations.save(request),/Procurement save pending/);assert.equal([...f.records.keys()].filter(k=>k.startsWith('PurchaseOrders/')).length,0);
 delete f.workspace.tasks[0].procurementSavePending;await f.operations.save(request);f.workspace.tasks[0].procurementSavePending=true;await f.operations.save(request);
});
test('Finance payment upload blocks before any file allocation; existing payments remain',async()=>{
 const f=fixture('account-settlement','proofFileHarness')(),before=clone([...f.records]);f.row.procurementSavePending=true;
 await assert.rejects(f.operations.save(await f.request(f.input)),/Procurement save pending/);assert.equal(f.calls.length,0);assert.deepEqual(clone([...f.records]),before);
});
test('Finance invoice review rejects pending PO without approval writes',async()=>{
 const f=fixture('account-purchase-review')(),row=(await f.listOrders('NCT'))[0];f.workspace.tasks[0].procurementSavePending=true;
 await assert.rejects(f.operations.save({company:'NCT',staff:f.staff,requestId:'11111111-1111-4111-8111-111111111111',input:{id:row.id,version:row.version,action:'INVOICE_CHECK',enabled:true}}),/Procurement save pending/);assert.equal(f.records.size,0);
});
for(const which of ['source','target'])test('Supplier credit rejects pending '+which+' and no credit is moved',async()=>{
 const f=fixture('supplier-credit')();f[which].procurementSavePending=true;await assert.rejects(f.apply({...f.base,input:f.input}),/Procurement save pending/);assert.equal(f.records.size,0);
});
for(const which of ['A','B','FREE'])test('Allocation rejects pending '+which+' before allocation or loan event',async()=>{
 const f=fixture('customer-allocation-save')();f.tasks.find(row=>row.id===which).procurementSavePending=true;await assert.rejects(f.save({...f.base,input:f.input()}),/Procurement save pending/);assert.equal(f.activity().length,0);
});
test('Shortage decision rejects pending task without changing decisions',async()=>{
 const f=fixture('purchase-shortage')();f.row.procurementSavePending=true;await assert.rejects(f.save({...f.base,input:f.input()}),/Procurement save pending/);assert.equal(f.records.size,0);
});
test('Support Desk blocks pending task but another customer remains usable',async()=>{
 const f=fixture('support-desk')();f.tasks[0].procurementSavePending=true;await assert.rejects(f.save(f.request),/Procurement save pending/);assert.equal(f.records.size,0);
 const other={...f.request,requestId:'bbbbbbbb-1111-4111-8111-111111111111',input:{...f.request.input,taskId:'T3',customerId:'C2'}};await f.save(other);assert.equal(f.records.size,1);
 delete f.tasks[0].procurementSavePending;await f.save(f.request);f.tasks[0].procurementSavePending=true;await f.save(f.request);assert.equal(f.records.size,2);
});
test('SI selection blocks pending source without changing confirmed shipment history',async()=>{
 const f=fixture('customer-fulfilment')(),before=clone(await f.context());f.tasks[0].procurementSavePending=true;
 await assert.rejects(f.act({action:'SELECT',customerId:'C',lines:[{taskId:'T',quantity:90}]}),/Procurement save pending/);assert.deepEqual(clone((await f.context()).activity),before.activity);
});
test('Warehouse Loaded prepare and retry cannot consume pending stock, recovery remains once-only',async()=>{
 const gate={factory:'createPackingListOperations',reader:'readContext',pending:false},f=fixture('packing-list-operations','fixture',gate)();await f.create();
 for(const action of ['SEND','START']){const list=(await f.context()).lists[0];await f.save(await f.request({action,id:list.id,revision:list.revision},action==='SEND'?f.staff:f.warehouse));}
 const list=(await f.context()).lists[0],request=await f.request({action:'PROGRESS',id:list.id,revision:list.revision,lines:[{taskId:'T',packed:50,loaded:40,reason:'Container full'}]},f.warehouse);
 gate.pending=true;await assert.rejects(f.save(request),/Procurement save pending/);assert.equal((await f.context()).lists[0].lines[0].loaded,0);
 gate.pending=false;const insert=f.store.insert;f.store.insert=async(c,row)=>{const out=await insert(c,row);if(row.action==='PURCHASE_OPERATION_PREPARED')throw Error('CUT');return out;};await assert.rejects(f.save(request),/CUT/);f.store.insert=insert;
 gate.pending=true;await assert.rejects(f.save(request),/Procurement save pending/);assert.equal((await f.context()).lists[0].lines[0].loaded,0);
 gate.pending=false;await f.save(request);gate.pending=true;await f.save(request);assert.equal((await f.context()).lists[0].lines[0].loaded,40);
});
test('Short-load resolution blocks pending affected line and preserves Loaded',async()=>{
 const gate={factory:'createShortloadResolutionOperations',reader:'readContext',pending:false},f=await fixture('shortload-resolution','setup',gate)();const request=await f.decision([{mode:'CONTINUE',quantity:10}]),before=clone(await f.current());gate.pending=true;
 await assert.rejects(f.resolve(request),/Procurement save pending/);assert.deepEqual(clone(await f.current()),before);
});

test('Finance interrupted upload cannot resume against pending PO; original payment then completes once',async()=>{
 const gate={factory:'createAccountSettlementOperations',reader:'listOrders',pending:false},f=fixture('account-settlement','proofFileHarness',gate)(),request=await f.request(f.input);
 f.failExtra();await assert.rejects(f.operations.save(request),/lost upload/);const calls=f.calls.length,before=clone([...f.records]);
 gate.pending=true;await assert.rejects(f.operations.save(request),/Procurement save pending/);assert.equal(f.calls.length,calls);assert.deepEqual(clone([...f.records]),before);
 gate.pending=false;await f.operations.save(request);gate.pending=true;await f.operations.save(request);assert.equal(f.records.get('PurchaseOrders/PO').details.finance.payments.length,1);
});

test('Prepared supplier credit cannot resume against pending target; original transfer stays once-only',async()=>{
 const gate={factory:'createSupplierCreditOperations',reader:'listOrders',pending:false},f=fixture('supplier-credit','fixture',gate)(),request={...f.base,input:f.input};
 // The existing fixture closes over its store. The read hook blocks apply after PREPARED.
 let reads=0;Object.defineProperty(gate,'pending',{get(){return ++reads>1;},configurable:true});
 await assert.rejects(f.apply(request),/Procurement save pending/);assert.equal([...f.records.values()].filter(r=>r.action==='SUPPLIER_CREDIT_APPLIED').length,0);
 Object.defineProperty(gate,'pending',{value:false,writable:true});await f.apply(request);gate.pending=true;await f.apply(request);assert.equal((await f.listOrders())[1].finance.balanceCents,46000);
});

test('Prepared allocation cannot resume while donor is pending; completed retry transfers no more stock',async()=>{
 const f=fixture('customer-allocation-save')(),request={...f.base,input:f.input()},insert=f.store.insert;
 f.store.insert=async(c,row)=>{const result=await insert(c,row);if(row.action==='PURCHASE_OPERATION_PREPARED')throw Error('CUT');return result;};await assert.rejects(f.save(request),/CUT/);f.store.insert=insert;
 f.tasks[1].procurementSavePending=true;await assert.rejects(f.save(request),/Procurement save pending/);assert.equal(f.activity().filter(r=>r.action==='PLANNER_ALLOCATION_SAVED').length,0);
 delete f.tasks[1].procurementSavePending;await f.save(request);f.tasks[1].procurementSavePending=true;await f.save(request);assert.equal(f.activity().filter(r=>r.action==='PLANNER_ALLOCATION_SAVED').length,1);
});

test('Quantity decisions preserve outstanding cases until original procurement is complete',async()=>{
 const f=fixture('purchase-quantity-cases','harness')(),request=await f.request('UNPLACED'),before=clone(await f.cases());f.workspace.tasks[0].procurementSavePending=true;
 await assert.rejects(f.operate(request),/Procurement save pending/);assert.deepEqual(clone(await f.cases()),before);delete f.workspace.tasks[0].procurementSavePending;await f.operate(request);
});
