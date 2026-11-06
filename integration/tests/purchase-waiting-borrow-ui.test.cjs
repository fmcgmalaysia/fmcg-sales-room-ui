const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),load=require('./load-master-module.cjs');
test('fully planned WAIT keeps the original orange ALLOC action; fully received coverage has no extra action',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../purchase-live/active-layout.js'),'utf8').replace(/\r\n/g,'\n');
 const start=source.indexOf("  for(const row of table.tBodies[0]?.rows||[]){\n   if(!row.matches('[data-id],[data-split-parent]'))continue;");
 const end=source.indexOf('  window.purchaseTaskInfo?.decorate(table);',start);assert.ok(start>=0&&end>start);
 function run(waiting){const children=[],cell={dataset:{},textContent:'200',replaceChildren(){this.textContent='';},append(el){children.push(el);}},row={dataset:{layoutGap:'0',layoutWaiting:String(waiting)},matches:()=>true,querySelector:()=>cell,hasAttribute:()=>true,getAttribute:key=>key==='data-layout-intent'?'200':key==='data-id'?'A':null};
 const document={createElement:()=>({style:{},attrs:{},classList:{add(){}},setAttribute(key,value){this.attrs[key]=value;}})};
 vm.runInNewContext(source.slice(start,end),{table:{tBodies:[{rows:[row]}]},document,count:()=>200});return {children,cell};}
 const waiting=run(50);assert.equal(waiting.children.length,1);assert.equal(waiting.children[0].attrs['data-customer-allocate'],'A');assert.equal(waiting.children[0].style.color,'#F58A00');
 const received=run(0);assert.equal(received.children.length,0);assert.equal(received.cell.textContent,'200');
});
function fixture(){
 const product={company:'NCT',barcode:'SKU',packing:'12 x1',ea:12},context={company:'NCT',version:'V',loans:[],tasks:[{...product,id:'A',customerId:'CA',demand:200,batches:[{id:'WHOLE',quantity:200,waiting:50}]},{...product,id:'B',customerId:'CB',demand:300,batches:[{id:'WHOLE',quantity:300}]}],sources:[{...product,id:'A',received:true,usableReceived:150,availablePhysical:150,targets:[{taskId:'A',quantity:150}]},{...product,id:'B',received:true,usableReceived:250,availablePhysical:250,targets:[{taskId:'B',quantity:250}]}]};
 const dialogs=[],saves=[],errors=[],elements={'#borrowCustomer':{value:'B'},'#dialogError':{textContent:''}},window={customerAllocationPlan:load('customerAllocationPlan.js')};let blocked=false;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/customer-allocation.js'),'utf8'),{window,document:{querySelector:key=>elements[key]}});
 const ui=window.purchaseCustomerAllocation.create({workspace:()=>({allocationContext:context,tasks:[{id:'A',name:'Synthetic AJAX',packing:'12 x1'}],customers:[{id:'CA',name:'Customer A'},{id:'CB',name:'Customer B'}]}),dialog:(...args)=>dialogs.push(args),esc:String,quantity:String,mutate:(...args)=>{saves.push(args);blocked=true;},status:(...args)=>errors.push(args),blocked:()=>blocked});
 const click=id=>ui.handle({id,dataset:{}});return {ui,click,dialogs,saves,errors,elements,context};
}
test('waiting coverage keeps normal view; early choice previews150, short50, lender selection and one original save',()=>{
 const f=fixture();f.ui.open('A');assert.match(f.dialogs.at(-1)[2],/chooseEarlyAllocation/);assert.doesNotMatch(f.dialogs.at(-1)[2],/id="chooseCustomerBorrow"/);assert.equal(f.saves.length,0);
 f.click('chooseEarlyAllocation');assert.match(f.dialogs.at(-1)[2],/150 CTN/);assert.match(f.dialogs.at(-1)[2],/id="chooseCustomerBorrow"/);assert.equal(f.saves.length,0);
 f.click('chooseCustomerBorrow');assert.match(f.dialogs.at(-1)[2],/Customer B/);assert.match(f.dialogs.at(-1)[2],/50 CTN/);f.click('confirmCustomerBorrow');f.click('confirmCustomerBorrow');
 assert.equal(f.saves.length,1);assert.equal(f.saves[0][1].input.fulfilNow,true);assert.equal(f.saves[0][1].input.borrow,true);assert.equal(f.saves[0][1].input.version,'V');assert.equal(f.saves[0][1].input.donorTaskId,'B');
});
test('early fulfilment uses free20 first, then only borrows the missing30',()=>{
 const f=fixture(),source=f.context.sources[0];f.context.sources.push({...source,id:'FREE',usableReceived:20,availablePhysical:20,targets:[]});
 f.ui.open('A');f.click('chooseEarlyAllocation');f.click('chooseCustomerBorrow');assert.match(f.dialogs.at(-1)[2],/本次借货 <strong>30 CTN/);f.click('confirmCustomerBorrow');assert.equal(f.saves.length,1);
 const result=load('customerAllocationPlan.js').planCustomerAllocation(f.context,f.saves[0][1].input);assert.equal(result.loan.quantity,30);assert.equal(result.assigned,200);
});
test('early free stock allocation can confirm without a loan; reopen defaults to waiting',()=>{
 const f=fixture(),source=f.context.sources[0];f.context.sources.push({...source,id:'FREE',usableReceived:50,availablePhysical:50,targets:[]});
 f.ui.open('A');f.click('chooseEarlyAllocation');assert.match(f.dialogs.at(-1)[3],/confirmCustomerAllocation/);f.click('confirmCustomerAllocation');assert.equal(f.saves[0][1].input.borrow,false);
 const g=fixture();g.ui.open('A');g.click('chooseEarlyAllocation');g.ui.open('A');assert.match(g.dialogs.at(-1)[2],/chooseEarlyAllocation/);assert.doesNotMatch(g.dialogs.at(-1)[2],/id="chooseCustomerBorrow"/);
});
