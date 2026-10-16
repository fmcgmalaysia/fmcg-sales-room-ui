const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',insertAdjacentHTML(_,html){this.innerHTML+=html;},querySelector(selector){return node(key+selector);}});return nodes.get(key);};
 const document={activeElement:null,querySelector:selector=>selector.includes('data-allocation-extra=')?null:node(selector)},ctx={window:{},document};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/supplier-allocation.js'),'utf8'),ctx);
 const task=(id,ord)=>({id,customerId:'C',barcode:'BAR-'+id,ord,ea:24,supplierId:'S',editVersion:'V1',lpPc:2,lpCtn:48,disc1:0,disc2:0,disc3:0,procurement:{totalCtn:null,revision:'',draftPlan:true}});
 const workspace={company:'NCT',customers:[{id:'C',shortName:'CUSTOMER'}],suppliers:[{id:'S',shortName:'SUPPLIER'},{id:'S2',shortName:'SUPPLIER 2'}],tasks:[task('A',100),task('B',80)]},submissions=[],messages=[],pos=[];let pending=null;
 const modal={open:true,classList:{add(){},contains:()=>true},close(){this.open=false;}};
 const ui=ctx.window.purchaseSupplierAllocation.create({workspace:()=>workspace,company:()=>workspace.company,rowLabel:id=>id==='A'?'ROW 050':'ROW 051',esc:x=>String(x??''),num:x=>Number.isFinite(x)?x.toFixed(2):'—',dialog(){modal.open=true;},modal:()=>modal,cache(){},status:(text,error)=>messages.push({text,error}),savePending:()=>pending,atOrigin:()=>true,mutate(_,request){submissions.push(request);},openPo:id=>pos.push(id),confirm:()=>true,handIcon:()=>''});
 const edit=(id,field,value)=>ui.edit({target:{value,dataset:{allocationField:field},closest:()=>({dataset:{allocationRow:id}})}});
 return {node,ui,workspace,submissions,messages,pos,edit,planner:ctx.window.purchaseSupplierAllocation,setPending:value=>pending=value};
}

function controls(f){const row='[data-allocation-row="A"]';return {save:f.node(row+'[data-allocation-save]'),po:f.node(row+'[data-allocation-po]')};}
function waiting(f){const c=controls(f);assert.equal(c.save.className,'allocation-save needs-save');assert.equal(c.po.className,'allocation-po pending awaiting-save');}
function saved(f){const c=controls(f);assert.equal(c.save.className,'allocation-save');assert.equal(c.save.disabled,true);assert.equal(c.save.textContent,'已保存');assert.equal(c.po.className,'allocation-po pending');}
test('next action changes from save to PO only after matching saved workspace, then returns to save on edit',()=>{
 const f=fixture();f.ui.open('A');waiting(f);assert.match(f.node('#allocationRows').innerHTML,/allocation-po pending awaiting-save[^>]+disabled>P.O./);
 f.edit('A','qty','60');waiting(f);f.ui.click({dataset:{allocationSave:'A'}});waiting(f);assert.equal(controls(f).save.disabled,true);assert.equal(f.submissions.length,1);
 const request=f.submissions[0];f.ui.receipt(request,{ok:true});waiting(f);
 const root=f.workspace.tasks[0];root.editVersion='V2';root.procurement={totalCtn:60,revision:'P2',draftPlan:true,costing:request.input.costing};f.ui.receivedWorkspace();saved(f);
 f.ui.click({dataset:{allocationPo:'A'}});assert.deepEqual(f.pos,['A']);assert.equal(f.submissions.length,1);
 f.edit('A','qty','55');waiting(f);f.ui.click({dataset:{allocationPo:'A'}});assert.deepEqual(f.pos,['A']);assert.equal(f.submissions.length,1);
 root.po='NCT-PO-000123';f.edit('A','qty','54');assert.equal(controls(f).po.className,'allocation-po complete');assert.equal(controls(f).save.className,'allocation-save needs-save');
});
test('failed, ambiguous and mismatching readback leave save orange and PO white without retrying',()=>{
 for(const outcome of ['rejected','pending','mismatch']){
 const f=fixture();f.ui.open('A');f.edit('A','qty','60');f.ui.click({dataset:{allocationSave:'A'}});const request=f.submissions[0];
 if(outcome==='mismatch'){f.ui.receipt(request,{ok:true});f.ui.receivedWorkspace();}else f.ui.rejected(request,'Not confirmed',outcome==='rejected');
 waiting(f);assert.equal(f.submissions.length,1);assert.equal(f.workspace.tasks[0].procurement.revision,'');
 }
});
