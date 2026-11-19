const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),app=fs.readFileSync(path.join(root,'purchase-live/app.js'),'utf8');
function fn(name){const start=app.indexOf('  function '+name+'(');assert(start>=0,name);const next=app.slice(start+1).search(/\n  (?:async )?function /);assert(next>=0,'next function boundary');return app.slice(start,start+1+next);}
function fixture(row){const result=[],ctx={poData:{orders:[row],paymentRequestsConnected:true},view:'payments',esc:s=>String(s??''),purchaseCurrentDocuments:r=>r.documents||[],time:s=>s,formDialog:(...args)=>result.push(args),paymentMoney:n=>Number.isSafeInteger(n)?(n/100).toFixed(2):'—'};vm.createContext(ctx);for(const name of ['purchaseRequestEditable','followupStatusCell','purchaseOrderDialog'])vm.runInContext(fn(name),ctx);return {ctx,result};}
const pending=()=>({id:'PO',number:'NCT-PO-1',state:'ACTIVE',supplierName:'SUPPLIER',documents:[],procurementHandoff:{stage:'SUBMITTED',submitted:true,submission:{at:'2026-10-20',by:'LAW',paymentRequest:{purpose:'FULL',requestedCents:10000,cnCents:0,termDays:0}}}});
test('grey status is passive and only eligible Follow-up rows expose Editable',()=>{
 const row=pending(),{ctx}=fixture(row);let html=ctx.followupStatusCell(row,{tone:'waiting',label:'Waiting for Acc. response'});assert.match(html,/<span class="pf-status/);assert.doesNotMatch(html,/<span[^>]*data-po-request=/);assert.equal((html.match(/data-po-request-edit=/g)||[]).length,1);assert.match(html,/Editable 可编辑/);
 for(const mutate of [r=>r.procurementHandoff.ownership={},r=>r.procurementHandoff.stale=true,r=>r.paymentHandoff={review:{stage:'REVIEWING'}},r=>r.state='HISTORY']){const locked=pending();mutate(locked);assert.doesNotMatch(ctx.followupStatusCell(locked,{tone:'waiting',label:'Reviewing Docs'}),/data-po-request-edit/);}
});
test('submitted payment summary has no edit action and directs to Follow-up without changing the request',()=>{
 const row=pending(),before=JSON.stringify(row),{ctx,result}=fixture(row);ctx.purchaseOrderDialog('PO','PAYMENT_REQUEST');const args=result[0];assert.equal(args[3],'');assert.equal(args[4],'po-payment-readonly');assert.match(args[2],/Payment Follow-up/);assert.match(args[2],/财务接手或开始审核前/);assert.doesNotMatch(args[2],/<input|<select|data-po-request-edit/);assert.equal(JSON.stringify(row),before);
 ctx.view='po';ctx.purchaseOrderDialog('PO','PAYMENT_REQUEST_EDIT');assert.equal(result.length,1);
});
test('view-only dialog hides its footer, actual action colours are not globally inverted',()=>{
 const css=fs.readFileSync(path.join(root,'master-shared/action-affordances.css'),'utf8');assert.match(css,/po-payment-readonly \.dialogfoot\{display:none/);assert.match(css,/span\.gp\.gp-good\{background:#DBEAFE/);assert.match(css,/gp\.gp-low\{background:#E51B2B/);assert.match(css,/quantity-aligned>span\.qty-mismatch/);assert.doesNotMatch(css,/button\.quantity-case[^}]*background:#FFF0D6/);
 for(const file of ['purchase-live','account-room','warehouse-room','support-room'])assert.match(fs.readFileSync(path.join(root,file,'index.html'),'utf8'),/action-affordances\.css/);
});
test('packing uses the camera icon without altering prepared action or status icon',()=>{
 const source=fs.readFileSync(path.join(root,'warehouse-room/workroom.js'),'utf8');assert.match(source,/icon\(i.prepared\?'thumb':'camera'\)/);assert.match(source,/data-wh-pack=/);assert.match(source,/i.prepared\?'thumb':'box'/);assert.match(source,/ready&&action==='PACK'\?'PHOTOS':action/);
});
