'use strict';
const assert=require('node:assert/strict'),previous=require('../purchase-allocation-origin-info-20261031/stage.cjs');
const build='20261031-payment-request-reconciliation-labels-v1';
function once(text,from,to){assert.equal(text.split(from).length,2);return text.replace(from,()=>to);}
let cached;
function plan(){
 if(cached)return cached;const baseline=new Map(previous.plan().assets),assets=new Map(baseline);
 assets.set('purchase-live/app.js',Buffer.from(once(assets.get('purchase-live/app.js').toString(),"label:'Fully Paid',tone:'complete'","label:settled.credit>0?'Request Settled':'Request Paid',tone:'complete'")));
 assets.set('account-room/payment-layout.js',Buffer.from(once(assets.get('account-room/payment-layout.js').toString(),"supplierView?'Payable':view==='payments'","supplierView?(Number.isSafeInteger(a.requested)?'Payable':'Payable pending review'):view==='payments'")));
 for(const [file,script]of [['purchase-live/index.html','app.js'],['account-room/index.html','payment-layout.js']]){
  let text=assets.get(file).toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build);const old=text.match(new RegExp(script.replace('.','\\.')+'\\?v=[^"&]+'))?.[0];assert(old);text=once(text,old,script+'?v='+build);assets.set(file,Buffer.from(text));
 }
 return cached={assets,baseline,build,changed:[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file)};
}
module.exports={plan,build};
