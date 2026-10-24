'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {buildIsolatedCohort}=require('../prototypes/stock-current-state/build-isolated-cohort.cjs');
const packet=buildIsolatedCohort(),source=packet.output.get('FMCGMALAYSIA/r2nctSalesIntake.js');

test('R2 Source elevates three conditional patches and only existing owner-checked temporary lock releases',()=>{
 assert.equal((source.match(/r2Auth\.elevate\(r2Items\.patch\)/g)||[]).length,3);
 assert.doesNotMatch(source,/elevate\(r2Items\.(insert|save|update|bulkInsert|query)/);
 assert.equal((source.match(/r2Auth\.elevate\(r2Items\.remove\)/g)||[]).length,1);
 assert.equal((source.match(/condition: \{ payload: \{ \$eq: current\.record\.payload \} \}/g)||[]).length,4);
 assert.match(source,/current\.value\.source !== 'NCT MASTER INTAKE'/);
 assert.match(source,/current\.value\.preparedBody\.submissionId !== submissionId/);
 assert.match(source,/Exact new R2 order-lock owner required/);
 const onboarding=packet.output.get('FMCGMALAYSIA/r2onboarding.web.js');
 assert.equal((onboarding.match(/r2Auth\.elevate\(r2Items\.remove\)/g)||[]).length,1);
 assert.match(onboarding,/payloadData\(held\)\?\.r2Owner === r2MutationOwner/);
 assert.match(onboarding,/condition: \{ payload: \{ \$eq: held\.payload \} \}/);
 assert.doesNotMatch(onboarding,/elevate\(r2Items\.(patch|insert|save|update|bulkInsert|query)/);
 assert.deepEqual(packet.report.retainedDependencies.map(row=>row.target).sort(),['catalogueSelection.web.js','fxRates.web.js','staffAuth.web.js']);
});

test('denied original customer authorization cannot construct elevated Source methods',async()=>{
 const deliveryText=packet.output.get('FMCGMALAYSIA/r2nctSubmissionDelivery.js');
 const createNctSubmissionDelivery=vm.runInNewContext(deliveryText.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';createNctSubmissionDelivery;',{Error,JSON});
 let elevations=0,writes=0;
 const wixData={query:()=>({eq(){return this;},limit(){return this;},find:async()=>({items:[]})})};
 const submit=vm.runInNewContext(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'')+';submitNctSalesOrder;',{
  Error,JSON,Date,Map,Number,String,Boolean,createNctSubmissionDelivery,wixData,
  r2Auth:{elevate:()=>{elevations++;throw Error('UNEXPECTED_ELEVATION');}},
  r2Items:{patch:()=>{writes++;throw Error('UNEXPECTED_WRITE');}},
 });
 await assert.rejects(submit({orderId:'O',staff:{staffId:'S',staffName:'Staff'},
  readPayloadRows:async()=>[{record:{_id:'O'},data:{orderId:'O',customerId:'C'}}],
  authorizeCustomer:async()=>{throw Error('ORIGINAL_CUSTOMER_DENIED');}}),/ORIGINAL_CUSTOMER_DENIED/);
 assert.equal(elevations,0);assert.equal(writes,0);
});

test('ordinary Source inputs remain free of R2 SDK authority imports',()=>{
 for(const row of packet.report.backend.filter(row=>row.system==='FMCGMALAYSIA'&&['nctSalesIntake.js','onboarding.web.js'].includes(row.originalTarget)))assert.doesNotMatch(fs.readFileSync(require('node:path').join(__dirname,'../..',row.source),'utf8'),/r2Auth|@wix\/essentials/);
});
