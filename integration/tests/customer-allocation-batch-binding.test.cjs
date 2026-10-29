const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {allocateBatchSources}=load('shipmentBatchAllocation.js');
const entries=[{id:'FIRST',quantity:200},{id:'SECOND',quantity:50}];
test('explicit borrowed-source entitlement stays in selected second batch regardless of source sort or preferred procurement batch',()=>{
 const result=allocateBatchSources(entries,[{id:'BORROWED',quantity:30,batchId:'FIRST',bindings:[{id:'SECOND',quantity:30}]},{id:'OWN',quantity:200,bindings:[{id:'FIRST',quantity:200}]},{id:'FREE',quantity:20,bindings:[{id:'SECOND',quantity:20}]}]);
 assert.equal(result[0].length,1);assert.equal(result[0][0].id,'OWN');assert.equal(result[1].reduce((n,row)=>n+row.quantity,0),50);assert.equal(result[1].find(row=>row.id==='BORROWED').quantity,30);
});
test('bound stock cannot exceed batch demand, omit a positive source, silently lose cartons or refer to an old batch',()=>{
 for(const sources of [[{id:'S',quantity:201,bindings:[{id:'FIRST',quantity:201}]}],[{id:'S',quantity:30,bindings:[{id:'SECOND',quantity:20}]}],[{id:'S',quantity:30,bindings:[{id:'OLD',quantity:30}]}],[{id:'S',quantity:20,bindings:[{id:'SECOND',quantity:20}]},{id:'T',quantity:10}]])assert.throws(()=>allocateBatchSources(entries,sources));
});
test('original procurement source coverage keeps the existing saved-anchor algorithm without stock bindings',()=>{
 const rows=[{id:'FIRST',quantity:200,sourceCoverage:[]},{id:'SECOND',quantity:100,sourceCoverage:[{id:'S',quantity:100}]}],result=allocateBatchSources(rows,[{id:'S',quantity:200}]);assert.equal(result[0][0].quantity,100);assert.equal(result[1][0].quantity,100);
});
