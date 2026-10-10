const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../backend/purchaseCostRetry.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
const {createPurchaseCostRetry}=vm.runInNewContext('(function(){'+source+'\nreturn {createPurchaseCostRetry};})()',{
  createHash,PURCHASE_COLLECTIONS:{NCT:{orders:'Orders',tasks:'Tasks',activity:'Activity'}},Date,JSON,Error,Object,Array,Number,Promise});
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const taskId='a'.repeat(32),requestId='11111111-1111-4111-8111-111111111111',rows=new Map();let captures=0;
  const original={unitBarcode:'B',costCurrency:'MYR',lpPc:null,lpCtn:null,disc1:null,disc2:null,disc3:null,costStatus:'ERROR',costIssues:['POINTBASE_SERVICE_UNAVAILABLE']};
  rows.set('Tasks/'+taskId,{_id:taskId,title:taskId,description:'ORDER',imageAltText:'LINE',originalCostSnapshot:copy(original),latestCostReference:copy(original),
    lpPc:null,lpCtn:null,disc1:null,disc2:null,disc3:null,manualCostField:[],supplierId:'KEEP SUPPLIER',ourPoNumber:'KEEP PO',purchaseQtyInCtn:250,rowPosition:7});
  rows.set('Orders/O',{_id:'O',title:'ORDER',description:'B',sourceLineId:'LINE',submissionId:'SUB',cbmCtn:null,sellingPricePc:14.66});
  rows.set('Activity/R',{_id:'R',title:'R',description:'ORDER',action:'ORDER_RECEIVED',result:'ACCEPTED',details:{submissionId:'SUB',taskIds:[taskId]}});
  const store={read:async(c,id)=>copy(rows.get(c+'/'+id)||null),one:async(c,criteria)=>copy([...rows].filter(([key])=>key.startsWith(c+'/')).map(([,row])=>row).find(row=>Object.entries(criteria).every(([key,value])=>row[key]===value))||null),
    insert:async(c,row)=>{if(rows.has(c+'/'+row._id))throw Error('duplicate');rows.set(c+'/'+row._id,copy(row));return copy(row);},
    update:async(c,row)=>{rows.set(c+'/'+row._id,copy(row));return copy(row);},remove:async(c,id)=>rows.delete(c+'/'+id)};
  const retry=createPurchaseCostRetry({store,captureCosts:async(barcodes)=>{captures++;assert.deepEqual([...barcodes],['B']);return{B:{unitBarcode:'B',costCurrency:'MYR',lpPc:1,lpCtn:16,disc1:.1,disc2:.05,disc3:2,
    netCostCtn:11.68,cbmPerCtn:.1234,capturedAt:'2026-10-10T03:00:00Z',costStatus:'CAPTURED',costIssues:[]}};}});
  const input={company:'NCT',taskId,requestId,staff:{staffId:'STAFF',staffName:'ACTUAL OPERATOR',memberId:'MEMBER'}};
  return{retry,input,rows,task:()=>rows.get('Tasks/'+taskId),captures:()=>captures,original};
}
test('one task retry fills initial unavailable values and preserves original failure and procurement fields',async()=>{
  const f=fixture(),before=copy(f.task());const result=await f.retry(f.input),task=f.task();
  assert.equal(result.ok,true);assert.equal(task.lpPc,1);assert.equal(task.disc3,2);assert.deepEqual(task.originalCostSnapshot,before.originalCostSnapshot);
  for(const key of ['supplierId','ourPoNumber','purchaseQtyInCtn','rowPosition'])assert.equal(task[key],before[key]);
  assert.equal(f.rows.get('Orders/O').sellingPricePc,14.66);assert.equal(f.rows.get('Orders/O').cbmCtn,.1234);
  assert.equal([...f.rows.values()].filter(row=>row.action==='COST_RETRY_RESULT').length,1);
  await f.retry(f.input);assert.equal(f.captures(),1);assert.equal([...f.rows.values()].filter(row=>row.action==='COST_RETRY_ATTEMPT').length,1);
});
test('existing and explicitly manual prices are retained even when a new reference is fetched',async()=>{
  const f=fixture();f.task().lpPc=9;f.task().disc3=0;f.task().manualCostField=['lpCtn'];
  await f.retry(f.input);assert.equal(f.task().lpPc,9);assert.equal(f.task().disc3,0);assert.equal(f.task().lpCtn,null);
  assert.equal(f.task().latestCostReference.lpCtn,16);
});
test('customer invoice lock rejects before cost service or any history writes',async()=>{
  const f=fixture();f.rows.get('Orders/O').salesInvoiceNumber='INVOICE';
  await assert.rejects(f.retry(f.input),/locked/);assert.equal(f.captures(),0);assert.equal(f.rows.size,3);
});
test('incomplete intake cannot be repaired through cost retry',async()=>{
  const f=fixture();f.rows.delete('Activity/R');await assert.rejects(f.retry(f.input),/receipt is not complete/);assert.equal(f.captures(),0);
});
