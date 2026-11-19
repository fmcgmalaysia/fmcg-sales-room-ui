const test = require('node:test'), assert = require('node:assert/strict'), load = require('./load-master-module.cjs');
const { projectStockValuationPage, createStockValuationReader } = load('stockValuationService.js');
const { projectStockControlPage } = load('stockControlService.js');
const { calculatePlanCosting } = load('purchasePlan.js');
const { PURCHASE_COLLECTIONS } = load('purchaseProjection.js');
function source(id, n, unit, extra = {}) {
 const costing = calculatePlanCosting({schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:n,freeCtn:0,prices:{lpPc:unit/12,lpCtn:unit,disc1:0,disc2:0,disc3:0}},n,12);
 return {id,customerId:'C',barcode:'001',name:'Example',packing:'12x1',ea:12,ord:0,requested:0,specialPurchase:true,po:'PO-'+id,costCurrency:'MYR',
  procurement:{totalCtn:n,customerCtn:0,costing},warehouse:{hasPhysicalReceipt:true,accepted:n},...extra};
}
const context = (tasks,activity=[],company='NCT')=>({company,tasks,activity,customers:[{id:'C',name:'Customer'}]});
const member={_id:'M',loginEmail:'account@example.test',status:'APPROVED'};
const staff={title:'S',description:'M',staffEmail:member.loginEmail,staffStatus:'ACTIVE',staffName:'Account',departments:['ACCOUNT']};
test('both companies have disjoint physical CMS collections',()=>{
 const n=Object.values(PURCHASE_COLLECTIONS.NCT),g=Object.values(PURCHASE_COLLECTIONS.GHR);
 assert.equal(n.some(name=>g.includes(name)),false);assert.equal(new Set([...n,...g]).size,6);
});
test('Finance and Warehouse share quantities and quantity version; only Finance returns costs',()=>{
 const c=context([source('A',100,50),source('B',50,56)]),before=JSON.stringify(c);
 const wh=projectStockControlPage(c),fin=projectStockValuationPage(c),row=fin.items[0];
 assert.equal(fin.quantityVersion,wh.version);for(const field of ['onHand','available','isolated','reservedUsable'])assert.equal(row[field],wh.items[0][field]);
 assert.equal(row.valuation.averageCost,52);assert.equal(row.valuation.valueCents,780000);assert.equal(fin.summary.valuation.knownValueCents,780000);
 assert.equal(JSON.stringify(c),before);assert.doesNotMatch(JSON.stringify(wh),/valuation|Cost|Cents|payment|proof/i);
});
test('receipt, unreceived PO, partial FOC and missing prices never manufacture stock or value',()=>{
 const a=source('A',100,50);a.warehouse.accepted=80;
 const b=source('B',20,40);b.warehouse.hasPhysicalReceipt=false;
 const result=projectStockValuationPage(context([a,b]));assert.equal(result.items[0].onHand,80);assert.equal(result.items[0].valuation.valueCents,400000);
 const foc=source('F',110,50);foc.procurement.costing=calculatePlanCosting({schema:1,mode:'FOC',moneySource:'TOTAL',paidCtn:100,freeCtn:10,amountCents:500000,prices:{lpPc:null,lpCtn:null,disc1:null,disc2:null,disc3:null}},110,12);foc.warehouse.accepted=100;
 const partial=projectStockValuationPage(context([foc]));assert.equal(partial.items[0].onHand,100);assert.equal(partial.items[0].valuation.valueCents,null);assert.equal(partial.items[0].sources[0].valuation.status,'FOC_RECEIPT_UNCONFIRMED');
 foc.warehouse.accepted=110;assert.equal(projectStockValuationPage(context([foc])).items[0].valuation.valueCents,500000);
});
test('known value totals flag omitted quantities and never treat a reference price as confirmed',()=>{
 const a=source('A',100,50),b=source('B',20,40);delete b.procurement.costing;b.netCostCtn=99;b.originalCostSnapshot={netCostCtn:99};
 const p=projectStockValuationPage(context([a,b]));assert.equal(p.items[0].valuation.valueCents,null);assert.equal(p.summary.valuation.knownValueCents,500000);
 assert.equal(p.summary.valuation.unvaluedQuantity,20);assert.equal(p.summary.valuation.complete,false);assert.equal(p.items[0].valuation.averageCost,null);
});
test('an assigned PO values its saved cost even when the immutable plan retains its draft flag',()=>{
 const a=source('A',100,58.08);a.procurement.draftPlan=true;a.warehouse.accepted=30;
 const before=JSON.stringify(a),p=projectStockValuationPage(context([a]));
 assert.equal(p.items[0].valuation.averageCost,58.08);assert.equal(p.items[0].valuation.valueCents,174240);
 assert.equal(p.items[0].sources[0].valuation.status,'CONFIRMED');assert.equal(JSON.stringify(a),before);
 a.po='';assert.equal(projectStockValuationPage(context([a])).items[0].valuation.valueCents,null);
 a.po='PO-A';a.procurement.costing.amountCents++;
 assert.equal(projectStockValuationPage(context([a])).items[0].sources[0].valuation.status,'COST_REQUIRES_REVIEW');
});
test('filtered summaries include all pages and cost changes invalidate a Finance cursor',()=>{
 const tasks=[source('A',10,50),source('B',20,56)].map((row,i)=>({...row,barcode:String(i)}));
 const c=context(tasks),p=projectStockValuationPage(c,{pageSize:1});assert.equal(p.items.length,1);assert.equal(p.summary.onHand.quantity,30);assert.equal(p.summary.valuation.knownValueCents,162000);
 const changed=context([source('A',10,60),tasks[1]]);changed.tasks[0].barcode='0';
 assert.equal(projectStockValuationPage(changed).quantityVersion,p.quantityVersion);
 assert.throws(()=>projectStockValuationPage(changed,{pageSize:1,cursor:p.nextCursor}),/changed/);
 const q=projectStockValuationPage(c,{search:'1'});assert.equal(q.total,2); // packing matches both
 const empty=projectStockValuationPage(c,{search:'NO SUCH SKU'});assert.equal(empty.summary.onHand.quantity,0);assert.equal(empty.summary.valuation.complete,true);
});
test('isolation remains physical stock and original purchase value, not free stock or an automatic write-off',()=>{
 const issue={title:'I',imageAltText:'A',action:'STOCK_EXCEPTION_REPORTED',result:'SAVED',initiatedByStaffId:'W',activityTime:'2026-10-31T00:00:00Z',details:{company:'NCT',quantity:10,kind:'INTERNAL_DAMAGE',reason:'Damage'}};
 const p=projectStockValuationPage(context([source('A',100,50)],[issue]));assert.equal(p.items[0].onHand,100);assert.equal(p.items[0].available,90);assert.equal(p.items[0].isolated,10);
 assert.equal(p.summary.valuation.knownValueCents,500000);assert.equal(p.summary.valuation.knownIsolatedValueCents,50000);
});
test('reallocation and borrow ownership do not alter physical quantities or source costs',()=>{
 const a=source('A',100,50),b={...source('B',50,56),specialPurchase:false,ord:30,requested:30,warehouse:{hasPhysicalReceipt:false,accepted:0}};
 const event={title:'ALLOC',action:'PLANNER_ALLOCATION_SAVED',result:'SAVED',imageAltText:'A',activityTime:'2026-10-31T00:00:00Z',details:{beforeRevision:'',targets:[{taskId:'B',quantity:30}]}};
 const before=projectStockValuationPage(context([a,b])),after=projectStockValuationPage(context([a,b],[event]));
 assert.equal(after.items[0].reservedUsable,30);assert.equal(after.items[0].available,70);assert.equal(after.items[0].onHand,before.items[0].onHand);assert.equal(after.items[0].valuation.valueCents,before.items[0].valuation.valueCents);
});
test('Finance authorization denies Warehouse, inactive and unmapped staff before reading inventory',async()=>{
 let calls=0;for(const bad of [{...staff,departments:['WAREHOUSE']},{...staff,staffStatus:'INACTIVE'},{...staff,description:'OTHER'}]){
  const read=createStockValuationReader({readMember:async()=>member,readStaffRecords:async()=>[bad],readContext:async()=>{calls++;return context([])}});
  await assert.rejects(()=>read('NCT'),/not authorized/);
 }assert.equal(calls,0);
 const read=createStockValuationReader({readMember:async()=>member,readStaffRecords:async()=>[staff],readContext:async company=>{calls++;return context([source('A',10,50)],[],company)}});
 assert.equal((await read('GHR')).company,'GHR');await assert.rejects(()=>read('ALL'),/Select/);
 const mismatch=createStockValuationReader({readMember:async()=>member,readStaffRecords:async()=>[staff],readContext:async()=>context([])});await assert.rejects(()=>mismatch('GHR'),/mismatch/);
});

test('invalid Finance filters never read company data',async()=>{
 let calls=0;const read=createStockValuationReader({readMember:async()=>member,readStaffRecords:async()=>[staff],readContext:async()=>{calls++;return context([])}});
 for(const input of [{pageSize:1000},{filter:'COST_EXPORT'},{search:'x'.repeat(101)}])await assert.rejects(()=>read('NCT',input),/filters/);
 assert.equal(calls,0);
});

test('actual Loaded consumes attributed source cost once, including retries and later invoices',async()=>{
 const {fixture}=require('../prototypes/stock-loaded-contract-20261028/check-current.cjs'),f=fixture();
 for(const task of f.tasks){task.costCurrency='MYR';task.procurement.costing=source(task.id,100,task.id==='A'?50:60).procurement.costing;}
 const read=async()=>projectStockValuationPage(await f.context());
 assert.equal((await read()).summary.valuation.knownValueCents,850000);
 await f.prepSave(await f.prepRequest({action:'PACK'}));
 const request=await f.prepRequest({action:'LOAD',loaded:80,note:'Synthetic short load'});
 await f.prepSave(request);await f.prepSave(request);
 let result=await read();assert.equal(result.items[0].onHand,70);assert.equal(result.summary.valuation.knownValueCents,420000);
 const wh=projectStockControlPage(await f.context());assert.equal(wh.quantityVersion,result.quantityVersion);
 const selected=await f.fulfil({action:'SELECT',customerId:'CUSTOMER-A',lines:[{taskId:'A',quantity:80}]});
 await f.fulfil({action:'INVOICE',id:selected.shipmentId,number:'SI-STOCK-TEST',date:'2026-10-31',amountCents:200000});
 result=await read();assert.equal(result.summary.valuation.knownValueCents,420000);
 assert.equal(projectStockValuationPage(await f.context('GHR')).summary.onHand.quantity,0);
});
