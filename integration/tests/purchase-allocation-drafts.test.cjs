const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',insertAdjacentHTML(_,html){this.innerHTML+=html;},querySelector(selector){return node(key+selector);}});return nodes.get(key);};
 const document={activeElement:null,querySelector:selector=>selector.includes('data-allocation-extra=')?null:node(selector)},ctx={window:{},document};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/supplier-allocation.js'),'utf8'),ctx);
 const task=(id,ord)=>({id,customerId:'C',barcode:'BAR-'+id,ord,ea:24,supplierId:'S',editVersion:'V1',lpPc:2,lpCtn:48,disc1:0,disc2:0,disc3:0,procurement:{totalCtn:null,revision:'',draftPlan:true}});
 const workspace={company:'NCT',customers:[{id:'C',shortName:'CUSTOMER'}],suppliers:[{id:'S',shortName:'SUPPLIER'}],tasks:[task('A',100),task('B',80)]},submissions=[],messages=[];let pending=null;
 const modal={open:true,classList:{add(){},contains:()=>true},close(){this.open=false;}};
 const ui=ctx.window.purchaseSupplierAllocation.create({workspace:()=>workspace,company:()=>workspace.company,rowLabel:id=>id==='A'?'ROW 050':'ROW 051',esc:x=>String(x??''),num:x=>Number.isFinite(x)?x.toFixed(2):'—',dialog(){modal.open=true;},modal:()=>modal,cache(){},status:(text,error)=>messages.push({text,error}),savePending:()=>pending,atOrigin:()=>true,mutate(_,request){submissions.push(request);},confirm:()=>true,handIcon:()=>''});
 const edit=(id,field,value)=>ui.edit({target:{value,dataset:{allocationField:field},closest:()=>({dataset:{allocationRow:id}})}});
 return {ui,workspace,submissions,messages,edit,setPending:value=>pending=value};
}

test('two product drafts survive repeated navigation and cache restore without any implicit save',()=>{
 const f=fixture();f.ui.open('A');f.edit('A','qty','60');const legacy=f.ui.serialize();f.ui.open('B');f.edit('B','qty','30');f.ui.open('A');
 let cache=f.ui.serialize();assert.equal(cache.rootId,'A');assert.equal(cache.rows[0].qty,'60');assert.equal(cache.parkedDrafts[0].rootId,'B');assert.equal(cache.parkedDrafts[0].rows[0].qty,'30');assert.equal(f.submissions.length,0);
 assert.ok(f.messages.some(m=>m.text.includes('ROW 050')&&m.text.includes('BAR-A')&&!m.error));
 const g=fixture();g.ui.restore(JSON.parse(JSON.stringify(cache)));g.ui.open('B');assert.equal(g.ui.serialize().rows[0].qty,'30');g.ui.open('A');assert.equal(g.ui.serialize().rows[0].qty,'60');assert.equal(g.submissions.length,0);
 const old=fixture();old.ui.restore(legacy);old.ui.open('A');assert.equal(old.ui.serialize().rows[0].qty,'60');
});

test('saving B submits only B and preserves A; in-flight identity cannot be switched or duplicated',()=>{
 const f=fixture();f.ui.open('A');f.edit('A','qty','60');f.ui.open('B');f.edit('B','qty','30');f.ui.click({id:'applySupplierAllocation',dataset:{}});
 assert.equal(f.submissions.length,1);const request=f.submissions[0];assert.equal(request.input.taskId,'B');assert.equal(request.input.totalCtn,30);
 f.ui.open('A');assert.equal(f.ui.serialize().rootId,'B');assert.equal(f.ui.serialize().parkedDrafts[0].rows[0].qty,'60');f.ui.click({id:'applySupplierAllocation',dataset:{}});assert.equal(f.submissions.length,1);
 const b=f.workspace.tasks[1];b.editVersion='V2';b.procurement={totalCtn:30,revision:'P2',draftPlan:true,costing:request.input.costing};f.ui.receipt(request,{ok:true});f.ui.receivedWorkspace();f.ui.open('A');
 assert.equal(f.ui.serialize().rows[0].qty,'60');assert.equal(f.submissions.length,1);assert.equal(f.workspace.tasks[0].procurement.totalCtn,null);
});

test('cancel only the current product; parked drafts remain restorable and foreign-company cache is ignored',()=>{
 const f=fixture();f.ui.open('A');f.edit('A','qty','60');f.ui.open('B');f.edit('B','qty','30');f.ui.click({id:'discardSupplierAllocation',dataset:{}});
 assert.equal(f.ui.dirty(),true);const cache=f.ui.serialize();assert.equal(cache.rows,undefined);assert.equal(cache.parkedDrafts.length,1);assert.equal(cache.parkedDrafts[0].rootId,'A');
 const g=fixture();g.ui.restore(cache);g.ui.open('A');assert.equal(g.ui.serialize().rows[0].qty,'60');g.ui.open('B');assert.equal(g.ui.serialize().rootId,undefined);assert.equal(g.ui.serialize().parkedDrafts[0].rows[0].qty,'60');
 const other=fixture();other.workspace.company='GHR';other.ui.restore(cache);assert.equal(other.ui.serialize(),null);assert.equal(other.ui.dirty(),false);
});
