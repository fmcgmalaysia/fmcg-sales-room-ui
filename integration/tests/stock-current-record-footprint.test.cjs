'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {measureWarehouseInvocationBudget,reviewRecordHeadroom}=require('../prototypes/stock-current-state/measure-warehouse-invocation-budget.cjs');
test('actual original300-product root distinguishes new rows, updates, fragments and transient lock instead of counting901images as901newrows',async()=>{
 const report=await measureWarehouseInvocationBudget(300,20),r=report.recordFootprint;
 assert.equal(r.writeImages,901);assert.equal(r.newBusinessRecords,601);assert.equal(r.updatedBusinessRecords,300);
 assert.equal(r.baselineFixtureRecords,601);assert.ok(r.fragmentRecords>1);assert.ok(r.fragmentRecords<32);
 assert.equal(r.retainedEvidenceRecords,r.fragmentRecords+2);
 assert.equal(r.healthyRetainedAdditionalRecords,601+r.fragmentRecords+2);
 assert.equal(r.healthyPeakAdditionalRecords,r.healthyRetainedAdditionalRecords+1);
 assert.equal(r.siteHeadroom.status,'UNKNOWN');assert.equal(r.capacityAccepted,false);
 assert.equal(r.orphanAttemptsIncluded,false);assert.equal(r.wholeSiteCaptured,false);assert.equal(report.productionCapacityAccepted,false);
 assert.equal(report.snapshots[0].result.phase,'BEFORE');assert.equal(report.snapshots[1].result.completedCount,40);
});
test('known insufficient quota is rejected as capacity evidence; exact fit still never grants production capacity or deployment',()=>{
 for(const[usedItems,status]of[[9999,'KNOWN_INSUFFICIENT'],[9385,'LOWER_BOUND_FITS_NOT_ACCEPTED'],[0,'LOWER_BOUND_FITS_NOT_ACCEPTED']]){
  const report=reviewRecordHeadroom(615,{itemLimit:10000,usedItems});
  assert.equal(report.status,status);assert.equal(report.capacityAccepted,false);assert.equal(report.siteSnapshotVerified,false);
  assert.equal(report.projectedHealthyPeak,usedItems+615);
 }
 assert.equal(reviewRecordHeadroom(1,{itemLimit:1,usedItems:2}).status,'KNOWN_INSUFFICIENT');
});
test('unknown, invalid, partial or overflowed site counts never become zero or accepted headroom',async()=>{
 assert.equal(reviewRecordHeadroom(1).status,'UNKNOWN');
 for(const value of [null,{}, {itemLimit:10000},{itemLimit:0,usedItems:0},{itemLimit:10000,usedItems:-1},
  {itemLimit:10000,usedItems:null},{itemLimit:10000,usedItems:0,verified:true},{itemLimit:10000,usedItems:Number.MAX_SAFE_INTEGER}]){
  assert.throws(()=>reviewRecordHeadroom(1,value),/quota/);
 }
 for(const value of [-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>reviewRecordHeadroom(value),/bounded/);
 await assert.rejects(measureWarehouseInvocationBudget(300,20,{itemLimit:10000}),/quota/);
});
