const test=require('node:test'),assert=require('node:assert/strict');
const {measureNativeBatchRead}=require('../prototypes/stock-current-state/native-read-capacity-probe.cjs');
function fixture({size=13,fail=0,truncate=false,duplicate=false}={}){
 const rows=Array.from({length:size},(_,i)=>({_id:'PRIVATE-'+i,company:i%2?'NCT':'GHR',privatePayload:'NEVER_EXPOSE'}));
 const calls=[];let time=0;
 const items={query:collection=>{assert.equal(collection,'StockProtocolTest');let limit=50;const filters=[];
  const q={eq:(field,value)=>{assert.equal(field,'company');filters.push(row=>row[field]===value);return q;},
   hasSome:(field,values)=>{assert.equal(field,'_id');assert.equal(values.length,50);assert.equal(new Set(values).size,50);filters.push(row=>values.includes(row[field]));return q;},
   ascending:()=>q,limit:n=>{limit=n;return q;},find:async options=>{assert.deepEqual(options,{consistentRead:true,returnTotalCount:true});calls.push(limit);
    if(calls.length===fail)throw Error('Private transport error');const selected=rows.filter(row=>filters.every(fn=>fn(row))),page={items:selected.slice(0,limit),totalCount:selected.length};
    if(truncate&&calls.length===2)page.items=[];if(duplicate&&calls.length===2&&page.items.length>1)page.items[1]=page.items[0];return page;}};return q;}};
 return{items,calls,now:()=>++time};
}
test('fixed readonly 50-ID native batch check compares complete identities and company filtering without disclosing seed IDs',async()=>{
 for(const company of ['NCT','GHR']){const f=fixture(),result=await measureNativeBatchRead({...f,input:{company}});
  assert.equal(result.ok,true);assert.equal(result.readOnly,true);assert.equal(result.readCalls,3);assert.equal(result.existingSeedRows,13);
  assert.equal(result.productionCapacityAccepted,false);assert.deepEqual(f.calls,[25,51,51]);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE-|privatePayload|NEVER_EXPOSE/);}
});
test('incomplete seed, partial batch, duplicate result and errors fail closed with no retry',async()=>{
 for(const options of [{size:26},{truncate:true},{duplicate:true},{fail:2}]){
  const f=fixture(options),result=await measureNativeBatchRead({...f,input:{company:'NCT'}});assert.equal(result.ok,false);
  assert.ok(f.calls.length<=2);assert.doesNotMatch(JSON.stringify(result),/Private transport error|PRIVATE-/);}
});
test('empty isolated collection is a valid no-mutation query check, not proof of business capacity',async()=>{
 const f=fixture({size:0}),result=await measureNativeBatchRead({...f,input:{company:'NCT'}});
 assert.equal(result.ok,true);assert.equal(result.existingSeedRows,0);assert.equal(result.productionCapacityAccepted,false);
});
test('arbitrary IDs, collection and sample policy cannot be supplied by browser',async()=>{
 for(const input of [null,[],{}, {company:'OTHER'},{company:'NCT',ids:['BUSINESS']},{company:'NCT',collection:'NCTTasks'},{company:'NCT',samples:3}]){
  const f=fixture();await assert.rejects(measureNativeBatchRead({...f,input}));assert.equal(f.calls.length,0);}
});
