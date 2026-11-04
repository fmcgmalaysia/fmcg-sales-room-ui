'use strict';
// Diagnostic runner, not a green release gate: unresolved failures retain exit code 1.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),args=process.argv.slice(2);
if(args.includes('--help')){console.log('node integration/tests/run-regression-reconciliation.cjs --assets <published-c844f39-folder> --output <new-evidence-folder> [--verify-assets]');process.exit(0);}
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const assets=option('--assets');
if(!assets)throw Error('Supply the exact published Purchase asset cohort; do not substitute checkout age.');
const manifest=JSON.parse(fs.readFileSync(path.join(assets,'purchase-read-efficiency-release.json'),'utf8'));
if(manifest.build!=='20261101-purchase-read-efficiency-v1'||manifest.resources.length!==99)throw Error('Unexpected published asset cohort.');
for(const row of manifest.resources){
 const bytes=fs.readFileSync(path.join(assets,row.path));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('Published asset differs: '+row.path);
}
if(args.includes('--verify-assets')){console.log('99 published resources match the supplied release manifest.');process.exit(0);}
const output=option('--output');if(!output||fs.existsSync(output))throw Error('Use a new output folder to preserve earlier evidence.');
fs.mkdirSync(output,{recursive:true});
const test=name=>'integration/tests/'+name+'.test.cjs';
const comparable=['purchase-live-ui','purchase-confirmed-readback','master-workflow-scenarios','receiving-task-completion','stock-current-exception-root','stock-current-intake-loaded-composition','stock-current-legacy-stock-read','stock-current-legacy-warehouse-save','stock-current-read-web','stock-current-receipt-allocation-actor','stock-current-warehouse-preparation-save','stock-current-warehouse-receipt-web'];
const protectedChecks=['purchase-read-efficiency','customer-allocation-plan','customer-allocation-save','customer-allocation-batch-binding','shortload-resolution','company-stock-list','loaded-receipt-allocation-composition','allocation-completed-recovery','po-revision-authority','purchase-payment-message','purchase-document-policy','account-settlement','customer-fulfilment'];
const receiving=['--require','./integration/tests/production-cohort-preload.cjs'];
function run(name,files,ui){
 const env={...process.env};
 // Stage-based tests build their own exact cohort. Applying the UI read shim there
 // would patch already-patched historical assets and manufacture unrelated failures.
 if(ui){env.PURCHASE_TEST_ASSETS=path.resolve(assets);env.PURCHASE_UI_BASELINE=path.join(env.PURCHASE_TEST_ASSETS,'purchase-live/app.js');env.PURCHASE_CONFIRMED_READBACK_BASELINE=env.PURCHASE_UI_BASELINE;}
 const result=spawnSync(process.execPath,[...receiving,...(ui?['--require','./integration/prototypes/purchase-read-efficiency-20261101/test-assets.cjs']:[]),'--test-reporter=spec','--test',...files.map(test)],{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});
 fs.writeFileSync(path.join(output,name+'.txt'),(result.stdout||'')+(result.stderr||''));
 if(result.error)throw result.error;
 const all=(result.stdout||'')+(result.stderr||''),number=key=>Number(all.match(new RegExp('(?:ℹ |# )'+key+' (\\d+)'))?.[1]??NaN);
 return {tests:number('tests'),pass:number('pass'),fail:number('fail'),skipped:number('skipped'),exitCode:result.status};
}
const summary={comparable:run('comparable',comparable,true),protected:run('protected',protectedChecks,false),scope:'No production writes or browser operations. Original13 unresolved checks are retained, not skipped.'};
fs.writeFileSync(path.join(output,'SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
process.exitCode=summary.comparable.exitCode||summary.protected.exitCode||0;
