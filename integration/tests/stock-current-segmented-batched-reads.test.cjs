'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const filename=require.resolve('./stock-current-segmented-fence.test.cjs');
const fixture=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',
 {require:createRequire(filename),__dirname:path.dirname(filename)});
const copy=value=>JSON.parse(JSON.stringify(value));
function batched(f,alter=(name,rows)=>rows){
 const batches=[],singles=[],read=f.store.read;
 f.store.read=async(name,id)=>{singles.push([name,id]);return read(name,id);};
 f.store.readMany=async(name,ids)=>{batches.push([name,[...ids]]);return alter(name,await Promise.all(ids.map(id=>read(name,id))));};
 return{batches,singles};
}
test('already prepared sequential-reader request resumes with exact fragment/current-image batches and unchanged20step budget',async()=>{
 const f=await fixture({count:60,steps:20});await f.commit(f.request(1));
 const manifest=copy([...f.rows.values()].find(row=>row.action==='STOCK_PLAN_MANIFEST')),recorded=f.prepares;
 const reads=batched(f),next=await f.commit(f.request(1));assert.equal(next.phase,'BEFORE');assert.equal(next.completedCount,40);
 assert.equal(reads.batches.filter(([name])=>name===f.ids.journal).length,1,'all exact manifest fragments use one adapter batch');
 assert.equal(reads.batches.filter(([name])=>name==='StockPositions').length,1,'one exact20image span');
 assert.equal(reads.singles.filter(([name])=>name==='StockPositions').length,0,'no repeated per-domain query in read-only phase');
 assert.equal(f.prepares,recorded);assert.deepEqual(copy([...f.rows.values()].find(row=>row.action==='STOCK_PLAN_MANIFEST')),manifest);
 await f.finish();assert.equal(f.prepares,1);assert.equal((await f.readControl()).generation,1);
 assert.equal([...f.rows.values()].filter(row=>row.outcome?.ok).length,1);
});
for(const kind of ['short','reorder','duplicate','foreign','query'])test(`invalid ${kind} exact batch refuses before progress or domain mutation; never falls back to singles`,async()=>{
 const f=await fixture({count:6,steps:2});await f.commit(f.request(1));const control=copy(await f.readControl());let failed=false;
 const reads=batched(f,(name,rows)=>{
  if(name!=='StockPositions')return rows;failed=true;
  if(kind==='query')throw Error('BATCH_UNCONFIRMED');
  if(kind==='short')return rows.slice(1);if(kind==='reorder')return rows.toReversed();if(kind==='duplicate')return rows.map(()=>rows[0]);
  return rows.map(row=>({...row,company:'GHR'}));
 });
 const before=f.calls.length;await assert.rejects(f.commit(f.request(1)));assert.equal(failed,true);
 assert.deepEqual(copy(await f.readControl()),control);assert.equal(f.calls.slice(before).filter(row=>row.c==='StockPositions').length,0);
 assert.equal(reads.singles.filter(([name])=>name==='StockPositions').length,0);
 assert.equal(f.prepares,1);assert.equal([...f.rows.values()].some(row=>row.outcome),false);
});
test('incomplete fragment batch never becomes a decoded plan and never triggers query-error fallback',async()=>{
 const f=await fixture({count:60,steps:20});await f.commit(f.request(1));const before=copy(await f.readControl());
 batched(f,(name,rows)=>name===f.ids.journal?rows.slice(1):rows);
 await assert.rejects(f.commit(f.request(1)));assert.deepEqual(copy(await f.readControl()),before);assert.equal(f.prepares,1);
});
test('VERIFY exact batches retain per-image final comparisons and cannot publish RESULT after one corrupt image',async()=>{
 const f=await fixture({count:6,steps:2});let result;
 do{result=await f.commit(f.request(1));}while(result.phase!=='VERIFY');
 const before=copy(await f.readControl());batched(f,(name,rows)=>name==='StockPositions'?rows.map((row,index)=>index?row:{...row,onHand:999}):rows);
 await assert.rejects(f.commit(f.request(1)),/Final image conflict/);assert.deepEqual(copy(await f.readControl()),before);
 assert.equal([...f.rows.values()].some(row=>row.outcome),false);await assert.rejects(f.readSnapshot(()=>[]),/pending/);
});
