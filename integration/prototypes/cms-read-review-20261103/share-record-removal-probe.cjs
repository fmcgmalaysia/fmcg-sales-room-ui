'use strict';
// Offline counterexample only. The candidate is transformed in memory and is NOT a production patch.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {setup,request}=require('./read-growth-contract.cjs');
const load=require('../../tests/load-master-module.cjs');
const backend=path.resolve(__dirname,'../../backend');
function candidate(){
 let source=fs.readFileSync(path.join(backend,'purchaseOperations.js'),'utf8'),bindings={};
 const marker="events.push({taskId:task.title,shareRootId:demandTask.title,action:'PURCHASE_SOURCE_SHARES_SAVED'";
 assert.equal(source.split(marker).length,2);
 source=source.replace(marker,"if(canonical(readPurchaseShares(demandTask.title,s.activity).shares)!==canonical(allocation.shares))"+marker);
 source=source.replace(/^import \{([^}]+)\} from '([^']+)';\r?$/gm,(_,names,target)=>{
  const exports=target.startsWith('backend/')?load(target.slice(8)):require(target);
  for(const part of names.split(',')){const [original,alias]=part.trim().split(/\s+as\s+/);bindings[alias||original]=exports[original];}return '';
 }).replace(/^export /gm,'');
 return vm.runInNewContext(source+'\ncreatePurchaseOperations;',{...bindings,Date,JSON,Error,Object,Array,Number,Promise,Set,Map,String,Math});
}
async function probe(removeUnchanged){
 const f=setup();if(removeUnchanged)f.operate=candidate()({store:f.store});
 await f.operate(request(f,1));
 const original=request(f,2,16,200,'SELF_COLLECT'),insert=f.store.insert;let fail=true;
 f.store.insert=async(collection,row)=>{if(fail&&row.action==='PURCHASE_OPERATION_RESULT'&&row.details.requestId===original.requestId){fail=false;throw Error('SIMULATED_RESULT_WRITE_FAILURE');}return insert(collection,row);};
 await assert.rejects(f.operate(original),/SIMULATED_RESULT_WRITE_FAILURE/);
 await f.operate(request(f,3,16,210,'SELF_COLLECT'));
 let error=null;try{await f.operate(original);}catch(e){error=e.message;}
 const plan=load('purchasePlan.js').readPurchasePlan(f.task(),[...f.rows.values()]);assert.equal(plan.totalCtn,210);
 const results=[...f.rows.values()].filter(row=>row.action==='PURCHASE_OPERATION_RESULT'&&row.details.requestId===original.requestId);
 return {variant:removeUnchanged?'IN_MEMORY_REMOVE_IDENTICAL_SHARE_EVENT':'CURRENT_BASELINE',originalRetryError:error,originalResultRecords:results.length,currentQuantity:plan.totalCtn};
}
async function run(){
 const baseline=await probe(false),candidate=await probe(true);
 assert.equal(baseline.originalRetryError,null);assert.equal(baseline.originalResultRecords,1);
 assert.match(candidate.originalRetryError,/Supplier allocations changed while saving/);assert.equal(candidate.originalResultRecords,0);
 return {scope:'OFFLINE_COUNTEREXAMPLE_NO_PRODUCTION_WRITES',scenario:'Transport-only save applies; RESULT write fails; a later quantity revision succeeds; original request is retried.',baseline,candidate,decision:'Do not delete identical share events alone: current recovery uses their operation identity. No production change is proposed by this probe.'};
}
if(require.main===module)run().then(result=>{if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}).catch(e=>{console.error(e);process.exitCode=1;});
