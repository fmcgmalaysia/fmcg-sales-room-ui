const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{inspectInstall,definition}=require('../prototypes/stock-current-state/build-current-install-manifest.cjs');
const {WRITERS}=require('../prototypes/stock-current-state/stock-admission.cjs'),folder=path.join(__dirname,'../prototypes/stock-current-state');
test('explicit two-system installation review links actual existing routes and all paired exports, without activation evidence',()=>{
 const report=inspectInstall();assert.deepEqual(report.errors,[]);assert.equal(report.install.length,40);assert.equal(report.modules.length,100);
 assert.equal(report.candidateOnly,true);assert.equal(report.activationAllowed,false);assert.equal(report.verifiedCoverage,false);
 assert.deepEqual(Object.keys(report.writerReview).sort(),[...WRITERS].sort());assert.equal(Object.values(report.writerReview).every(row=>row.verified===false),true);
 const source=report.install.filter(row=>row.system==='FMCGMALAYSIA');assert.deepEqual(source.map(row=>row.target),['nctSubmissionDelivery.js','onboarding.web.js']);
 const onboarding=report.modules.find(row=>row.system==='FMCGMALAYSIA'&&row.target==='onboarding.web.js');
 assert.ok(onboarding.source.endsWith('source-onboarding.candidate.js'));
 assert.ok(onboarding.exports.includes('saveSalesRoomOrderPlanning'));
 assert.ok(onboarding.dependencies.includes('FMCGMALAYSIA/masterFulfilmentClient.js'));
 assert.ok(onboarding.dependencies.includes('FMCGMALAYSIA/nctSalesIntake.js'));
 for(const item of report.install){assert.match(item.sha256,/^[a-f0-9]{64}$/);assert.equal(item.kind==='PATCH',item.beforeSha256!==null);}
 const module=(name)=>report.modules.find(row=>row.system==='MASTER'&&row.target===name);
 assert.equal(module('http-functions.js').dependencies.includes('MASTER/purchaseQuantityRead.js'),true);
 assert.equal(module('stockCurrentPacking.js').dependencies.includes('MASTER/packingListOperations.js'),true);
 assert.equal(module('packingListOperations.js').exports.includes('PACKING_CURRENT_DAMAGE_READ_VERSION'),true);
 assert.equal(module('stockControl.web.js').source.endsWith('stockControl.web.candidate.js'),true);
 assert.ok(report.emptyCoverageRoots.length>=9);assert.ok(report.externalDependencies.includes('@wix/data'));
});
test('missing original reader candidate or paired model cannot produce a valid install packet',()=>{
 const missingSource=inspectInstall({entries:definition().filter(row=>row.system!=='FMCGMALAYSIA'||row.target!=='onboarding.web.js')});
 assert.ok(missingSource.errors.includes('Required candidate omitted FMCGMALAYSIA/onboarding.web.js'));
 for(const target of ['stockControl.web.js','purchaseQuantityRead.js','packingListModel.js','packingListOperations.js','stockCurrentCommands.js']){
  const report=inspectInstall({entries:definition().filter(row=>row.target!==target)});assert.ok(report.errors.some(error=>error.includes('Required candidate omitted MASTER/'+target)));
  if(target.startsWith('packingList'))assert.ok(report.errors.some(error=>error.includes('Missing named export')&&error.includes(target)));
 }
});
test('wrong-system aliases, duplicate targets and arbitrary paths are refused; named-export and premature coverage drift is visible',()=>{
 const rows=definition();assert.throws(()=>inspectInstall({entries:[...rows,rows[0]]}),/Duplicate/);
 assert.throws(()=>inspectInstall({entries:[{...rows[0],system:'OTHER'}]}),/Explicit/);
 assert.throws(()=>inspectInstall({entries:[{...rows[0],source:'../secret.js'}]}),/Explicit/);
 const report=inspectInstall({readFile:file=>{const source=fs.readFileSync(file,'utf8');
  if(file.endsWith('stockCurrentBorrow.web.js'))return source.replace(/const writerCoverage\s*=\s*Object\.freeze\(\{\}\);/,"const writerCoverage=Object.freeze({RECEIPT:{verified:true,build:'FORGED'}});");
  if(file.endsWith('packingListModel.candidate.js'))return source.replace('export const PACKING_CURRENT_DAMAGE_VERSION','const PACKING_CURRENT_DAMAGE_VERSION');return source;}});
 assert.ok(report.errors.some(error=>error.includes('Unreviewed writer coverage activation')));assert.ok(report.errors.some(error=>error.includes('Missing named export')&&error.includes('PACKING_CURRENT_DAMAGE_VERSION')));
});
test('review hashes and import graph are reproducible and contain no schema/permission/deployment mutation',()=>{
 assert.match(execFileSync(process.execPath,[path.join(folder,'build-current-install-manifest.cjs'),'--check'],{encoding:'utf8'}),/verified.*NOT activation or deployment/);
 const persisted=JSON.parse(fs.readFileSync(path.join(folder,'current-install-manifest.json'),'utf8'));assert.deepEqual(persisted,inspectInstall());
 const source=fs.readFileSync(path.join(folder,'build-current-install-manifest.cjs'),'utf8');assert.doesNotMatch(source,/execFile|fetch\(|items\.(insert|patch|remove)|automation_update|verified:\s*true/);
});
