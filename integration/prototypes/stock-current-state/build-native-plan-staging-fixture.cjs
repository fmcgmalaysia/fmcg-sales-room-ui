'use strict';
// Mechanical export of the existing actual-root synthetic300 receipt fixture.
// No business arithmetic, native access or original test/source modification.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createSegmentedPlanCodec}=require('./segmented-plan.cjs');
const filename=require.resolve('../../tests/stock-current-warehouse-receipt-web.test.cjs');
const factory=vm.runInNewContext(fs.readFileSync(filename,'utf8').replace("const test=require('node:test')",'const test=()=>{}')+';fixture;',
 {require:createRequire(filename),__dirname:path.dirname(filename),Map,Buffer});
async function build(){
 const f=await factory('NCT',true,300,20);
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-23T06:00:00.000Z']));}}
 f.bindings.Date=FixedDate;
 const result=await f.api.saveWarehouseReceiptCurrent('NCT',f.initial);
 if(result.ok!==false||result.pending!==true||result.phase!=='BEFORE')throw Error('Actual300 root must stage before business application');
 const manifest=[...f.db.values()].find(row=>row.action==='STOCK_PLAN_MANIFEST');
 const codec=createSegmentedPlanCodec({company:'NCT',domainWrites:true});
 const plan=codec.decode({manifest,fragments:manifest.fragments.map(ref=>f.db.get(f.journal+'/'+ref.id)),key:manifest._id,
  digest:manifest.digest,memberId:manifest.memberId,requestId:manifest.requestId});
 if(plan.writes.length!==901||plan.writes.filter(w=>w.after.action==='WAREHOUSE_RECEIPT_SAVED').length!==1
  ||[...f.db.values()].some(row=>row.sourceKind==='PURCHASE_SOURCE'))throw Error('Expected untouched actual300 plan');
 return {schema:'STOCK_ACTUAL_300_PLAN_FIXTURE_V1',provenance:'Existing synthetic actual-import Warehouse root; MOCK authority/storage, not native preparation',
  company:'NCT',businessLines:300,writeImages:901,key:manifest._id,digest:manifest.digest,memberId:manifest.memberId,
  requestId:manifest.requestId,baseGeneration:0,plan};
}
if(require.main===module)build().then(fixture=>{
 const target=path.join(__dirname,'native-plan-staging.fixture.json'),out=JSON.stringify(fixture)+'\n';
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==out)throw Error('Actual300 fixture drift');}
 else fs.writeFileSync(target,out);
 process.stdout.write('Actual300 plan fixture '+(process.argv.includes('--check')?'verified':'built')+';901 images; no native action\n');
}).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={build};
