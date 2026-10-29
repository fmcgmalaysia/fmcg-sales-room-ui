const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {quoteCustomerAllocation:quote,planCustomerAllocation:plan,planCustomerRepayment:repay}=load('customerAllocationPlan.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const product={company:'NCT',barcode:'SKU',packing:'72G x 48',ea:48};
function fixture(){return {company:'NCT',version:'v1',loans:[],tasks:[{...product,id:'A',customerId:'CA',demand:250,batches:[{id:'A1',quantity:250}]},{...product,id:'B',customerId:'CB',demand:280,batches:[{id:'B1',quantity:280}]}],sources:[{...product,id:'SA',received:true,usableReceived:200,availablePhysical:200,targets:[{taskId:'A',quantity:200}]},{...product,id:'SB',received:true,usableReceived:280,availablePhysical:280,targets:[{taskId:'B',quantity:280}]},{...product,id:'SF',received:true,usableReceived:20,availablePhysical:20,targets:[]}]};}
const input={version:'v1',taskId:'A',batchId:'A1',borrow:true,donorTaskId:'B'};
function apply(context,result){const next=copy(context);for(const change of result.changes)next.sources.find(row=>row.id===change.sourceTaskId).targets=copy(change.targets);if(result.loan){const loan={id:'LOAN1',...result.loan},at=next.loans.findIndex(row=>row.id===loan.id);if(at<0)next.loans.push(loan);else next.loans[at]=loan;}return next;}
function allocated(context,id){return context.sources.reduce((n,source)=>n+(source.targets.find(row=>row.taskId===id)?.quantity||0),0);}
test('A250 from own200, free20 and borrowed30 preserves physical500, source identities and original input',()=>{
 const f=fixture(),before=JSON.stringify(f),q=quote(f,input);assert.equal(q.assigned,200);assert.equal(q.useFree,20);assert.equal(q.shortage,30);assert.equal(q.freeQuantity,20);assert.equal(q.donors[0].quantity,280);
 const result=plan(f,input),next=apply(f,result);assert.equal(allocated(next,'A'),250);assert.equal(allocated(next,'B'),250);assert.equal(result.loan.outstanding,30);assert.equal(result.loan.sources[0].sourceTaskId,'SB');assert.equal(result.physicalDelta,0);assert.equal(next.sources.reduce((n,row)=>n+row.availablePhysical,0),500);assert.equal(JSON.stringify(f),before);
});
test('declining borrowing allocates220 only and creates no debt',()=>{const result=plan(fixture(),{...input,borrow:false}),next=apply(fixture(),result);assert.equal(allocated(next,'A'),220);assert.equal(allocated(next,'B'),280);assert.equal(result.shortage,30);assert.equal(result.loan,null);});
test('held, invoiced and archived donor stock cannot be offered or borrowed; no partial free-stock mutation',()=>{
 for(const key of ['held','invoiceLocked','archived']){const f=fixture();f.tasks[1][key]=true;const before=JSON.stringify(f);assert.equal(quote(f,input).donors.length,0);assert.throws(()=>plan(f,input),/insufficient/);assert.equal(JSON.stringify(f),before);}
 const f=fixture();f.tasks[0].held=true;assert.throws(()=>plan(f,input),/Desk/);
});
test('company, specification, receipt, quarantine and stale quote boundaries reject or exclude sources',()=>{
 const f=fixture();assert.throws(()=>plan(f,{...input,version:'old'}),/changed/);
 for(const key of ['received','blocked']){const f=fixture();f.sources[2][key]=key==='blocked';assert.equal(quote(f,input).useFree,0);}
 const other=fixture();other.sources[2].company='GHR';assert.throws(()=>plan(other,input),/source/);
 const incompatible=fixture();incompatible.sources[2].packing='OTHER';assert.equal(quote(incompatible,input).useFree,0);
});
test('borrowed stock cannot be lent onward while responsibility is outstanding',()=>{
 const f=apply(fixture(),plan(fixture(),input));f.tasks.push({...product,id:'C',customerId:'CC',demand:20,batches:[{id:'C1',quantity:20}]});assert.equal(quote(f,{taskId:'C',batchId:'C1'}).donors.some(row=>row.taskId==='A'),false);
});
test('a new receipt alone leaves debt30; explicit partial and final repayment allocate B exactly280',()=>{
 const f=apply(fixture(),plan(fixture(),input));f.sources.push({...product,id:'NEW',received:true,usableReceived:30,availablePhysical:30,targets:[]});assert.equal(f.loans[0].outstanding,30);
 const first=repay(f,{version:'v1',loanId:'LOAN1',quantity:10}),middle=apply(f,first);assert.equal(middle.loans[0].outstanding,20);assert.equal(allocated(middle,'B'),260);
 const last=repay(middle,{version:'v1',loanId:'LOAN1',quantity:20}),end=apply(middle,last);assert.equal(end.loans[0].outstanding,0);assert.equal(allocated(end,'B'),280);assert.equal(last.physicalDelta,0);assert.throws(()=>repay(end,{version:'v1',loanId:'LOAN1',quantity:1}),/repayment/);
});
test('repayment cannot invent stock, clear too much debt, or allocate beyond remaining lender demand',()=>{
 const f=apply(fixture(),plan(fixture(),input));assert.throws(()=>repay(f,{version:'v1',loanId:'LOAN1',quantity:30}),/Insufficient/);assert.throws(()=>repay(f,{version:'v1',loanId:'LOAN1',quantity:31}),/valid/);
 f.sources.push({...product,id:'NEW',received:true,usableReceived:50,availablePhysical:50,targets:[]});f.tasks[1].demand=260;f.tasks[1].batches[0].quantity=260;assert.throws(()=>repay(f,{version:'v1',loanId:'LOAN1',quantity:30}),/Insufficient/);
});
test('split A200+50 allocates only selected50, preserving first200 and lender batch ownership',()=>{
 const f=fixture();f.tasks[0].batches=[{id:'A1',quantity:200},{id:'A2',quantity:50}];f.sources[0].targets[0].batches=[{id:'A1',quantity:200}];const result=plan(f,{...input,batchId:'A2'});assert.equal(result.assigned,50);assert.equal(result.loan.borrowerBatchId,'A2');assert.equal(result.loan.sources[0].lenderBatchId,'B1');assert.equal(result.changes.some(row=>row.sourceTaskId==='SA'),false);
 delete f.sources[0].targets[0].batches;assert.throws(()=>plan(f,{...input,batchId:'A2'}),/batch ownership/);
});
test('unknown batches, duplicate targets and excess allocations fail before any plan',()=>{
 const f=fixture();assert.throws(()=>plan(f,{...input,batchId:'wrong'}),/batch/);f.sources[0].targets.push({taskId:'A',quantity:1});assert.throws(()=>plan(f,input),/source/);
});
