const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {createSupportDeskOperations}=load('supportDesk.js');
// CMS object fields have no insertion-order guarantee; arrays retain their order.
const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,reorder(value[key])])):value;
function fixture(tamper=false){
 const records=new Map(),copy=value=>JSON.parse(JSON.stringify(value));
 const store={insert:async(collection,row)=>{assert.equal(records.has(row._id),false);const saved=reorder(copy(row));records.set(row._id,saved);return copy(saved);},read:async(collection,id)=>{const found=records.get(id);if(!found)return null;const saved=copy(found);if(tamper)saved.details.state.assignments[0].desk=2;return saved;}};
 const save=createSupportDeskOperations({store,names:{NCT:{activity:'NCT'}},readContext:async company=>({company,tasks:[{id:'T1',customerId:'C1'}],activity:[...records.values()].map(copy)}),now:()=>new Date('2026-10-27T14:14:00Z')});
 const request={company:'NCT',staff:{packingDepartment:'SUPPORT',memberId:'M1',staffId:'S1',staffName:'Staff'},requestId:'aaaaaaaa-1111-4111-8111-111111111111',input:{action:'DESK_ASSIGN',customerId:'C1',taskId:'T1',desk:1,revision:''}};
 return {records,save,request};
}
test('Desk save confirms the same persisted state when CMS reorders object fields',async()=>{const f=fixture();const result=await f.save(f.request);assert.equal(result.ok,true);assert.equal(result.deskState.assignments[0].desk,1);assert.equal(f.records.size,1);assert.deepEqual(JSON.parse(JSON.stringify(await f.save(f.request))),JSON.parse(JSON.stringify(result)));assert.equal(f.records.size,1);});
test('Desk receipt still rejects changed saved values despite a matching stored digest',async()=>{const f=fixture(true);await assert.rejects(f.save(f.request),/Desk save is not confirmed/);assert.equal(f.records.size,1);assert.equal([...f.records.values()][0].details.state.assignments[0].desk,1);});
