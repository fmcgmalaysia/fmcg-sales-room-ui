'use strict';
const assert=require('node:assert/strict'),previous=require('../warehouse-operational-header-20261031/stage.cjs');
const build='20261031-purchase-allocation-origin-info-v1';
const old="      return [{id:allocation.sourceTaskId,quantity,po:source?.po||'',customerId:source?.customerId||'',kind:local?'PO':loans.length?'Borrowed':replenished?'Replenished':'Stock',repaid:loans.length>0&&loans.every(loan=>loan.outstanding===0),loans,at:allocation.at,by:allocation.by||''}];";
const replacement=`      const common={id:allocation.sourceTaskId,po:source?.po||'',customerId:source?.customerId||'',at:allocation.at,by:allocation.by||''},kind=local?'PO':replenished?'Replenished':'Stock';
      if(!loans.length)return [{...common,quantity,kind,repaid:false,loans:[]}];
      const origins=loans.map(loan=>({loan,origin:data.allocationOrigins?.loans?.find(row=>row.loanId===loan.id)}));
      const known=data.allocationOrigins?.known===true&&origins.every(({origin})=>origin?.known===true&&(!batchId||origin.batchKnown===true));
      const borrowed=known?origins.filter(({origin})=>!batchId||origin.borrowerBatchId===batchId).map(({loan,origin})=>({loan,repaid:origin.repaid,quantity:origin.sources.filter(row=>row.sourceTaskId===allocation.sourceTaskId).reduce((n,row)=>n+row.quantity,0)})):[];
      const total=borrowed.reduce((n,row)=>n+row.quantity,0);
      if(!known||!Number.isSafeInteger(total)||total<0||total>quantity)return [{...common,quantity,kind:'Source',repaid:false,loans}];
      return [...(quantity>total?[{...common,quantity:quantity-total,kind,repaid:false,loans:[]}]:[]),...borrowed.filter(row=>row.quantity>0).map(row=>({...common,quantity:row.quantity,kind:'Borrowed',repaid:row.repaid,loans:[row.loan]}))];`;
let cached;
function plan(){
 if(cached)return cached;const baseline=new Map(previous.plan().assets),assets=new Map(baseline),file='purchase-live/task-info.js',source=assets.get(file).toString();assert.equal(source.split(old).length,2);assets.set(file,Buffer.from(source.replace(old,()=>replacement)));
 const index=assets.get('purchase-live/index.html').toString().replace(/(<meta name="build" content=")[^"]+/,'$1'+build).replace(/(task-info\.js\?v=)[^"&]+/,'$1'+build);assets.set('purchase-live/index.html',Buffer.from(index));
 return cached={assets,baseline,build,changed:[...assets].filter(([file,bytes])=>!bytes.equals(baseline.get(file))).map(([file])=>file)};
}
module.exports={plan,build};
