const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const patch=require('../prototypes/purchase-compact-tasks-20261102/patch.cjs'),release=require('../prototypes/purchase-compact-tasks-20261102/stage.cjs').plan();
function run(tasks,entries,orders=[]){
 const data={tasks,customers:[{id:'A',name:'CUSTOMER ABC'},{id:'B',name:'CUSTOMER XYZ'}],suppliers:[]};
 const window={masterTaskSignals:{project:()=>({entries,categories:[]})}},context={window,data,poData:{orders},activeCustomer:'A',esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
 vm.runInNewContext(release.assets.get('purchase-live/dashboard.js').toString(),context);
 vm.runInNewContext(patch.helpers+';result=customerTaskCounts();html=compactTaskHeading();',context);
 return context;
}
const pending=id=>({id,action:'edit',owner:'PURCHASE',category:'todo',reason:'Pending'});
test('customer counters deduplicate sources and root, and red takes precedence over orange',()=>{
 const f=run([{id:'R',customerId:'A'},{id:'S1',customerId:'A',procurementSource:true,customerDemandTaskId:'R'},{id:'S2',customerId:'A',procurementSource:true,customerDemandTaskId:'R'},{id:'B1',customerId:'B'}],[pending('R'),pending('S1'),{...pending('S2'),category:'urgent'},pending('B1')]);
 assert.equal(f.result.get('A').pending,0);assert.equal(f.result.get('A').issues,1);assert.equal(f.result.get('B').pending,1);assert.equal(f.result.get('').pending,1);assert.equal(f.result.get('').issues,1);
});
test('receipt completed but Finance review pending remains orange, not a false red shortage',()=>{
 const task={id:'R',customerId:'A',warehouse:{hasPhysicalReceipt:true,accepted:200,issue:false},quantityCases:[{id:'Q',kind:'RECEIPT',financeRequired:true,owner:'ACCOUNT',quantity:0,planned:200,accepted:200}]};
 const f=run([task],[{id:'R',action:'quantity-case:Q',owner:'ACCOUNT',category:'urgent',reason:'Receiving issue 0'}]);
 assert.equal(f.result.get('A').pending,1);assert.equal(f.result.get('A').issues,0);
});
test('the same completed receipt remains red when its existing Finance facts show a real open issue',()=>{
 const task={id:'R',customerId:'A',warehouse:{hasPhysicalReceipt:true,accepted:200,issue:false},quantityCases:[{id:'Q',kind:'RECEIPT',financeRequired:true,owner:'ACCOUNT',quantity:0,planned:200,accepted:200}]};
 const f=run([task],[{id:'R',action:'quantity-case:Q',owner:'ACCOUNT',category:'urgent',reason:'Receiving issue 0'}],[{id:'P',taskIds:['R'],reviewRequired:true}]);
 assert.equal(f.result.get('A').issues,1);assert.equal(f.result.get('A').pending,0);
});
test('archived tasks and missing source parents are not turned into customer workload',()=>{
 const f=run([{id:'R',customerId:'A',archived:true},{id:'S',customerId:'B',procurementSource:true,customerDemandTaskId:'MISSING'}],[pending('R'),pending('S')]);
 assert.equal(f.result.get('').pending,0);assert.equal(f.result.get('').issues,0);
});
test('PO-level work maps to its existing task roots without duplicating one invoice action per source',()=>{
 const f=run([{id:'R',customerId:'A'},{id:'S',customerId:'A',procurementSource:true,customerDemandTaskId:'R'}],[{id:'P',action:'payment-proof',owner:'PURCHASE',category:'todo',reason:'Review payment proof'}],[{id:'P',taskIds:['R','S']}]);
 assert.equal(f.result.get('A').pending,1);
});
test('missing PO context displays unknown counts rather than false zero',()=>{
 const f=run([],[]);f.poData=null;vm.runInNewContext('html=compactTaskHeading()',f);assert.match(f.html,/Status not yet confirmed/);assert.match(f.html,/>—<\/span>/);assert.doesNotMatch(f.html,/aria-label="Pending 待办 0"/);
});
test('customer switching includes All Customers, names are escaped, and the header has no supplier filter or large cards',()=>{
 const f=run([{id:'R',customerId:'A'}],[pending('R')]);f.data.customers[0].name='<ABC>';vm.runInNewContext('html=compactTaskHeading()',f);
 assert.match(f.html,/data-customer=""/);assert.match(f.html,/data-customer="A"/);assert.match(f.html,/&lt;ABC>/);assert.match(f.html,/Purchase Tasks/);assert.doesNotMatch(f.html,/Pending P\.O\.|Incoming Alert|supplierFilter|ao-work-tabs/);
});
test('the candidate changes only five Purchase display resources and keeps all 96 others byte identical',()=>{
 assert.equal(release.assets.size,101);assert.deepEqual([...release.changed].sort(),['purchase-live/active-orders.css','purchase-live/app.js','purchase-live/dashboard.js','purchase-live/index.html','purchase-live/task-info.js']);
 for(const[file,bytes]of release.assets){if(!release.changed.includes(file))assert(bytes.equals(release.baseline.get(file)),file);if(file.endsWith('.js'))new vm.Script(bytes.toString(),{filename:file});}
 assert.match(release.assets.get('purchase-live/index.html').toString(),/data-view="stock">Stock Actions/);
 assert.match(release.assets.get('purchase-live/app.js').toString(),/else if\(view==='stock'\) app.innerHTML=expectedStock\(\)/);
 assert(release.assets.get('purchase-live/customer-allocation.js').equals(release.baseline.get('purchase-live/customer-allocation.js')));
 assert(release.assets.get('purchase-live/active-layout.js').equals(release.baseline.get('purchase-live/active-layout.js')));
});
function allocationCell({value=0,pending=true,unknown=false}={}){
 function element(tag){const e={tagName:tag.toUpperCase(),nodeType:1,className:'',dataset:{},childNodes:[],textContent:'',setAttribute(){},toggleAttribute(){},append(n){this.childNodes.push(n);},prepend(n){this.childNodes.unshift(n);}};e.classList={toggle(c,on){let a=e.className.split(' ').filter(Boolean).filter(v=>v!==c);if(on)a.push(c);e.className=a.join(' ');}};e.querySelectorAll=selector=>e.childNodes.filter(n=>selector.split(',').some(s=>{const classes=s.trim().split('.');return (!classes[0]||classes[0].toUpperCase()===n.tagName)&&classes.slice(1).every(c=>n.className.split(' ').includes(c));}));e.querySelector=selector=>e.querySelectorAll(selector)[0]||null;return e;}
 const allocated=element('td'),warning=element('button');warning.className='draft-allocation-warning';if(pending)allocated.append(warning);else if(!unknown){const span=element('span');span.className='purchase-info-total receipt-complete';allocated.append(span);}
 const row={dataset:{id:'A'},querySelector:s=>s==='.allocated-quantity'?allocated:null},table={tBodies:[{rows:[row]}]};
 const workspace={tasks:[{id:'A',barcode:'SKU',inc:null,supplyAllocation:{planned:unknown?null:value}}],allocations:unknown?[{sourceTaskId:'A',targets:[{taskId:'A',quantity:20}]}]:[],allocationContext:{loans:[]}};
 const scope={window:{},document:{getElementById:()=>null,createElement:element}};vm.runInNewContext(release.assets.get('purchase-live/task-info.js').toString(),scope);scope.window.purchaseTaskInfo.setContext(workspace);scope.window.purchaseTaskInfo.decorate(table);return {allocated,warning,workspace,scope};
}
test('orange zero and partial allocation keep their quantity and action but omit redundant Info',()=>{
 for(const value of [0,50]){const f=allocationCell({value});assert.equal(f.allocated.querySelector('small'),null);assert.equal(f.allocated.querySelector('.purchase-info-total').textContent,String(value));assert(f.allocated.childNodes.includes(f.warning));assert.equal(f.workspace.tasks[0].supplyAllocation.planned,value);}
});
test('blue allocation discrepancies and unknown source details retain their read-only Info',()=>{
 assert(allocationCell({value:50,pending:false}).allocated.querySelector('small'));assert(allocationCell({pending:false,unknown:true}).allocated.querySelector('small'));
 const before=release.baseline.get('purchase-live/task-info.js').toString(),after=release.assets.get('purchase-live/task-info.js').toString();assert.equal(after.replace("if(view.info&&!allocated.querySelector('.purchase-info-pending,.purchase-quantity-zero'))","if(view.info)"),before);
});
