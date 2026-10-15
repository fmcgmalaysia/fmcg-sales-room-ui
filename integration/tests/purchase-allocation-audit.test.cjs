const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

test('FOC total updates immediately; quantity history contains saved events only and no supplier agreement is fabricated',()=>{
 const nodes=new Map(),fields=new Map(),cells=new Map();
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',value:'',insertAdjacentHTML(_,html){this.innerHTML+=html;}});return nodes.get(key);};
 const document={activeElement:null,querySelector(selector){
  if(selector.startsWith('#'))return node(selector);
  if(selector.includes('data-allocation-extra='))return null;
  const row=selector.match(/data-allocation-row="([^"]+)"/);if(!row)return null;
  if(selector.includes('data-allocation-total'))return node('total:'+row[1]);
  if(selector.includes('data-allocation-field='))return node(selector);
  if(!cells.has(row[1]))cells.set(row[1],{querySelector(key){return node(row[1]+key);}});
  return cells.get(row[1]);
 }};
 const ctx={window:{},document};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../purchase-live/supplier-allocation.js'),'utf8'),ctx);
 const prices={lpPc:4,lpCtn:96,disc1:0,disc2:0,disc3:0};
 const task={id:'ROOT',supplierId:'A',po:'PO-1',customerId:'C',ord:300,ea:24,editVersion:'V1',...prices,procurement:{totalCtn:200,revision:'P1',draftPlan:false,costing:{schema:1,mode:'FOC',moneySource:'PRICES',paidCtn:200,freeCtn:0,prices,amountCents:1920000}},history:[
  {action:'PURCHASE_PLAN_SAVED',result:'SAVED',time:'2026-10-15T02:00:00Z',actor:'LAW',changes:{before:500,after:300}},
  {action:'PURCHASE_PLAN_SAVED',result:'PENDING',time:'2026-10-15T03:00:00Z',actor:'NOT-SAVED',changes:{before:300,after:250}}
 ]};
 const workspace={company:'NCT',tasks:[task],suppliers:[{id:'A',shortName:'HONG LEA'}],customers:[{id:'C',name:'Customer'}]},submitted=[];
 const modal={open:true,classList:{add(){},contains(){return true;}}};
 const ui=ctx.window.purchaseSupplierAllocation.create({workspace:()=>workspace,esc:x=>String(x??''),num:x=>Number.isFinite(x)?x.toFixed(2):'—',shortTime:x=>x,dialog(){},modal:()=>modal,cache(){},status(){},savePending:()=>null,atOrigin:()=>true,mutate(_,input){submitted.push(input);},handIcon:()=>''});
 ui.open('ROOT');assert.match(node('#allocationHistory').innerHTML,/LAW.*HONG LEA.*PO-1.*500 → 300 CTN/);
 assert.doesNotMatch(node('#allocationHistory').innerHTML,/NOT-SAVED|300 → 250/);
 assert.doesNotMatch(node('#allocationConfirmations').innerHTML,/allocation-confirm=|供应商确认/);
 ui.edit({target:{value:'20',dataset:{allocationField:'free'},closest:()=>({dataset:{allocationRow:'ROOT'}})}});
 assert.equal(node('total:ROOT').textContent,'= 220 CTN');
 assert.equal(node('[data-allocation-row="ROOT"] [data-allocation-field="qty"]').value,'220');
 assert.match(node('#allocationSummary').textContent,/已安排 220 CTN · 待安排 80 CTN/);
 assert.doesNotMatch(node('#allocationHistory').innerHTML,/200 → 220/);
 ui.edit({target:{id:'allocationReason',value:'Revised procurement'}});ui.click({id:'applySupplierAllocation',dataset:{}});
 assert.equal(submitted.length,1);assert.equal(submitted[0].input.totalCtn,220);
 assert.equal(submitted[0].input.costing.paidCtn,200);assert.equal(submitted[0].input.costing.freeCtn,20);
 assert.equal('supplierConfirmed' in submitted[0].input,false);
 assert.equal(task.procurement.totalCtn,200);
});
