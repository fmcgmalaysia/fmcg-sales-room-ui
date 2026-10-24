const test=require('node:test'),assert=require('node:assert/strict');
const {batchAllocation}=require('../prototypes/stock-current-state/purchase-batch-allocation.cjs');
const entry=(id,quantity,received)=>({id,quantity,metrics:{received}});
test('confirmed split allocation is preserved rather than copying root90onto both rows',()=>{
 const root={stockAllocatedCumulative:90,batchEntitlements:[entry('P|1',80,80),entry('P|2',20,10)]};
 assert.deepEqual(batchAllocation(root),[{id:'P|1',demand:80,allocated:80},{id:'P|2',demand:20,allocated:10}]);
 assert.equal(root.batchEntitlements[1].metrics.received,10);
});
test('unknown, truncated, overfilled, duplicate or closed-source-incomplete coverage cannot become a displayed batch total',()=>{
 const variants=[{stockAllocatedCumulative:90,batchEntitlements:[entry('P|1',80,80)]},
 {stockAllocatedCumulative:90,batchEntitlements:[entry('P|1',80,90)]},
 {stockAllocatedCumulative:0,batchEntitlements:[entry('P|1',0,0),entry('P|1',0,0)]},
 {stockAllocatedCumulative:0,batchEntitlements:[entry('P|1',10,null)]},
 {stockAllocatedCumulative:200,batchEntitlements:[entry('P|1',100,100)]},{}];
 for(const root of variants)assert.equal(batchAllocation(root),undefined);
});
test('known zero allocations remain zero on every confirmed batch',()=>{
 assert.deepEqual(batchAllocation({stockAllocatedCumulative:0,batchEntitlements:[entry('P|1',80,0),entry('P|2',20,0)]}),
 [{id:'P|1',demand:80,allocated:0},{id:'P|2',demand:20,allocated:0}]);
});
