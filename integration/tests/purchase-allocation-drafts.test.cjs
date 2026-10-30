const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',insertAdjacentHTML(_,html){this.innerHTML+=html;},querySelector(selector){return node(key+selector);}});return nodes.get(key);};
 const document={activeElement:null,querySelector:selector=>selector.includes('data-allocation-extra=')?null:node(selector)},ctx={window:{},document};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/supplier-allocation.js'),'utf8'),ctx);
 const task=(id,ord)=>({id,customerId:'C',barcode:'BAR-'+id,ord,ea:24,supplierId:'S',editVersion:'V1',lpPc:2,lpCtn:48,disc1:0,disc2:0,disc3:0,procurement:{totalCtn:null,revision:'',draftPlan:true,transportMode:'SUPPLIER_DELIVER'}});
 const workspace={company:'NCT',customers:[{id:'C',shortName:'CUSTOMER'}],suppliers:[{id:'S',shortName:'SUPPLIER'},{id:'S2',shortName:'SUPPLIER 2'}],tasks:[task('A',100),task('B',80)]},submissions=[],messages=[],pos=[];let pending=null;
 const modal={open:true,classList:{add(){},contains:()=>true},close(){this.open=false;}};
 const ui=ctx.window.purchaseSupplierAllocation.create({workspace:()=>workspace,company:()=>workspace.company,rowLabel:id=>id==='A'?'ROW 050':'ROW 051',esc:x=>String(x??''),num:x=>Number.isFinite(x)?x.toFixed(2):'—',dialog(){modal.open=true;},modal:()=>modal,cache(){},status:(text,error)=>messages.push({text,error}),savePending:()=>pending,atOrigin:()=>true,mutate(_,request){submissions.push(request);},openPo:id=>pos.push(id),confirm:()=>true,handIcon:()=>''});
 const edit=(id,field,value)=>ui.edit({target:{value,dataset:{allocationField:field},closest:()=>({dataset:{allocationRow:id}})}});
 return {ui,workspace,submissions,messages,pos,edit,modal,node,planner:ctx.window.purchaseSupplierAllocation,setPending:value=>pending=value};
}

function twoSources(f,saved=false){
 const root=f.workspace.tasks[0];root.procurement=saved?{revision:'P1',totalCtn:40,draftPlan:true,transportMode:'SUPPLIER_DELIVER'}:{revision:'',totalCtn:null,draftPlan:true,transportMode:'SUPPLIER_DELIVER'};
 f.ui.open('A');const cache=f.ui.serialize()||{company:'NCT',rootId:'A',counter:1,reason:'',rows:[f.planner.rowDraft(root,'A')],dirty:true,running:false,current:null};
 cache.rows=cache.rows.filter(row=>row.taskId);const b=f.planner.rowDraft(null,'second');Object.assign(b,{supplierId:'S2',transportMode:'SUPPLIER_DELIVER',qty:'30',paid:'30',raw:{lpPc:'2.00',lpCtn:'48.00',disc1:'0.00',disc2:'0.00',disc3:'0.00'},originalRaw:{},manual:[]});cache.rows.push(b);cache.dirty=true;f.ui.restore(cache);f.ui.open('A');return root;
}

test('same product batches retain separate drafts, saved PO totals are read-only and new supply carries selected batch',()=>{
 const f=fixture(),root=f.workspace.tasks[0];root.ord=550;root.procurement={revision:'P1',totalCtn:400,draftPlan:false,transportMode:'SUPPLIER_DELIVER'};root.po='NCT-PO-ORIGINAL';root.batchAllocationVersion='BV';root.batchEntitlements=[{id:'PLAN|1',label:'This shipment',quantity:350,metrics:{committed:300},sources:[{id:'A',quantity:300}]},{id:'PLAN|2',label:'Next shipment',quantity:200,metrics:{committed:100},sources:[{id:'A',quantity:100}]}];
 f.ui.open('A','PLAN|1');assert.equal(f.edit('A','qty','999'),true);assert.equal(f.ui.serialize(),null);f.edit('draft-1','supplierId','S');f.edit('draft-1','qty','30');f.ui.open('A','PLAN|2');f.edit('draft-1','supplierId','S2');f.edit('draft-1','qty','70');let cache=f.ui.serialize();assert.equal(cache.rows.find(row=>row.key==='draft-1').qty,'70');assert.equal(cache.parkedDrafts[0].rows.find(row=>row.key==='draft-1').qty,'30');
 const g=fixture();g.workspace.tasks[0]=root;g.ui.restore(JSON.parse(JSON.stringify(cache)));g.ui.open('A','PLAN|1');cache=g.ui.serialize();assert.equal(cache.batchId,'PLAN|1');assert.equal(cache.rows.find(row=>row.key==='draft-1').qty,'30');assert.equal(cache.rows.find(row=>row.taskId==='A').qty,'400');
 for(const [key,value] of Object.entries({lpPc:'2',lpCtn:'48',disc1:'0',disc2:'0',disc3:'0',transportMode:'SUPPLIER_DELIVER'}))g.edit('draft-1',key,value);g.ui.click({dataset:{allocationSave:'draft-1'}});assert.equal(g.submissions.length,1);assert.equal(g.submissions[0].operation,'ADD_SOURCE');assert.equal(g.submissions[0].input.quantity,30);assert.equal(g.submissions[0].input.shipmentBatchId,'PLAN|1');assert.equal(g.submissions[0].input.shipmentBatchVersion,'BV');assert.equal(root.procurement.totalCtn,400);
});

test('initial barcode reference survives first supplier choice, but a new split and supplier replacement require their own cost',()=>{
 const f=fixture(),root=f.workspace.tasks[0];root.supplierId='';root.disc1=.123456;
 f.ui.open('A');f.edit('A','qty','100');let row=f.ui.serialize().rows[0];assert.equal(row.originalPrices.lpCtn,48);
 f.edit('A','supplierId','S');row=f.ui.serialize().rows[0];assert.equal(row.originalPrices.lpCtn,48);assert.equal(row.originalPrices.disc1,.123456);
 f.edit('A','qty','60');const split=f.ui.serialize().rows.find(item=>!item.taskId);assert.ok(split);assert.equal(split.originalPrices.lpCtn,null);
 f.edit(split.key,'supplierId','S2');assert.equal(f.ui.serialize().rows.find(item=>item.key===split.key).originalPrices.lpCtn,null);
 f.edit('A','supplierId','');f.edit('A','supplierId','S2');assert.equal(f.ui.serialize().rows[0].originalPrices.lpCtn,null);
 assert.equal(f.submissions.length,0);assert.equal(root.supplierId,'');assert.equal(root.lpCtn,48);
});
test('same product saves B first through PLAN, retains invalid A, restores unknown request and later adds A only',()=>{
 const f=fixture(),root=twoSources(f);f.edit('A','qty','bad');const before=f.ui.serialize().rows.find(row=>row.key==='A');
 f.ui.click({dataset:{allocationSave:'second'}});assert.equal(f.submissions.length,1);const request=f.submissions[0];assert.equal(request.operation,'PLAN');assert.equal(request.input.taskId,'A');assert.equal(request.input.supplierId,'S2');assert.equal(request.allocationInitializeRoot,true);
 f.ui.click({dataset:{allocationSave:'second'}});assert.equal(f.submissions.length,1);
 f.ui.rejected(request,'Receipt pending',false);assert.equal(f.edit('A','qty','should not change'),false);assert.equal(f.ui.serialize().rows.find(row=>row.key==='A').qty,before.qty);f.ui.click({dataset:{allocationSave:'second'}});assert.equal(f.submissions.length,1);
 const cache=f.ui.serialize(),g=fixture();g.setPending(request);g.ui.restore(cache);g.ui.click({dataset:{allocationSave:'second'}});assert.equal(g.submissions.length,0);
 root.supplierId='S2';root.editVersion='V2';root.procurement={revision:'P2',totalCtn:30,draftPlan:true,transportMode:'SUPPLIER_DELIVER',costing:request.input.costing};f.ui.receipt(request,{ok:true});f.ui.receivedWorkspace();
 const saved=f.ui.serialize();const a=saved.rows.find(row=>row.key==='A'),b=saved.rows.find(row=>row.key==='second');assert.equal(a.taskId,null);assert.equal(a.qty,before.qty);assert.deepEqual(a.raw,before.raw);assert.equal(b.taskId,'A');assert.equal(f.ui.dirty(),true);assert.equal(saved.saveKey,null);assert.match(saved.issue,/此来源已保存/);assert.equal(f.submissions.length,1);
 assert.equal(f.ui.sourceDirty('A'),false);f.ui.click({dataset:{allocationPo:'second'}});assert.deepEqual(f.pos,['A']);
 f.edit('A','qty','40');f.ui.click({dataset:{allocationSave:'A'}});assert.equal(f.submissions.length,2);assert.equal(f.submissions[1].operation,'ADD_SOURCE');assert.equal(f.submissions[1].input.supplierId,'S');assert.equal(f.submissions[1].input.quantity,40);assert.equal(root.ord,100);
});
test('single-source save validates B against saved A, not the invalid A draft; saved revision/receipt guards persist',()=>{
 const f=fixture();twoSources(f,true);f.edit('A','qty','bad');assert.equal(f.ui.sourceDirty('A'),true);f.ui.click({dataset:{allocationSave:'second'}});assert.equal(f.submissions.length,1);assert.equal(f.submissions[0].operation,'ADD_SOURCE');assert.equal(f.submissions[0].input.quantity,30);
 const g=fixture(),root=twoSources(g,true);root.warehouse={accepted:35};g.edit('A','qty','30');g.ui.click({dataset:{allocationSave:'A'}});assert.equal(g.submissions.length,0);assert.equal(g.ui.serialize().rows.find(row=>row.key==='A').qty,'30');
});

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
 const b=f.workspace.tasks[1];b.editVersion='V2';b.procurement={totalCtn:30,revision:'P2',draftPlan:true,transportMode:'SUPPLIER_DELIVER',costing:request.input.costing};f.ui.receipt(request,{ok:true});f.ui.receivedWorkspace();f.ui.open('A');
 assert.equal(f.ui.serialize().rows[0].qty,'60');assert.equal(f.submissions.length,1);assert.equal(f.workspace.tasks[0].procurement.totalCtn,null);
});

test('cancel only the current product; parked drafts remain restorable and foreign-company cache is ignored',()=>{
 const f=fixture();f.ui.open('A');f.edit('A','qty','60');f.ui.open('B');f.edit('B','qty','30');f.ui.click({id:'discardSupplierAllocation',dataset:{}});
 assert.equal(f.ui.dirty(),true);const cache=f.ui.serialize();assert.equal(cache.rows,undefined);assert.equal(cache.parkedDrafts.length,1);assert.equal(cache.parkedDrafts[0].rootId,'A');
 const g=fixture();g.ui.restore(cache);g.ui.open('A');assert.equal(g.ui.serialize().rows[0].qty,'60');g.ui.open('B');assert.equal(g.ui.serialize().rootId,undefined);assert.equal(g.ui.serialize().parkedDrafts[0].rows[0].qty,'60');
 const other=fixture();other.workspace.company='GHR';other.ui.restore(cache);assert.equal(other.ui.serialize(),null);assert.equal(other.ui.dirty(),false);
});


test('closed supplier dialog stays closed across workspace refreshes and explicit open restores its draft',()=>{
 const f=fixture();f.ui.open('A');f.edit('A','qty','60');const before=f.ui.serialize();f.modal.close();
 for(let i=0;i<3;i++)f.ui.receivedWorkspace();
 assert.equal(f.modal.open,false);assert.equal(f.ui.serialize().rows[0].qty,before.rows[0].qty);assert.equal(f.submissions.length,0);
 f.ui.open('A');assert.equal(f.modal.open,true);assert.equal(f.ui.serialize().rows[0].qty,'60');assert.equal(f.submissions.length,0);
});

test('repeated stale saved-source refreshes cannot reopen a dismissed dialog or submit again',()=>{
 const f=fixture(),root=twoSources(f,true),cache=f.ui.serialize();cache.rows[0].status='saved';f.ui.restore(cache);f.ui.open('A');f.modal.close();root.procurement.totalCtn=41;
 for(let i=0;i<3;i++)f.ui.receivedWorkspace();
 assert.equal(f.modal.open,false);assert.equal(f.submissions.length,0);assert.ok(f.ui.serialize());
});

test('confirmed source immediately replaces Saving feedback while delayed readback cannot duplicate the save',()=>{
 const f=fixture();twoSources(f,true);f.ui.click({dataset:{allocationSave:'second'}});const request=f.submissions[0];f.setPending(request);f.ui.receipt(request,{ok:true,sourceTaskId:'NEW'});
 assert.match(f.node('#allocationIssue').textContent,/此来源已保存/);assert.match(f.node('#allocationIssue').className,/complete/);const saved=f.node('[data-allocation-row="second"] [data-allocation-save]');assert.equal(saved.textContent,'已保存');assert.equal(saved.disabled,true);assert.equal(saved.className,'allocation-save');assert.match(f.messages.at(-1).text,/可继续浏览/);
 f.setPending(null);f.ui.click({dataset:{allocationSave:'second'}});assert.equal(f.submissions.length,1);assert.equal(f.ui.serialize().rows.find(row=>row.key==='second').status,'saved');assert.equal(f.ui.serialize().running,true,'next writes still require verified fresh versions');
});
test('confirmed feedback never reopens a closed source dialog or discards another source draft',()=>{
 const f=fixture();twoSources(f,true);f.edit('A','qty','bad');f.ui.click({dataset:{allocationSave:'second'}});const request=f.submissions[0],before=f.ui.serialize().rows.find(row=>row.key==='A').qty;f.modal.close();f.ui.receipt(request,{ok:true,sourceTaskId:'NEW'});assert.equal(f.modal.open,false);assert.equal(f.ui.serialize().rows.find(row=>row.key==='A').qty,before);assert.equal(f.submissions.length,1);
});
