const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{measureNativeReadCapacity}=require('../prototypes/stock-current-state/native-read-capacity-probe.cjs');
const folder=path.join(__dirname,'../prototypes/stock-current-state');
function fixture({empty=false,failAt=0,malformed=false}={}){const calls=[];let time=0,count=0;const rows=empty?[]:[{_id:'SYNTHETIC',company:'NCT',privatePayload:'NEVER EXPOSE THIS'}];
 const items={query:collection=>{assert.equal(collection,'StockProtocolTest');const filters=[],q={eq:(key,value)=>{filters.push(row=>row[key]===value);return q;},ascending:key=>{assert.equal(key,'_id');return q;},limit:limit=>{assert.ok(limit<=25);return q;},
  find:async options=>{calls.push(options);if(++count===failAt)throw Error('Network details must not leak');const result=rows.filter(row=>filters.every(fn=>fn(row)));return{items:result,totalCount:malformed?undefined:result.length};}};return q;}};
 return{items,calls,now:()=>++time};}
test('bounded native probe uses ONLY existing isolated rows, complete-count/consistent reads and exposes metrics not payload or IDs',async()=>{
 for(const company of ['NCT','GHR']){const f=fixture(),result=await measureNativeReadCapacity({...f,input:{company,samples:12}});assert.equal(result.ok,true);assert.equal(result.readOnly,true);assert.equal(result.readCalls,12);assert.equal(result.samples.length,12);assert.equal(result.productionCapacityAccepted,false);
  assert.doesNotMatch(JSON.stringify(result),/privatePayload|NEVER EXPOSE|"SYNTHETIC"/);assert.equal(f.calls.every(call=>call.consistentRead===true&&call.returnTotalCount===true),true);}
});
test('empty test collection never causes record creation; failure preserves confirmed metrics without retry or native mutation',async()=>{
 const f=fixture({empty:true}),empty=await measureNativeReadCapacity({...f,input:{company:'NCT',samples:3}});assert.equal(empty.ok,true);assert.equal(empty.existingSyntheticRecordFound,false);assert.equal(empty.readCalls,3);
 const lost=fixture({failAt:3}),result=await measureNativeReadCapacity({...lost,input:{company:'NCT',samples:12}});assert.equal(result.ok,false);assert.equal(result.readCalls,3);assert.equal(result.completedSamples.length,2);assert.doesNotMatch(result.error,/Network details/);
 const malformed=fixture({malformed:true});assert.equal((await measureNativeReadCapacity({...malformed,input:{company:'NCT',samples:1}})).ok,false);
});
test('arbitrary collection/oversized count/browser timing or malformed input rejected before any query',async()=>{
 for(const input of [null,{},[],{company:'OTHER',samples:1},{company:'NCT',samples:13},{company:'NCT',samples:1,collection:'NCTTasks'},{company:'NCT',samples:1,now:1}]){const f=fixture();await assert.rejects(measureNativeReadCapacity({...f,input}),/Bounded/);assert.equal(f.calls.length,0);}
});
test('generated diagnostic is Admin-only and exact, not part of the stock install packet or write/recovery authority',async()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-read-capacity-probe.cjs'),'--check'],{encoding:'utf8'}),/verified/);
 const source=fs.readFileSync(path.join(folder,'stockProtocolReadCapacity.web.js'),'utf8');assert.equal((source.match(/webMethod\(Permissions.Admin/g)||[]).length,2);assert.doesNotMatch(source,/items\.(insert|patch|remove)|Permissions.(Anyone|SiteMember)|createSegmentedFencedProof|saveStock|readControl/);
 let permission;const f=fixture(),api=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';measureStockReadCapacity;',{items:f.items,Permissions:{Admin:'ADMIN'},webMethod:(grant,fn)=>{permission=grant;return fn;}});
 assert.equal(permission,'ADMIN');assert.equal((await api({company:'NCT',samples:1})).ok,true);assert.equal((await api({company:'NCT',samples:100})).ok,false);
 const manifest=require('../prototypes/stock-current-state/current-install-manifest.json');assert.equal(manifest.install.some(row=>row.target==='stockProtocolReadCapacity.web.js'),false);
});
