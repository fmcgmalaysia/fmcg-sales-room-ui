'use strict';
// OFFLINE G3 instrumentation of the actual existing root fixture, not a new
// authority/endpoint or native capacity acceptance. No network/production data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
function reviewRecordHeadroom(peakAdditionalRecords,siteBudget){
 if(!Number.isSafeInteger(peakAdditionalRecords)||peakAdditionalRecords<0)throw Error('Known bounded additional record count required');
 if(siteBudget===undefined)return{status:'UNKNOWN',capacityAccepted:false,siteSnapshotVerified:false};
 if(!siteBudget||Object.keys(siteBudget).sort().join(',')!=='itemLimit,usedItems'
  ||!Number.isSafeInteger(siteBudget.itemLimit)||siteBudget.itemLimit<1||!Number.isSafeInteger(siteBudget.usedItems)||siteBudget.usedItems<0
  ||!Number.isSafeInteger(siteBudget.usedItems+peakAdditionalRecords))throw Error('Explicit site item quota and observed count required');
 return{status:siteBudget.usedItems+peakAdditionalRecords>siteBudget.itemLimit?'KNOWN_INSUFFICIENT':'LOWER_BOUND_FITS_NOT_ACCEPTED',
  itemLimit:siteBudget.itemLimit,observedUsedItems:siteBudget.usedItems,projectedHealthyPeak:siteBudget.usedItems+peakAdditionalRecords,
  capacityAccepted:false,siteSnapshotVerified:false};
}
async function measureWarehouseInvocationBudget(productCount=300,steps=20,siteBudget){
 if(!Number.isSafeInteger(productCount)||productCount<1||productCount>300||!Number.isSafeInteger(steps)||steps<1||steps>100)throw Error('Bounded existing receipt diagnostic required');
 reviewRecordHeadroom(0,siteBudget); // Reject invalid/partial budget before fixture work.
 const file=path.resolve(__dirname,'../../tests/stock-current-warehouse-receipt-web.test.cjs');
 const factory=vm.runInNewContext(fs.readFileSync(file,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',
  {require:createRequire(file),__dirname:path.dirname(file),Map,Buffer});
 const f=await factory('NCT',true,productCount,steps),counts={read:0,insert:0,compareAndSet:0,compareAndRemove:0,find:0};
 for(const method of ['read','insert','compareAndSet','compareAndRemove']){const original=f.store[method].bind(f.store);f.store[method]=async(...args)=>{counts[method]++;return original(...args);};}
 const query=f.items.query.bind(f.items);f.items.query=(...args)=>{const q=query(...args),find=q.find.bind(q);q.find=async(...args)=>{counts.find++;return find(...args);};return q;};
 const snapshots=[],baselineFixtureRecords=f.db.size;
 for(let invocation=1;invocation<=2;invocation++){
  const before={...counts},result=await f.api.saveWarehouseReceiptCurrent('NCT',f.initial);if(result.ok!==true&&!result.pending)throw Error('Original receipt diagnostic refused');
  const operations=Object.fromEntries(Object.keys(counts).map(key=>[key,counts[key]-before[key]]));
  snapshots.push({invocation,result:{ok:result.ok,pending:Boolean(result.pending),phase:result.phase||null,completedCount:result.completedCount??null,totalRecords:result.totalRecords??null},operations,
   countedDataRoundTripLowerBound:operations.read+operations.insert+2*operations.compareAndSet+operations.compareAndRemove+operations.find});
  if(result.ok)break;
 }
 const manifest=[...f.db.values()].find(row=>row.action==='STOCK_PLAN_MANIFEST');
 if(!manifest)throw Error('Actual prepared receipt manifest required');
 const fragments=manifest.fragments.map(ref=>f.db.get(f.journal+'/'+ref.id));
 const plan=require('./segmented-plan.cjs').createSegmentedPlanCodec({company:'NCT',domainWrites:true}).decode({manifest,fragments,
  key:manifest._id,digest:manifest.digest,memberId:manifest.memberId,requestId:manifest.requestId});
 const newBusinessRecords=plan.writes.filter(change=>change.before===null).length;
 const retainedEvidenceRecords=fragments.length+2; // Immutable fragments + manifest + RESULT. Not one row per image.
 const healthyRetainedAdditionalRecords=newBusinessRecords+retainedEvidenceRecords;
 const healthyPeakAdditionalRecords=healthyRetainedAdditionalRecords+1; // One transient original company lock.
 const recordFootprint={baselineFixtureRecords,writeImages:plan.writes.length,newBusinessRecords,
  updatedBusinessRecords:plan.writes.length-newBusinessRecords,fragmentRecords:fragments.length,retainedEvidenceRecords,
  healthyRetainedAdditionalRecords,healthyPeakAdditionalRecords,
  orphanAttemptsIncluded:false,wholeSiteCaptured:false,capacityAccepted:false,
  siteHeadroom:reviewRecordHeadroom(healthyPeakAdditionalRecords,siteBudget)};
 return{schema:'STOCK_OFFLINE_INVOCATION_BUDGET_V1',offline:true,productCount,stepsPerInvocation:steps,productionCapacityAccepted:false,recordFootprint,
  note:'Interface calls only; actual SDK CAS adds a read plus patch. Original table/member/file/network/latency costs are not fully counted. Bounded apply steps do NOT prove bounded preparation.',snapshots};
}
if(require.main===module)measureWarehouseInvocationBudget().then(report=>process.stdout.write(JSON.stringify(report,null,2)+'\n')).catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
module.exports={measureWarehouseInvocationBudget,reviewRecordHeadroom};
