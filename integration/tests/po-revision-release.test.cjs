'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const p=require('../prototypes/po-revision-ui-20261030/stage.cjs').plan();
test('scoped release parses affected scripts and preserves 84 unrelated public resources',()=>{
 assert.equal(p.assets.size,94);assert.equal(p.changed.length,10);for(const[f,b]of p.assets)if(!p.changed.includes(f))assert.ok(b.equals(p.baseline.get(f)),f);
 for(const f of p.changed.filter(f=>f.endsWith('.js')))new vm.Script(p.assets.get(f).toString(),{filename:f});
 for(const f of ['purchase-live/index.html','account-room/index.html','support-room/workroom.html'])assert.match(p.assets.get(f).toString(),/20261030-po-revision-paid-lock-v1/);
 const app=p.assets.get('purchase-live/app.js').toString();assert.match(app,/confirmedSave/);assert.match(app,/if\(view==='room'\)/);assert.match(app,/documentStates/);assert.doesNotMatch(app,/const count=purchaseCurrentDocuments\(row\).*cnDue/);
 assert.match(p.assets.get('account-room/payment-layout.js').toString(),/documentStates/);assert.match(p.assets.get('account-room/settlement.js').toString(),/confirmCurrentProcurement/);
 assert.match(p.assets.get('support-room/workroom.js').toString(),/quantityPair/);
});
test('Review renders one revision for a multi-event save and uses recorded quantity, cents and CBM snapshots',()=>{
 const s=p.assets.get('purchase-live/app.js').toString(),body=s.slice(s.indexOf('  function reviewPoHistory('),s.indexOf('  function reviewPo(id)'));
 const ctx={esc:s=>String(s).replace(/</g,'&lt;'),num:n=>n.toFixed(2),shortTime:s=>s};vm.runInNewContext(body+';this.render=reviewPoHistory',ctx);
 const event={id:'E',requestId:'SAVE-1',result:'SAVED',commercialChanged:true,amendment:true,time:'2026-10-30T02:00:00Z',commercialBefore:{quantity:100,amountCents:100000,cbmPerCtn:.05},commercialAfter:{quantity:80,amountCents:80000,cbmPerCtn:.05}};
 const html=ctx.render([{id:'A',barcode:'BAR',name:'<script>',history:[event,{...event,id:'E2'}]}]);assert.match(html,/修改记录 · 1/);assert.equal(html.split('BAR').length,2);assert.match(html,/100 → 80/);assert.match(html,/1000\.00.*800\.00/);assert.match(html,/5\.000 → 4\.000/);assert.doesNotMatch(html,/<script>/);
});
