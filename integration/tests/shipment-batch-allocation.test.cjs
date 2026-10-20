const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {allocateBatchMetric,allocateBatchSources,resolveBatchEntitlements}=load('shipmentBatchAllocation.js');
const plain=value=>JSON.parse(JSON.stringify(value));
test('increase first demand preserves later committed and received quantities',()=>{
 const rows=[{quantity:350,coverage:{committed:300,received:300}},{quantity:200,coverage:{committed:200,received:200}}];
 assert.deepEqual(plain(allocateBatchMetric(rows,500,'committed')),[300,200]);assert.deepEqual(plain(allocateBatchMetric(rows,500,'received')),[300,200]);
 assert.deepEqual(plain(allocateBatchMetric(rows,550,'committed')),[350,200]);assert.deepEqual(plain(allocateBatchMetric(rows,500,'received')),[300,200]);
});
test('new supplier fills pending first row without taking second row supplier entitlement',()=>{
 const rows=[{quantity:350,sourceCoverage:[{id:'A',quantity:300}]},{quantity:200,sourceCoverage:[{id:'A',quantity:200}]}];
 assert.deepEqual(plain(allocateBatchSources(rows,[{id:'A',quantity:500},{id:'B',quantity:50}])),[[{id:'A',quantity:300},{id:'B',quantity:50}],[{id:'A',quantity:200}]]);
});
test('preserve all supplier anchors before filling gaps, even when new source sorts first',()=>{
 const rows=[{quantity:350,sourceCoverage:[{id:'Z',quantity:300}]},{quantity:200,sourceCoverage:[{id:'Z',quantity:200}]}];
 assert.deepEqual(plain(allocateBatchSources(rows,[{id:'A',quantity:50},{id:'Z',quantity:500}])),[[{id:'Z',quantity:300},{id:'A',quantity:50}],[{id:'Z',quantity:200}]]);
});
test('selected row cancellation caps its entitlement while preserving other batch and stock total',()=>{
 const rows=[{quantity:250,coverage:{committed:250,received:250},sourceCoverage:[{id:'A',quantity:250}]},{quantity:200,coverage:{committed:200,received:200},sourceCoverage:[{id:'A',quantity:200}]}];
 assert.deepEqual(plain(allocateBatchMetric(rows,500,'received')),[250,200]);const sources=[{id:'A',quantity:500}],before=JSON.stringify(sources);
 const used=allocateBatchSources(rows,sources);assert.equal(used.flat().reduce((sum,row)=>sum+row.quantity,0),450);assert.equal(JSON.stringify(sources),before);
});
test('legacy unanchored plans retain sequential allocation; reduced actual stock never creates cartons',()=>{
 const rows=[{quantity:300},{quantity:200}];assert.deepEqual(plain(allocateBatchMetric(rows,320,'committed')),[300,20]);
 const held=[{quantity:350,coverage:{received:300}},{quantity:200,coverage:{received:200}}];assert.deepEqual(plain(allocateBatchMetric(held,480,'received')),[300,180]);
});
test('resolved metadata keeps batch IDs and never mutates original plan or sources',()=>{
 const plan={id:'P',batches:[{sequence:1,label:'This shipment',lines:[{taskId:'T',quantity:350,coverage:{committed:300,received:300}}]},{sequence:2,label:'Next shipment',lines:[{taskId:'T',quantity:200,coverage:{committed:200,received:200}}]}]},before=JSON.stringify(plan);
 const result=resolveBatchEntitlements(plan,'T',{committed:500,received:500});assert.deepEqual(plain(result.map(row=>[row.id,row.metrics.committed,row.metrics.received])),[['P|1',300,300],['P|2',200,200]]);assert.equal(JSON.stringify(plan),before);
});
test('malformed coverage and source quantities fail closed',()=>{
 assert.throws(()=>allocateBatchMetric([{quantity:100,coverage:{committed:101}}],100,'committed'),/entitlement/);assert.throws(()=>allocateBatchSources([{quantity:100}],[{id:'A',quantity:-1}]),/quantities/);
});
test('purchase for second pending batch fills that batch, not the first gap',()=>{
 const plan={id:'P',batches:[{sequence:1,label:'Now',lines:[{taskId:'T',quantity:350,coverage:{committed:300,received:300},sourceCoverage:[{id:'OLD',quantity:300}]}]},{sequence:2,label:'Next',lines:[{taskId:'T',quantity:250,coverage:{committed:200,received:200},sourceCoverage:[{id:'OLD',quantity:200}]}]}]};
 const sources=[{id:'OLD',quantity:500},{id:'NEW',quantity:50,batchId:'P|2'}],rows=resolveBatchEntitlements(plan,'T',{committed:550,received:550},sources);
 assert.deepEqual(plain(rows.map(row=>[row.metrics.committed,row.metrics.received])),[[300,300],[250,250]]);
});
