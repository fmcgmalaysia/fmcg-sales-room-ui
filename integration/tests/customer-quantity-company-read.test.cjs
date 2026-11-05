const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const load=require('./load-master-module.cjs');
const {fixture}=require('../prototypes/master-cms-baseline-20261031/measure.cjs');
const {projectPurchaseOrders}=load('purchaseOrderWorkflow.js');
const copy=value=>JSON.parse(JSON.stringify(value));

async function run(company,foreignCount=0,authorized=true){
 const f=fixture('purchase-order-workflow.test.cjs'),workspace={...copy(f.workspace),company};
 const taskIds=workspace.tasks.filter(t=>t.po).map(t=>t.id);
 const current={_id:'CURRENT',company,details:{taskIds,finance:{payments:[{id:'PAY',confirmed:true,cents:500,proof:{fileId:'PROOF'}}]}}};
 const foreign=company==='NCT'?'GHR':'NCT';
 const records=[current,...Array.from({length:foreignCount},(_,i)=>({_id:'FOREIGN'+i,company:foreign,details:{taskIds}})),{_id:'UNKNOWN',details:{taskIds}}];
 const names={orders:company+'Orders',tasks:company+'Tasks',activity:company+'Activity'},reads=[],filters=[];
 const before=JSON.stringify(records);
 const wixData={query(collection){let filter=()=>true,size=1000;return {
  hasSome(field,ids){filters.push({collection,field,ids:Array.from(ids)});filter=row=>ids.includes(row[field]);return this;},
  limit(value){size=value;return this;},
  async find(options){assert.equal(options.consistentRead,true);assert.equal(options.suppressAuth,true);const rows=collection==='PurchaseOrders'?records.filter(filter):[];let offset=0;const page=()=>{const items=rows.slice(offset,offset+size);reads.push({collection,items:copy(items)});return {items,hasNext:()=>offset+size<rows.length,next:async()=>{offset+=size;return page();}};};return page();}
 };}};
 const secret='test-only-existing-intake-secret',project=input=>projectPurchaseOrders({...input,now:new Date('2026-11-05T00:00:00Z')});
 const source=fs.readFileSync(path.join(__dirname,'../backend/purchaseQuantityRead.js'),'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
 let projected;
 const read=vm.runInNewContext(source+';readPurchaseQuantities',{
  Buffer,Set,Map,Date,JSON,Promise,Error,Array,String,Math,Number,Object,
  timingSafeEqual:crypto.timingSafeEqual,getSecret:async()=>secret,wixData,
  PURCHASE_COLLECTIONS:{[company]:names},projectPurchaseWorkspace:()=>workspace,projectPurchaseOrders:project,
  projectPurchaseQuantities(input){projected=copy(input.purchaseOrders);return {orders:[{orderId:'O',lines:[]}]};}
 });
 const result=await read({headers:{authorization:'Bearer '+(authorized?secret:'wrong')},body:{json:async()=>({company,customerId:'C',orders:[{orderId:'O',submissionId:'S'}]})}});
 assert.equal(JSON.stringify(records),before,'a read cannot mutate saved PO or payment data');
 return {result,reads,filters,projected,reference:copy(project({company,workspace,records}))};
}

test('customer quantity read retrieves only its company POs, preserving Finance lock and projection',async()=>{
 for(const company of ['NCT','GHR']){const r=await run(company,2500);assert.equal(r.result.status,200);assert.deepEqual(r.projected,r.reference);assert.equal(r.projected[0].procurementContentLocked,true);const rows=r.reads.filter(q=>q.collection==='PurchaseOrders').flatMap(q=>q.items);assert.deepEqual(rows.map(r=>r._id),['CURRENT']);assert.deepEqual(r.filters,[{collection:'PurchaseOrders',field:'company',ids:[company]}]);}
});

test('growth in the other company does not add returned PO rows or pages',async()=>{
 const small=await run('NCT',0),large=await run('NCT',50000);
 const cost=r=>r.reads.filter(q=>q.collection==='PurchaseOrders').map(q=>q.items.length);
 assert.deepEqual(cost(large),cost(small));assert.deepEqual(cost(large),[1]);assert.deepEqual(large.projected,small.projected);
});

test('existing bearer rejection still occurs before any collection read',async()=>{
 const r=await run('NCT',2500,false);assert.equal(r.result.status,401);assert.equal(r.reads.length,0);assert.equal(r.filters.length,0);assert.equal(r.projected,undefined);
});
