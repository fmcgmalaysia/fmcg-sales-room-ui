'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const fixture=fs.readFileSync(path.join(__dirname,'../support-shipment-header-20261027/check-ui.cjs'),'utf8');let setup=fixture.slice(0,fixture.indexOf(" await page.goto('https://fmcg999.wixstudio.com/shipment-fixture');"));
function change(a,b){if(setup.split(a).length!==2)throw Error('Exact fixture marker required');setup=setup.replace(a,b);}
change('const calls=[],pendingReads=[];',"customer.profile={revision:'PROFILE-1',preferredCurrency:'USD',destinationPortName:'SOUTHAMPTON'};const calls=[],pendingReads=[],deferredBookings=[],deferredDocuments=[],readTrace=[];let holdBooking=false,holdDocument=false;");
change('const bridge=async m=>{const company=',"const bridge=async m=>{if(m.type.endsWith('_READ_REQUEST'))readTrace.push(m.type);const company=");
change("case 'SUPPORT_BOOKING_SAVE_REQUEST':",`case 'SUPPORT_CUSTOMER_SAVE_REQUEST':calls.push(m);Object.assign(customer.profile,m.input.patch,{revision:'PROFILE-2'});result={company,requestId:m.requestId,customerId:customer.id,saved:true};break;
 case 'SUPPORT_BOOKING_SAVE_REQUEST':`);
change('}return JSON.parse(JSON.stringify(result));};',"}result=JSON.parse(JSON.stringify(result));if(holdBooking&&m.type==='SUPPORT_BOOKING_READ_REQUEST'){holdBooking=false;await new Promise(resolve=>deferredBookings.push(resolve));}if(holdDocument&&m.type==='SUPPORT_DOCUMENT_READ_REQUEST'){holdDocument=false;await new Promise(resolve=>deferredDocuments.push(resolve));}return result;};");
const scenarios=String.raw`
 await page.goto('https://fmcg999.wixstudio.com/shipment-fixture');const frame=page.frameLocator('iframe');await frame.locator('[data-customer-orders="C1"]').click();await frame.locator('[data-desk-task="T1"]').selectOption('1');await frame.locator('[data-desk-task="T1"]:not(:disabled) option[value="1"]:checked').waitFor({state:'attached'});await frame.locator('[data-desk-step="1"]').click();
 holdBooking=true;await frame.locator('html').evaluate(e=>e.ownerDocument.querySelector('#refresh').click());
 for(let n=0;n<4;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));assert.equal(deferredBookings.length,1);
 await frame.locator('[data-desk-references]').first().click();await frame.locator('#desk-so-number').fill('RACE-SO');await frame.getByText('Saved 已保存',{exact:true}).waitFor();await frame.locator('#desk-references footer [data-close]').click();
 deferredBookings.shift()();await frame.locator('#refresh:not(:disabled)').waitFor();assert.match(await frame.locator('.shipment-details').innerText(),/RACE-SO/);
 holdDocument=true;const docsBefore=readTrace.filter(type=>type==='SUPPORT_DOCUMENT_READ_REQUEST').length;
 await frame.locator('[data-desk-doc="$ "]'.replace('$ ','$')).click();await frame.locator('#document-reference').fill('RACE-TT');await frame.locator('#document-amount').fill('100');await frame.locator('#document-deposit').check();await frame.locator('#document-file').setInputFiles({name:'proof.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n synthetic')});await frame.locator('#document-upload').click();await frame.locator('#documents').waitFor({state:'hidden'});
 for(let n=0;n<3;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));assert.equal(deferredDocuments.length,1);
 await frame.getByRole('button',{name:'Customers',exact:true}).click();await frame.locator('[data-profile="C1"]').click();await frame.locator('[name="primaryEmail"]').fill('race@example.test');await frame.locator('#profile-save').click();await frame.locator('#customer-profile').waitFor({state:'hidden'});await frame.locator('#refresh:not(:disabled)').waitFor();
 assert.equal(readTrace.filter(type=>type==='SUPPORT_DOCUMENT_READ_REQUEST').length-docsBefore,2,'The later partial load includes an earlier unfinished document refresh');
 await frame.locator('[data-customer-orders="C1"]').click();await frame.locator('[data-desk-step="1"]').click();assert.match(await frame.locator('.shipment-details').innerText(),/RACE-SO/);assert.match(await frame.locator('.shipment-deposit').innerText(),/USD 100.00/);
 deferredDocuments.shift()();for(let n=0;n<3;n++)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));assert.match(await frame.locator('.shipment-deposit').innerText(),/USD 100.00/);assert.match(await frame.locator('.shipment-details').innerText(),/RACE-SO/);
 assert.deepEqual(errors,[]);assert.equal(readSupportDocuments((await f.context()).activity,'NCT').length,1);console.log(JSON.stringify({oldBookingReadCannotUndoSavedReferences:true,overlappingPartialReadsPreserveBothSaves:true,lateDocumentReadIgnored:true,documentWrites:1,pageErrors:0,realExternalRequests:0}));await browser.close();
})().catch(error=>{console.error(error);process.exitCode=1;});
`;
const run=new Module(__filename,module);run.filename=__filename;run.paths=module.paths;run._compile(setup+scenarios,__filename);
