'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {verifyR2SdkAuthority}=require('../prototypes/stock-current-state/r2-sdk-authority-probe.cjs');
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture({badPatch=false,partialBulk=false,failInsert=false,reorder=false}={}){
 const rows=new Map(),calls=[],elevated=[];
 const items={query:c=>{let ids;const q={hasSome:(k,v)=>{assert.equal(k,'_id');ids=v;return q;},limit:n=>{assert.equal(n,4);return q;},find:async o=>{assert.equal(o.consistentRead,true);calls.push('query');const found=ids.map(id=>rows.get(id)).filter(Boolean);return{items:copy(found).map(row=>reorder?{...row,details:Object.fromEntries(Object.entries(row.details).reverse())}:row),totalCount:found.length};}};return q;},
  insert:async(c,row)=>{calls.push('insert');if(failInsert)throw Error('UNKNOWN_INSERT');if(rows.has(row._id))throw Error('DUPLICATE');rows.set(row._id,copy(row));},
  bulkInsert:async(c,batch)=>{calls.push('bulk');for(const row of partialBulk?batch.slice(0,1):batch)if(!rows.has(row._id))rows.set(row._id,copy(row));return{errors:partialBulk?[{}]:[]};},
  patch:(c,id)=>{const fields={};const p={setField:(k,v)=>{fields[k]=copy(v);return p;},run:async o=>{calls.push('patch');const row=rows.get(id);if(!badPatch&&Object.entries(o.condition).some(([k,v])=>row?.[k]!==v.$eq))throw Error('WDE0193: Update condition not met.');rows.set(id,{...row,...copy(fields)});}};return p;}};
 const elevate=fn=>{assert.ok(Object.values(items).includes(fn));elevated.push(fn);return (...args)=>{assert.equal(args[0],'StockProtocolTest');return fn(...args);};};
 return{rows,calls,elevated,run:(step='RUN',enabled=true)=>verifyR2SdkAuthority({items,elevate,input:{step},enabled})};
}
test('authority probe defaults CLOSED, cannot choose records/collection and retains Admin-only export',async()=>{
 const f=fixture();assert.equal((await f.run('RUN',false)).blocked,true);assert.equal(f.calls.length,0);
 await assert.rejects(verifyR2SdkAuthority({input:{step:'RUN',company:'GHR'}}));
 const source=require('../prototypes/stock-current-state/build-r2-sdk-authority-probe.cjs').source,grants=[];
 const api=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';verifyR2Authority;',{
  items:{},auth:{elevate:()=>{throw Error('CLOSED must not elevate');}},Permissions:{Admin:'ADMIN'},webMethod:(p,fn)=>{grants.push(p);return fn;},console:{info:()=>{}}});
 assert.match(source,/import \{ auth \} from '@wix\/essentials'/);assert.doesNotMatch(source,/from 'wix-auth'/);
 assert.deepEqual(grants,['ADMIN']);assert.equal((await api({step:'RUN'})).blocked,true);assert.doesNotMatch(source,/items\.remove|bulkSave|bulkUpdate|suppressAuth|setMode/);
});
test('four elevated native method constructors preserve a rejecting version condition and exact fixed after-images',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.elevated.length,4);assert.equal(r.staleConditionRejected,true);assert.equal(r.finalValue,17);
 const snapshot=copy([...f.rows]);assert.equal((await f.run()).ok,false);assert.deepEqual(copy([...f.rows]),snapshot);
 const count=f.calls.length,inspect=await f.run('INSPECT',false);assert.equal(inspect.complete,true);assert.equal(inspect.mutationAttempted,false);assert.deepEqual(f.calls.slice(count),['query']);
 assert.equal(r.ordinaryStaffAuthorizationAccepted,false);assert.equal(r.activationReady,false);
});
test('server JSON key ordering does not fabricate an authority failure',async()=>{assert.equal((await fixture({reorder:true}).run()).ok,true);});
for(const options of [{badPatch:true},{partialBulk:true},{failInsert:true}])test('partial, uncertain or unconditional provider never becomes authority acceptance: '+JSON.stringify(options),async()=>{
 const f=fixture(options),r=await f.run();assert.equal(r.ok,false);assert.equal(r.noAutomaticRetryResetOrCleanup,true);assert.ok(f.rows.size<=3);
 if(options.failInsert)assert.deepEqual(f.calls,['query','insert']);
});
