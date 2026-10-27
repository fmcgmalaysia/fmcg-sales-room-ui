'use strict';
// Reuse the existing real-backend fixture setup; only the scheduling and UI scenarios differ.
const fs=require('node:fs'),path=require('node:path');
const fixture=fs.readFileSync(path.join(__dirname,'../support-shipment-header-20261027/check-ui.cjs'),'utf8');
let setup=fixture.slice(0,fixture.indexOf(" await page.goto('https://fmcg999.wixstudio.com/shipment-fixture');"));
function replace(old,next){if(!setup.includes(old))throw Error('Fixture setup changed: '+old.slice(0,70));setup=setup.replace(old,next);}
replace('const calls=[],pendingReads=[];',"const calls=[],allCalls=[],pendingReads=[],delayedSaves=[];let blockReads=false,holdNextSave=false,failNextSave=false;");
replace('const bridge=async m=>{const company=',"const bridge=async m=>{allCalls.push(m);if(blockReads&&m.type.endsWith('_READ_REQUEST'))await new Promise(resolve=>pendingReads.push(resolve));const company=");
replace('}return JSON.parse(JSON.stringify(result));};',"}if(m.type==='SUPPORT_BOOKING_SAVE_REQUEST'){if(holdNextSave){holdNextSave=false;await new Promise(resolve=>delayedSaves.push(resolve));}if(failNextSave){failNextSave=false;throw Error('Synthetic response lost after commit. Retry the same save.');}}return JSON.parse(JSON.stringify(result));};");
replace('const rel=new URL(url).pathname.slice',"const rel=new URL(url).pathname.slice");
replace('local=path.join(candidate,rel)',"local=path.join(process.env.MASTER_BASELINE_DIR&&rel==='support-room/workroom.js'?process.env.MASTER_BASELINE_DIR:candidate,rel)");
const scenarios=String.raw`
 await page.goto('https://fmcg999.wixstudio.com/shipment-fixture');const frame=page.frameLocator('iframe');await frame.locator('[data-customer-orders="C1"]').click();blockReads=true;
 const initialReads=allCalls.filter(m=>m.type.endsWith('_READ_REQUEST')).length;
 await frame.locator('[data-desk-task="T1"]').selectOption('1');
 if(process.env.MASTER_BASELINE_DIR){
   await frame.locator('[data-desk-task="T1"]:disabled').waitFor();
   for(let n=0;n<4;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
   assert.equal(allCalls.filter(m=>m.type.endsWith('_READ_REQUEST')).length-initialReads,6);
   console.log(JSON.stringify({variant:'baseline',postSaveReads:6,nextDeskDisabled:true,realExternalRequests:0}));await browser.close();return;
 }
 await frame.locator('[data-desk-task="T1"]:not(:disabled) option[value="1"]:checked').waitFor({state:'attached'});
 assert.equal(allCalls.filter(m=>m.type.endsWith('_READ_REQUEST')).length,initialReads);
 await frame.locator('[data-desk-step="1"]').click();await frame.locator('[data-desk-references]').first().click();
 await frame.locator('#desk-so-number').fill('AUTO-SO-1');await frame.locator('#desk-po-number').fill('AUTO-PO-1');
 await frame.getByText('Saved 已保存',{exact:true}).waitFor();await frame.locator('#desk-references').screenshot({path:path.join(base,'CANDIDATE-autosave-references.png')});
 assert.equal(calls.filter(m=>m.input.action==='DESK_REFERENCES').length,1);
 const state=async()=>readSupportDesks((await f.context()).activity,'NCT')[0];
 assert.equal((await state()).references[0].soNo,'AUTO-SO-1');
 holdNextSave=true;await frame.locator('#desk-so-number').fill('AUTO-SO-2');await frame.locator('#desk-reference-save:disabled').waitFor();
 assert.equal(await frame.locator('#desk-so-number').isEnabled(),true,'Typing continues while the previous write is pending');
 await frame.locator('#desk-so-number').fill('AUTO-SO-3');await frame.locator('#desk-po-number').fill('AUTO-PO-3');
 await frame.locator('#company').selectOption('GHR');assert.equal(await frame.locator('#company').inputValue(),'NCT','Company cannot change beneath a queued save');
 assert.equal(delayedSaves.length,1);delayedSaves.shift()();await frame.getByText('Saved 已保存',{exact:true}).waitFor();
 assert.equal((await state()).references[0].soNo,'AUTO-SO-3');assert.equal((await state()).references[0].poNo,'AUTO-PO-3');
 assert.equal(calls.filter(m=>m.input.action==='DESK_REFERENCES').length,3);
 await frame.locator('#desk-po-number').fill('CLOSED-PO');await frame.locator('#desk-references footer [data-close]').click();
 await frame.getByText('CLOSED-PO',{exact:true}).waitFor();assert.equal((await state()).references[0].poNo,'CLOSED-PO');
 await frame.locator('[data-desk-references]').first().click();failNextSave=true;await frame.locator('#desk-so-number').fill('LOST-RECEIPT');
 await frame.getByText('Retry Save',{exact:true}).waitFor();const uncertain=calls.at(-1);assert.equal(await frame.locator('#desk-so-number').isEnabled(),true);
 await frame.locator('#desk-so-number').fill('AFTER-RETRY');await frame.locator('#desk-reference-save').click();await frame.locator('#desk-references').waitFor({state:'hidden'});
 const retried=calls.find((m,i)=>m.requestId===uncertain.requestId&&i>calls.indexOf(uncertain));assert(retried);assert.deepEqual(retried.input,uncertain.input);
 assert.equal((await state()).references[0].soNo,'AFTER-RETRY');
 assert(allCalls.every(m=>m.company==='NCT'));assert.equal(pendingReads.length,0);assert.equal(allCalls.filter(m=>m.type.endsWith('_READ_REQUEST')).length,initialReads);
 blockReads=false;await page.reload();await frame.locator('[data-customer-orders="C1"]').click();await frame.locator('[data-desk-step="1"]').click();
 await frame.getByText('AFTER-RETRY',{exact:true}).waitFor();assert.equal(await frame.locator('[data-retry-desk]').count(),0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({variant:'candidate',postSaveReads:0,nextDeskDisabled:false,autosaveWithoutButton:true,typingDuringSave:true,latestDraftQueued:true,closeFlush:true,companyGuard:true,retryRequestAndPayloadExact:true,reloadPersisted:true,businessQuantitiesUnchanged:f.tasks[0].ord===80&&f.tasks[1].ord===20,pageErrors:0,realExternalRequests:0}));await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
`;
// Compile as a local CommonJS test so relative fixture imports keep the same repository root.
const Module=require('node:module'),run=new Module(__filename,module);run.filename=__filename;run.paths=module.paths;run._compile(setup+scenarios,__filename);
