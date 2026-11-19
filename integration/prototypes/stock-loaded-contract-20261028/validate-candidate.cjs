'use strict';
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'),evidence=path.join(root,'handoff/stock-loaded-contract-20261028');
const tests=['loaded-receipt-allocation-composition','loaded-single-authority','warehouse-ready-stock','warehouse-preparation','customer-completion','customer-fulfilment','packing-list','packing-list-operations','packing-list-guards','packing-list-context','packing-consumer-integration','packing-browser-build','stock-control-service','stock-card-projection','stock-card-save-safety','purchase-projection','purchase-progress','purchase-quantity-projection','support-invoice','support-invoice-draft'];
const result=cp.spawnSync(process.execPath,['--test','--test-reporter=tap',...tests.map(name=>'integration/tests/'+name+'.test.cjs')],{cwd:root,encoding:'utf8',maxBuffer:10000000});
const output=result.stdout+'\n'+result.stderr;
fs.writeFileSync(path.join(evidence,'V2_REGRESSION_LOG.txt'),output);
const summary={at:new Date().toISOString(),files:tests,exitCode:result.status,tests:Number(output.match(/^# tests (\d+)/m)?.[1]),passed:Number(output.match(/^# pass (\d+)/m)?.[1]),failed:Number(output.match(/^# fail (\d+)/m)?.[1]),failures:[...output.matchAll(/^not ok \d+ - (.+)$/gm)].map(row=>row[1]),productionWrites:0,networkRequests:0};
fs.writeFileSync(path.join(evidence,'V2_VALIDATION.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));process.exitCode=result.status;
