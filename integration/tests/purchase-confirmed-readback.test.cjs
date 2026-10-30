const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=process.env.PURCHASE_CONFIRMED_READBACK_BASELINE?fs.readFileSync(process.env.PURCHASE_CONFIRMED_READBACK_BASELINE,'utf8'):require('../prototypes/purchase-confirmed-feedback-20261030/stage.cjs').plan().assets.get('purchase-live/app.js').toString();
const fixtures=fs.readFileSync(path.join(__dirname,'purchase-live-ui.test.cjs'),'utf8');
function setup(){
 const supplier={dirty:true,received:0},controller={dirty:()=>supplier.dirty,sourceDirty:()=>false,click:()=>false,serialize:()=>null,restore(){},receipt:()=>false,receivedWorkspace(){supplier.received++;}};
 const helpers=fixtures.slice(fixtures.indexOf('function harness('),fixtures.indexOf("test('Follow Up search"));
 const source=app.replace(/\}\)\(\);\s*$/, 'window.readbackTest={request,mutate,workspace:()=>data};\n})();');
 const patched=helpers.replace('parent,masterTaskSignals:signals','parent,purchaseSupplierAllocation:{create:()=>controller},masterTaskSignals:signals').replace('return { node,messages,timers,intervals,reply,','return { node,messages,timers,intervals,reply,readback:window.readbackTest,');
 const context={fs,path,vm,source,controller,__dirname,Buffer};vm.runInNewContext(patched+'\nthis.helpers={harness,workspace};',context);
 const h=context.helpers.harness(),w=context.helpers.workspace();h.reply(w);h.click({view:'active'});return {h,w,supplier};
}
function confirm(h){h.readback.mutate('PURCHASE_SAVE_REQUEST',{operation:'ALLOCATE',input:{action:'ALLOCATE',planMode:'CUSTOMER',version:'V1',taskId:'TASK'}});const save=h.messages.at(-1);h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,result:{ok:true,requestId:save.requestId}});return save;}
test('confirmed allocation read updates the visible task despite a parked supplier draft, without resubmitting it',()=>{
 const {h,w,supplier}=setup(),save=confirm(h),read=h.messages.at(-1);assert.equal(read.type,'PURCHASE_WORKSPACE_REQUEST');
 const fresh={...w,tasks:[{...w.tasks[0],ord:300}]};h.reply(fresh,read);assert.equal(h.readback.workspace().tasks[0].ord,300);assert.match(h.node('#app').innerHTML,/>300</);assert.equal(supplier.dirty,true);assert.equal(supplier.received,2);assert.equal(h.messages.filter(m=>m.type.includes('SAVE_REQUEST')).length,1);assert.equal(save.input.version,'V1');
});
test('ordinary quiet polling still cannot overwrite an active edit or parked draft',()=>{
 const {h,w,supplier}=setup();h.readback.request(true);const read=h.messages.at(-1);h.reply({...w,tasks:[{...w.tasks[0],ord:301}]},read);assert.equal(h.readback.workspace().tasks[0].ord,250);assert.equal(supplier.received,1);
});
test('confirmed read refreshes versions while retaining a newly opened dialog and its input',()=>{
 const {h,w}=setup();confirm(h);const read=h.messages.at(-1);h.node('#modal').open=true;h.node('#dialogContent').innerHTML='<input value="keep typing">';const before=h.node('#app').innerHTML;
 h.reply({...w,tasks:[{...w.tasks[0],editVersion:'V2',ord:302}]},read);assert.equal(h.readback.workspace().tasks[0].editVersion,'V2');assert.equal(h.node('#modal').open,true);assert.equal(h.node('#dialogContent').innerHTML,'<input value="keep typing">');assert.equal(h.node('#app').innerHTML,before);
});
test('a newer pending write prevents an older confirmed read from replacing its workspace',()=>{
 const {h,w}=setup();confirm(h);const read=h.messages.at(-1);h.readback.mutate('PURCHASE_SAVE_REQUEST',{operation:'ALLOCATE',input:{version:'V1',taskId:'SECOND'}});h.reply({...w,tasks:[{...w.tasks[0],ord:303}]},read);assert.equal(h.readback.workspace().tasks[0].ord,250);assert.equal(h.messages.filter(m=>m.type.includes('SAVE_REQUEST')).length,2);
});
test('failed confirmed read keeps both the current task list and all draft state',()=>{
 const {h,w,supplier}=setup();confirm(h);const read=h.messages.at(-1),before=h.node('#app').innerHTML;h.reply(w,read,{ok:false,error:'temporary read failure'});assert.equal(h.node('#app').innerHTML,before);assert.equal(supplier.dirty,true);assert.match(h.node('#liveStatus').textContent,/temporary read failure/);
});
