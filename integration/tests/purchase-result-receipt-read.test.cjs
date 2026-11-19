const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),load=require('./load-master-module.cjs');
const {operationId}=load('purchaseOperationJournal.js');
const {projectPurchaseDisplayOrder}=load('purchaseDisplayOrder.js');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(records=[],{failPage=0,deny=false}={}){
 const calls=[],received=[];
 function query(collection){
  let predicates=[],pageSize=1000;
  const q={collection,eq(k,v){predicates.push(r=>r[k]===v);return q;},ne(k,v){predicates.push(r=>r[k]!==v);return q;},isEmpty(k){predicates.push(r=>r[k]===undefined||r[k]===null);return q;},hasSome(k,values){assert(values.length<=100);predicates.push(r=>values.includes(r[k]));return q;},or(other){const left=[...predicates];predicates=[r=>left.every(f=>f(r))||other.matches(r)];return q;},matches:r=>predicates.every(f=>f(r)),limit(n){pageSize=n;return q;},async find(options){
   assert.equal(options.suppressAuth,true);assert.equal(options.consistentRead,true);
   const rows=(records[collection]||[]).filter(q.matches);
   const page=index=>{calls.push({collection,index,returned:rows.slice(index*pageSize,(index+1)*pageSize).length});if(failPage&&index===failPage)throw Error('Page failed');return {items:copy(rows.slice(index*pageSize,(index+1)*pageSize)),hasNext:()=>rows.length>(index+1)*pageSize,next:async()=>page(index+1)};};
   return page(0);
  }};return q;
 }
 const source=fs.readFileSync('integration/backend/purchaseWorkspace.web.js','utf8').replace(/^import[^\n]+\r?\n/gm,'').replace(/^export /gm,'');
 const api=vm.runInNewContext(source+'\n({purchaseActivity,getPurchaseWorkspace})',{operationId,webMethod:(_p,f)=>f,Permissions:{SiteMember:1},wixData:{query},PURCHASE_COLLECTIONS:{NCT:{orders:'NO',tasks:'NT',activity:'NA'},GHR:{orders:'GO',tasks:'GT',activity:'GA'}},getPurchaseStaffContext:async()=>{if(deny)throw Error('Denied');return {staffName:'Verified'};},projectPurchaseWorkspace:input=>{received.push(input);return {company:input.company,customers:[],tasks:[]};},readCustomerShortNames:async()=>[],readPurchaseMargins:()=>new Map(),purchaseOrderList:()=>[],applyPurchaseProgress(){},purchaseReceiptInfo:()=>new Map(),purchaseOrderReadResult:x=>x});
 return {...api,calls,received};
}
test('ordinary workspace omits unrelated successful-result payloads while retaining every business event and unknown/blank lock',async()=>{
 const input=[{_id:'B',title:'B',action:'WAREHOUSE_RECEIPT_SAVED',details:{quantity:10}},{_id:'P',title:'P',action:'PURCHASE_OPERATION_PREPARED',details:{plan:{events:[]}}},{_id:'COST_LOCK',details:{owner:'original'}},{_id:'U',action:'FUTURE_BUSINESS_EVENT'},{_id:'N',action:null},{_id:'R',action:'PURCHASE_OPERATION_RESULT',details:{outcome:{ok:true}}}];
 const f=fixture({NA:input}),result=await f.purchaseActivity('NA');assert.deepEqual(copy(result),input.slice(0,-1));assert.equal(f.calls.length,1);
});
test('confirmed legacy row ordering retains precisely the result receipts the original projector consumes',async()=>{
 const company='NCT',customerId='C',tasks=[{id:'T1',customerId},{id:'T2',customerId}],key=id=>JSON.stringify([id,'']),plan={customerId,beforeRevision:'',rows:[key('T2'),key('T1')]};
 const prepared={_id:'PREP',title:'PREP',action:'PURCHASE_OPERATION_PREPARED',details:{requestId:'REQ',plan:{displayOrder:plan}}},result={_id:'OTHER-ID',title:operationId('PREP','RESULT'),action:'PURCHASE_OPERATION_RESULT',result:'SAVED',details:{requestId:'REQ',outcome:{ok:true,company,requestId:'REQ'}}};
 const records=[prepared,result,{_id:'UNRELATED',title:'UNRELATED',action:'PURCHASE_OPERATION_RESULT'}],f=fixture({NA:records}),filtered=await f.purchaseActivity('NA');
 assert.equal(filtered.length,2);assert.equal(f.calls.length,2);assert.deepEqual(copy(projectPurchaseDisplayOrder(company,tasks,[],filtered)),copy(projectPurchaseDisplayOrder(company,tasks,[],records)));
});
test('a missing legacy completion is neither fabricated nor treated as a completed reorder',async()=>{const records=[{title:'P',action:'PURCHASE_OPERATION_PREPARED',details:{plan:{displayOrder:{}}}}],f=fixture({NA:records});assert.deepEqual(copy(await f.purchaseActivity('NA')),records);assert.equal(f.calls.length,2);});
test('legacy receipt keys are deduplicated and queried in bounded groups',async()=>{const records=Array.from({length:205},(_,i)=>({title:'P'+i,action:'PURCHASE_OPERATION_PREPARED',details:{plan:{displayOrder:{}}}}));const f=fixture({NA:records});assert.equal((await f.purchaseActivity('NA')).length,205);assert.equal(f.calls.length,4);});
test('all business pages remain complete, without truncating years of history',async()=>{const records=Array.from({length:2105},(_,i)=>({_id:'B'+i,action:'CUSTOMER_SHIPMENT_CHANGED'})).concat(Array.from({length:2000},(_,i)=>({_id:'R'+i,action:'PURCHASE_OPERATION_RESULT'})));const f=fixture({NA:records}),rows=await f.purchaseActivity('NA');assert.equal(rows.length,2105);assert.equal(f.calls.length,3);assert.equal(rows.at(-1)._id,'B2104');});
test('a failed later page rejects the whole workspace instead of returning partial stock or Finance data',async()=>{const f=fixture({NA:Array.from({length:1001},(_,i)=>({_id:'B'+i,action:'WAREHOUSE_RECEIPT_SAVED'}))},{failPage:1});await assert.rejects(f.getPurchaseWorkspace('NCT'),/Page failed/);assert.equal(f.received.length,0);});
test('company separation and query-before-authentication guards are preserved',async()=>{for(const company of ['NCT','GHR']){const f=fixture({NA:[{_id:'N'}],GA:[{_id:'G'}]});await f.getPurchaseWorkspace(company);assert.equal(f.received[0].activity[0]._id,company==='NCT'?'N':'G');assert.equal(f.calls.length,5);}const bad=fixture();await assert.rejects(bad.getPurchaseWorkspace('OTHER'),/Select NCT or GHR/);assert.equal(bad.calls.length,0);const denied=fixture({}, {deny:true});await assert.rejects(denied.getPurchaseWorkspace('NCT'),/Denied/);assert.equal(denied.calls.length,0);});
