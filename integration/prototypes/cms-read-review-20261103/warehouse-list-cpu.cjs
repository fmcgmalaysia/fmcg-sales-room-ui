// Offline measurement only. Does not access Wix, files containing business data, or the network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module'),{performance}=require('node:perf_hooks');
const testPath=path.resolve(__dirname,'../../tests/warehouse-list-read-efficiency.test.cjs'),localRequire=createRequire(testPath);
const {api,seed}=vm.runInNewContext(fs.readFileSync(testPath,'utf8')+'\n({api,seed});',{require:name=>name==='node:test'?()=>{}:localRequire(name),__dirname:path.dirname(testPath)});
async function run(){
 const results=[];
 for(const count of [50,200]){
  const f=await seed({placed:false}),task={...f.task()},order={...f.rows.get('NCTOrders/O0')};
  for(let i=2;i<count;i++){const id=(i+100).toString(16).padStart(32,'0'),line='L'+i;f.rows.set('NCTTasks/'+id,{...task,_id:id,title:id,imageAltText:line,rowPosition:i+1});f.rows.set('NCTOrders/O'+i,{...order,_id:'O'+i,sourceLineId:line});f.rows.get('NCTActivity/R').details.taskIds.push(id);}
  for(let i=0;i<5000;i++)f.rows.set('NCTActivity/H'+i,{title:'H'+i,action:'UNRELATED',result:'SAVED',activityTime:'2020-01-01'});
  const runs=[];let expected;
  for(let sample=0;sample<3;sample++)for(const old of sample%2?[false,true]:[true,false]){
   const a=api(f,{old}),start=performance.now(),value=await a.exports.getWarehouseOrders('NCT'),ms=performance.now()-start;delete value.readAt;
   assert.equal(a.calls.cbm,old?count:0);const text=JSON.stringify(value);if(expected)assert.equal(text,expected);else expected=text;
   runs.push({old,ms:Math.round(ms*10)/10,preparationCalls:a.calls.preparation,cbmCalls:a.calls.cbm,queries:a.calls.queries.length,returnedRows:a.calls.queries.reduce((n,q)=>n+q.rows,0),writes:a.calls.writes.length});
  }
  results.push({tasks:count,unrelatedHistory:5000,responseEqual:true,runs});
 }
 return {scope:'OFFLINE_CPU_ONLY_NOT_WIX_LATENCY_OR_CAPACITY',source:'Synthetic in-memory fixture, actual production projection functions',results};
}
if(require.main===module)run().then(result=>{if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
