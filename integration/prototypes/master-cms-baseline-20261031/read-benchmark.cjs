// CPU-only and store-call audit using private UI exports. Never connects to Wix.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {load,observed}=require('./measure.cjs');
const folder=process.argv[2],raw=JSON.parse(fs.readFileSync(path.join(folder,'private-dataset.json'),'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));
const {projectPurchaseWorkspace}=load('purchaseProjection.js'),{projectStockCard}=load('stockCardProjection.js'),{createPurchaseMarginRefresh}=load('purchaseMarginRefresh.js');
const staff={memberId:'LOCAL-MEASUREMENT',staffId:'LOCAL',staffName:'LOCAL',role:'SUPER ADMIN'};
const project=data=>projectPurchaseWorkspace({company:'NCT',...data,suppliers:[],staff});
const fingerprint=w=>JSON.stringify(w.tasks.map(r=>[r.id,r.ord,r.inc,r.warehouse?.accepted,r.po]));
function stock(w,activity){const s=projectStockCard({...w,activity});return s.items.reduce((t,row)=>({onHand:t.onHand+row.onHand,reserved:t.reserved+row.reservedUsable,free:t.free+row.available}),{onHand:0,reserved:0,free:0});}
async function run(){
 const current=project(raw),expected=fingerprint(current),expectedStock=stock(current,raw.activity);
 assert.equal(current.tasks.length,47);assert.deepEqual(expectedStock,{onHand:270,reserved:230,free:40});
 const before=clone(raw),rows=new Map();for(const [kind,col]of [['orders','NCTOrders'],['tasks','NCTTasks'],['activity','NCTActivity']])for(const row of raw[kind])rows.set(col+'/'+row._id,clone(row));
 const store={read:async(c,id)=>clone(rows.get(c+'/'+id)||null),insert:async(c,row)=>{assert(!rows.has(c+'/'+row._id));rows.set(c+'/'+row._id,clone(row));return row;},update:async(c,row)=>{rows.set(c+'/'+row._id,clone(row));return row;},remove:async(c,id)=>rows.delete(c+'/'+id)},obs=observed(store,rows);
 const rates=[...new Map(raw.orders.filter(row=>row.adminFxSource).map(row=>[row.transactionCurrency,{currency:row.transactionCurrency,rateToMyr:row.adminFxSource}])).values()];
 const refresh=createPurchaseMarginRefresh({store,readRates:async()=>rates}),margin=await refresh({company:'NCT',names:{orders:'NCTOrders',tasks:'NCTTasks',activity:'NCTActivity'},orders:raw.orders,tasks:raw.tasks,workspace:current,activity:raw.activity});
 const marginCalls=Object.fromEntries(['read','insert','update','remove'].map(name=>[name,obs.log.filter(x=>x.name===name).length]));
 const scale=[];
 for(const target of [429,2000,5000,9000,20000]){
  const data=clone(raw);for(let i=data.activity.length;i<target;i++)data.activity.push({_id:'LOCAL-NOISE-'+i,title:'LOCAL-NOISE-'+i,action:i%2?'PURCHASE_OPERATION_RESULT':'PURCHASE_OPERATION_PREPARED',result:i%2?'SAVED':'PREPARED',details:{kind:i%2?'RESULT':'PREPARED',requestId:'LOCAL-'+i},activityTime:'2026-10-31T00:00:00Z'});
  const results=[];for(let trial=0;trial<11;trial++){const start=performance.now(),w=project(data);assert.equal(fingerprint(w),expected);assert.deepEqual(stock(w,data.activity),expectedStock);if(trial)results.push(performance.now()-start);}
  results.sort((a,b)=>a-b);scale.push({activityRows:target,taskRows:47,orderLines:46,syntheticAddedRows:target-429,payloadJsonBytes:Buffer.byteLength(JSON.stringify(data)),samples:10,p50CpuMs:results[4],p95CpuMs:results[9],stockInvariant:expectedStock});
 }
 assert.deepEqual(raw,before);
 const result={kind:'PRIVATE_EXPORT_ISOLATED_READ_AUDIT',productionWrites:0,networkMeasured:false,scope:'Existing47 tasks; additional technical history only, not more active tasks or concurrent users. CPU includes workspace + Stock Card projection and assertions. JSON payload is local serialization, not measured network bytes.',actualStock:expectedStock,marginRates:'Stored order FX cache used only for a deterministic diagnostic; not a live external FX fetch.',marginResultCount:margin.size,marginStoreCalls:marginCalls,marginAdditionalRows:rows.size-(raw.orders.length+raw.tasks.length+raw.activity.length),scale};
 fs.writeFileSync(path.join(folder,'read-benchmark.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
