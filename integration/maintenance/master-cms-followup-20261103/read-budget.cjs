// Executes the actual workspace reader against an isolated paginated adapter.
// Counts adapter calls, not Wix latency, credits, or downstream service reads.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../../backend/purchaseWorkspace.web.js'), 'utf8').replace(/^import[^\n]+\r?\n/gm, '').replace(/^export /gm, '');
async function run({company='NCT', history=0, denied=false, failPage=0}={}) {
  const calls=[], writes=[], collected={}, counts={O:100,T:100,A:history,S:3,P:20};
  const adapter={query(collection){
    const filters=[]; let size=0;
    function page(index){
      calls.push({collection,page:index,filters:[...filters]});
      if(collection==='A'&&index===failPage)throw Error('Page unavailable');
      const count=counts[collection], from=(index-1)*size;
      return {items:Array.from({length:Math.min(size,Math.max(0,count-from))},(_,i)=>({id:collection+(from+i)})),hasNext:()=>from+size<count,next:async()=>page(index+1)};
    }
    return {limit(n){size=n;return this;},eq(key,value){filters.push([key,value]);return this;},find:async()=>page(1)};
  }};
  for(const method of ['insert','update','remove','save','bulkInsert','bulkUpdate'])adapter[method]=()=>{writes.push(method);throw Error('Unexpected write');};
  const read=vm.runInNewContext(source+'\ngetPurchaseWorkspace',{
    webMethod:(_p,fn)=>fn,Permissions:{SiteMember:1},wixData:adapter,
    PURCHASE_COLLECTIONS:{NCT:{orders:'O',tasks:'T',activity:'A'},GHR:{orders:'O',tasks:'T',activity:'A'}},
    getPurchaseStaffContext:async()=>{if(denied)throw Error('Denied');return {role:'PURCHASE'};},
    projectPurchaseWorkspace:input=>{collected.activity=input.activity.length;return {customers:[],tasks:[]};},
    readCustomerShortNames:async()=>[],readPurchaseMargins:async()=>new Map(),
    purchaseOrderList:()=>[],purchaseOrderReadResult:()=>({orders:[]}),applyPurchaseProgress:()=>{},purchaseReceiptInfo:()=>new Map()
  });
  // Adapter names are deliberately symbolic; preserve actual shared names.
  counts.SharedSuppliers=counts.S; counts.PurchaseOrders=counts.P;
  let error=null;try{await read(company);}catch(e){error=e.message;}
  return {company,history,calls,writes,collected,error};
}
async function main(){
  const results=[];
  for(const history of [335,2000,10000,20000,100000]){
    const r=await run({history});assert.equal(r.error,null);assert.equal(r.collected.activity,history);assert.equal(r.writes.length,0);
    const pages=r.calls.filter(c=>c.collection==='A').length;
    assert.equal(pages,Math.max(1,Math.ceil(history/1000)));
    assert.equal(r.calls.length,pages+4);
    assert.deepEqual(r.calls.find(c=>c.collection==='PurchaseOrders').filters,[['company','NCT']]);
    results.push({history,activityPages:pages,workspaceCollectionPageReads:r.calls.length,theoreticalPageReadsPerVisibleHour:r.calls.length*360});
  }
  const denied=await run({denied:true});assert.equal(denied.error,'Denied');assert.equal(denied.calls.length,0);
  const unknown=await run({company:'OTHER'});assert.match(unknown.error,/Select NCT or GHR/);assert.equal(unknown.calls.length,0);
  const failed=await run({history:2000,failPage:2});assert.equal(failed.error,'Page unavailable');assert.equal(failed.collected.activity,undefined);assert.equal(failed.writes.length,0);
  const ghr=await run({company:'GHR',history:1});assert.deepEqual(ghr.calls.find(c=>c.collection==='PurchaseOrders').filters,[['company','GHR']]);
  return {type:'ISOLATED_ACTUAL_READER_WITH_PAGINATED_ADAPTER_NOT_LIVE_WIX',sourceSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../../backend/purchaseWorkspace.web.js'))).digest('hex'),excludes:['Staff lookup internals','Customer short-name service internals','Network latency','Real polling frequency','Wix billing/credits','Full projection CPU (measured separately)'],results,guards:{deniedBeforeQueries:true,invalidCompanyBeforeQueries:true,secondPageFailureRejectsWholeWorkspace:true,companyScopedPurchaseOrders:true,noWrites:true},pollingAssumption:'Upper-bound arithmetic at an eligible refresh every10seconds; hidden/editing/pending guards and response duration lower actual frequency.'};
}
module.exports={main};
if(require.main===module)main().then(result=>{const json=JSON.stringify(result,null,2);if(process.argv[2])fs.writeFileSync(process.argv[2],json+'\n');console.log(json);}).catch(error=>{console.error(error);process.exitCode=1;});
