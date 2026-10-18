const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(options={}){
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',insertAdjacentHTML(_,html){this.innerHTML+=html;},querySelector(selector){return node(key+selector);}});return nodes.get(key);};
 let keyboardFields=[];
 const document={querySelectorAll:()=>keyboardFields,activeElement:null,querySelector:selector=>selector.includes('data-allocation-extra=')?null:node(selector)},ctx={window:{},document};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/supplier-allocation.js'),'utf8'),ctx);
 const task=(id,ord)=>({id,customerId:'C',barcode:'BAR-'+id,ord,ea:24,supplierId:'S',editVersion:'V1',lpPc:2,lpCtn:48,disc1:0,disc2:0,disc3:0,procurement:{transportMode:'SUPPLIER_DELIVER',totalCtn:null,revision:'',draftPlan:true}});
 const workspace={company:'NCT',customers:[{id:'C',shortName:'CUSTOMER'}],suppliers:[{id:'S',shortName:'SUPPLIER'},{id:'S2',shortName:'SUPPLIER 2'}],tasks:[task('A',100),task('B',80)]},submissions=[],messages=[],pos=[];let pending=null;
 const modal={open:true,classList:{add(){},contains:()=>true},close(){this.open=false;}};
 const ui=ctx.window.purchaseSupplierAllocation.create({workspace:()=>workspace,company:()=>workspace.company,rowLabel:id=>id==='A'?'ROW 050':'ROW 051',esc:x=>String(x??''),num:x=>Number.isFinite(x)?x.toFixed(2):'—',dialog(){modal.open=true;},modal:()=>modal,cache(){},status:(text,error)=>messages.push({text,error}),savePending:()=>pending,atOrigin:()=>true,mutate(_,request){submissions.push(request);},openPo:id=>pos.push(id),confirm:()=>true,handIcon:()=>'<svg data-hand></svg>',...options});
 const edit=(id,field,value)=>ui.edit({target:{value,dataset:{allocationField:field},closest:()=>({dataset:{allocationRow:id}})}});
 return {setKeyboard:fields=>keyboardFields=fields,node,ui,workspace,submissions,messages,pos,edit,planner:ctx.window.purchaseSupplierAllocation,setPending:value=>pending=value};
}

function controls(f){const row='[data-allocation-row="A"]';return {save:f.node(row+'[data-allocation-save]'),po:f.node(row+'[data-allocation-po]')};}
function waiting(f){const c=controls(f);assert.equal(c.save.className,'allocation-save needs-save');assert.equal(c.po.className,'allocation-po pending awaiting-save');assert.equal(c.po.hidden,true);}
function saved(f){const c=controls(f);assert.equal(c.save.className,'allocation-save');assert.equal(c.save.disabled,true);assert.equal(c.save.textContent,'已保存');assert.equal(c.po.className,'allocation-po pending');assert.equal(c.po.hidden,false);}
test('next action changes from save to PO only after matching saved workspace, then returns to save on edit',()=>{
 const f=fixture();f.ui.open('A');waiting(f);assert.match(f.node('#allocationRows').innerHTML,/allocation-po pending awaiting-save[^>]+disabled hidden>P.O./);
 f.edit('A','qty','60');waiting(f);f.ui.click({dataset:{allocationSave:'A'}});waiting(f);assert.equal(controls(f).save.disabled,true);assert.equal(f.submissions.length,1);
 const request=f.submissions[0];f.ui.receipt(request,{ok:true});waiting(f);
 const root=f.workspace.tasks[0];root.editVersion='V2';root.procurement={transportMode:'SUPPLIER_DELIVER',totalCtn:60,revision:'P2',draftPlan:true,costing:request.input.costing};f.ui.receivedWorkspace();saved(f);
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

test('zero and unknown net cost keep Save neutral and PO hidden until positive confirmed cost',()=>{
 const f=fixture();f.ui.open('A');f.edit('A','lpCtn','0');let c=controls(f);assert.equal(c.save.className,'allocation-save');assert.equal(c.save.disabled,true);assert.equal(c.po.hidden,true);
 f.edit('A','lpCtn','12');c=controls(f);assert.equal(c.save.className,'allocation-save needs-save');assert.equal(c.save.disabled,false);assert.equal(c.po.hidden,true);
});
test('calculator formats price and percent fields to two decimals without changing precise calculation inputs',()=>{
 const f=fixture();f.ui.open('A');for(const [name,value,shown]of [['lpPc','1.23456','1.23'],['disc1','17','17.00'],['disc3','3','3.00']]){
 f.edit('A',name,value);const before=f.ui.serialize().rows[0],precise=f.planner.values(before)[name],field={value,dataset:{allocationField:name},closest:()=>({dataset:{allocationRow:'A'}})};f.ui.format({target:field});assert.equal(field.value,shown);assert.equal(f.planner.values(f.ui.serialize().rows[0])[name],precise);
 }
});
test('calculator arrows and Enter move among editable inputs, skip readonly cells and select numeric text',()=>{
 const f=fixture();f.ui.open('A');const make=(name,readonly=false)=>({tagName:'INPUT',dataset:{allocationField:name},readOnly:readonly,getClientRects:()=>[1],focus(){this.focused=true;},select(){this.selected=true;}}),a=make('lpPc'),b=make('disc1'),c=make('lpPc'),readonly=make('qty',true);f.setKeyboard([a,b,readonly,c]);let prevented=0;
 f.ui.keyDown({target:a,key:'ArrowDown',preventDefault(){prevented++;}});assert.equal(c.focused,true);assert.equal(c.selected,true);
 f.ui.keyDown({target:a,key:'ArrowRight',preventDefault(){prevented++;}});assert.equal(b.focused,true);assert.equal(prevented,2);
 f.ui.keyDown({target:c,key:'Enter',shiftKey:true,preventDefault(){prevented++;}});assert.equal(b.selected,true);assert.equal(readonly.focused,undefined);
});

test('demand50 can submit35 without selecting a remainder supplier',()=>{const f=fixture();f.workspace.tasks[0].ord=50;f.ui.open('A');f.edit('A','qty','35');f.ui.click({dataset:{allocationSave:'A'}});assert.equal(f.submissions.length,1);assert.equal(f.submissions[0].input.totalCtn,35);assert.equal(f.workspace.tasks[0].ord,50);assert.match(f.node('#allocationSummary').innerHTML,/15 CTN/);});
test('demand100 with paid100 and FOC10 submits110 while preserving paid value and client demand',()=>{const f=fixture();f.ui.open('A');f.edit('A','mode','FOC');f.edit('A','paid','100');f.edit('A','free','10');f.ui.edit({target:{id:'allocationReason',value:'FOC surplus for stock'}});f.ui.click({dataset:{allocationSave:'A'}});assert.equal(f.submissions.length,1);const input=f.submissions[0].input;assert.equal(input.totalCtn,110);assert.equal(input.costing.paidCtn,100);assert.equal(input.costing.freeCtn,10);assert.equal(input.costing.amountCents,480000);assert.equal(f.workspace.tasks[0].ord,100);});

test('CMS JSON key reordering is not a procurement change and matching receipt can finish without a second save',()=>{
 const f=fixture(),root=f.workspace.tasks[0];root.procurement={transportMode:'SUPPLIER_DELIVER',revision:'P25',totalCtn:25,draftPlan:true,costing:{schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:25,freeCtn:0,totalCtn:25,prices:{disc3:0,lpPc:2,lpCtn:48,disc2:0,disc1:0},amountCents:120000,averageCostCtn:48}};f.ui.open('A');saved(f);
 f.edit('A','qty','35');f.ui.edit({target:{id:'allocationReason',value:'Partial procurement'}});f.ui.click({dataset:{allocationSave:'A'}});assert.equal(f.submissions.length,1);const request=f.submissions[0];root.editVersion='V2';root.procurement={transportMode:'SUPPLIER_DELIVER',revision:'P35',totalCtn:35,draftPlan:true,costing:{...request.input.costing,prices:{disc3:0,lpPc:2,lpCtn:48,disc2:0,disc1:0}}};f.ui.receipt(request,{ok:true});f.ui.receivedWorkspace();saved(f);assert.equal(f.submissions.length,1);f.edit('A','disc3','1');assert.equal(controls(f).save.className,'allocation-save needs-save');
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const caught=f=>f.node('[data-allocation-catch="A"]');
const response=()=>({company:'NCT',taskId:'A',capturedAt:'2026-10-16T09:00:00Z',prices:{lpPc:4,lpCtn:96,disc1:.1,disc2:0,disc3:0}});
test('Catch Cost disables immediately, deduplicates, replaces saved/manual prices and keeps FOC quantities without saving',async()=>{
 let resolve,reads=0;const f=fixture({read:()=>{reads++;return new Promise(done=>resolve=done);}});f.workspace.tasks[0].procurement={transportMode:'SUPPLIER_DELIVER',totalCtn:100,revision:'P1',draftPlan:true};f.ui.open('A');f.edit('A','mode','FOC');f.edit('A','free','10');f.edit('A','disc3','3');
 f.ui.click({dataset:{allocationCatch:'A'}});assert.equal(caught(f).disabled,true);assert.equal(caught(f).className,'allocation-hand loading');assert.match(f.node('#allocationIssue').textContent,/正在抓取/);f.ui.click({dataset:{allocationCatch:'A'}});await settle();assert.equal(reads,1);
 resolve(response());await settle();let row=f.ui.serialize().rows[0];assert.equal(row.raw.lpCtn,'96.00');assert.equal(row.raw.disc1,'10.00');assert.equal(row.raw.disc3,'0.00');assert.equal(row.qty,'110');assert.equal(row.free,'10');assert.equal(row.paid,'100');assert.equal(row.reference.source,'POINTBASE');assert.equal(caught(f).className,'allocation-hand complete');assert.equal(caught(f).disabled,true);assert.match(f.node('#allocationIssue').textContent,/原 Net Cost RM.*新 RM/);assert.equal(f.submissions.length,0);assert.match(f.messages.at(-1).text,/成本已填入/);f.ui.click({dataset:{allocationCatch:'A'}});await settle();assert.equal(reads,1);
 f.ui.open('A');assert.equal(caught(f).className,'allocation-hand');assert.equal(caught(f).disabled,false);assert.equal(f.ui.serialize().rows[0].raw.lpCtn,'96.00');
});
test('Catch Cost failure keeps original inputs and allows a deliberate retry',async()=>{
 let reads=0;const f=fixture({read:async()=>{if(++reads===1)throw Error('No cost');return response();}});f.ui.open('A');f.edit('A','disc3','1');f.ui.click({dataset:{allocationCatch:'A'}});await settle();assert.equal(caught(f).disabled,false);assert.equal(f.ui.serialize().rows[0].raw.lpCtn,'48.00');assert.match(f.node('#allocationIssue').textContent,/抓取失败/);f.ui.click({dataset:{allocationCatch:'A'}});await settle();assert.equal(reads,2);assert.equal(caught(f).className,'allocation-hand complete');
});
test('late reference responses cannot overwrite edits, reopened drafts, changed tasks or finance locks',async()=>{
 for(const change of ['edit','reopen','version','finance','invoice','archive']){let resolve,locked=false;const f=fixture({read:()=>new Promise(done=>resolve=done),financeLocked:()=>locked});f.ui.open('A');f.edit('A','qty','35');f.ui.click({dataset:{allocationCatch:'A'}});await settle();
 if(change==='edit')f.edit('A','disc3','2');if(change==='reopen')f.ui.open('A');if(change==='version')f.workspace.tasks[0].editVersion='V2';if(change==='finance')locked=true;if(change==='invoice')f.workspace.tasks[0].salesInvoiceNumber='INV';if(change==='archive')f.workspace.tasks[0].archived=true;
 resolve(response());await settle();assert.equal(f.ui.serialize().rows[0].raw.lpCtn,'48.00',change);assert.notEqual(caught(f).className,'allocation-hand complete',change);assert.equal(f.submissions.length,0);
 }
});
test('locked calculators reject edits and fetching before any reference read',async()=>{
 for(const lock of ['finance','financeSubmitted','salesInvoiceNumber','salesInvoiceLocked','archived']){let reads=0;const f=fixture({read:async()=>{reads++;return response();},financeLocked:()=>lock==='finance'});if(lock!=='finance')f.workspace.tasks[0][lock]=true;f.ui.open('A');f.edit('A','qty','35');f.ui.click({dataset:{allocationCatch:'A'}});await settle();assert.equal(reads,0);assert.equal(caught(f).disabled,true);assert.equal(f.ui.serialize(),null);assert.match(f.node('#allocationRows').innerHTML,/data-allocation-field="lpCtn"[^>]+disabled/);}
});
test('Catch Cost selects fetched price calculation instead of retaining an old actual-total override',async()=>{const f=fixture({read:async()=>response()});f.ui.open('A');f.edit('A','moneySource','TOTAL');f.edit('A','amount','500');f.ui.click({dataset:{allocationCatch:'A'}});await settle();const row=f.ui.serialize().rows[0];assert.equal(row.moneySource,'PRICES');assert.equal(f.planner.calculation(row).amountCents,864000);assert.equal(f.submissions.length,0);});
