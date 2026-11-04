const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const load=require('./load-master-module.cjs'),{PROCUREMENT_SAVE_PENDING}=load('purchasePlan.js');
const blocked=async()=>{throw Error(PROCUREMENT_SAVE_PENDING);};
const auth=async()=>({staffId:'STAFF',memberId:'MEMBER',staffName:'TEST'});
for(const [file,name,args,bindings] of [
 ['purchaseOperations.web.js','savePurchaseOperation',['NCT','REQ','PLAN',{}],{getPurchaseStaffContext:auth,operate:blocked}],
 ['purchaseOrders.web.js','savePurchaseOrder',['NCT','REQ',{}],{getPurchaseStaffContext:auth,orders:{save:blocked}}],
 ['accountPurchase.web.js','saveAccountSettlement',['NCT','REQ',{}],{accountStaff:auth,settlements:{save:blocked}}],
 ['accountPurchase.web.js','saveAccountInvoiceCheck',['NCT','REQ',{}],{accountStaff:auth,reviews:{save:blocked}}],
 ['warehouseReceiving.web.js','saveWarehouseReceipt',['NCT','REQ',{}],{staffContext:auth,operations:{save:blocked}}],
 ['warehouseReceiving.web.js','saveWarehousePreparation',['NCT','REQ',{action:'PHOTO'}],{staffContext:auth,savePreparation:blocked}],
 ['packingLists.web.js','savePackingList',['NCT','WAREHOUSE','REQ',{}],{staffContext:auth,savePackingOperation:blocked}]
])test(name+' returns specific recoverable feedback without internal journal details',async()=>{
 const text=fs.readFileSync(path.join(__dirname,'../backend',file),'utf8'),start=text.indexOf('export const '+name+'='),end=text.indexOf('\n});',start)+4;
 assert.ok(start>=0&&end>start);const scope={...bindings,PROCUREMENT_SAVE_PENDING,webMethod:(_,fn)=>fn,Permissions:{SiteMember:1},console:{info(){},warn(){}}};
 vm.runInNewContext(text.slice(start,end).replace('export const '+name+'=','this.call='),scope);
 const result=await scope.call(...args);assert.equal(result.ok,false);assert.equal(result.requestId,'REQ');assert.equal(result.retryable,true);assert.equal(result.error,PROCUREMENT_SAVE_PENDING);assert.deepEqual(Object.keys(result).sort(),['error','ok','requestId','retryable']);
});

test('task notice is confined to affected rows; quantities and existing recovery links remain',()=>{
 const file=path.join(__dirname,'purchase-source-grid.test.cjs'),req=createRequire(file),fixture=vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nfixture;',{require:n=>n==='node:test'?()=>{}:req(n),__dirname,Map,Set,Date,console});
 const f=fixture();f.args.active=true;const before=f.render();assert.doesNotMatch(before,/Save pending/);
 f.root.procurementSavePending=true;const after=f.render();assert.equal(after.replaceAll('<small class="procurement-save-pending" role="status">Save pending 保存待恢复</small>',''),before);assert.ok(after.includes('Save pending 保存待恢复'));
 delete f.root.procurementSavePending;assert.equal(f.render(),before);
});

test('receiving exposes only pending flag, never preparation records or commercial fields',()=>{
 const {projectWarehouseReceivingOrder}=load('warehouseDeliveryView.js'),result=projectWarehouseReceivingOrder({id:'PO',company:'NCT',number:'PO1',procurementSavePending:true,lines:[],amount:100,cost:100,prepared:{requestId:'PRIVATE'},documents:[]});
 assert.equal(result.procurementSavePending,true);assert.doesNotMatch(JSON.stringify(result),/amount|cost|PRIVATE|prepared/);
});
