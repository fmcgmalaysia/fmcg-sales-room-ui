const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const folder = path.join(__dirname, '../prototypes/stock-current-state'), copy = value => JSON.parse(JSON.stringify(value));
const source = fs.readFileSync(path.join(folder,'purchase-ui/purchase-resume.js'),'utf8');
const request = () => ({type:'PURCHASE_SAVE_REQUEST',company:'NCT',requestId:'11111111-2222-4333-8444-555555555555',operation:'EDIT',
  input:{edits:[{taskId:'TASK',version:'V1',changes:{lpCtn:20}}]},stockProtocol:1,stockBuild:'TEST',stockGeneration:9,stockIdentity:{staffId:'STAFF',memberId:'MEMBER'}});
const staff = {staffId:'STAFF',memberId:'MEMBER',staffName:'<Purchase>'};
const key = 'fmcg-purchase-draft-v1/NCT/STAFF/MEMBER';
const flush = () => new Promise(resolve=>setImmediate(resolve));
function fixture(patch = {}) {
  const reads=[],sent=[],receipts=[],timers=[],listeners=new Set(),parent={},gets=[],writes=[];
  const db=new Map([[key,JSON.stringify({savePending:request(),drafts:[],unrelatedDraft:'KEEP'})]]);
  const storage={getItem:id=>{gets.push(id);return db.get(id)||null;},setItem:(id,value)=>{writes.push([id,value]);db.set(id,value);},removeItem:id=>{writes.push(id);db.delete(id);}};
  const window={parent,addEventListener:(_type,fn)=>listeners.add(fn),removeEventListener:(_type,fn)=>listeners.delete(fn)};
  const host={isConnected:true,children:[],appendChild(node){this.children.push(node);}};
  function node(){const state={textContent:''},button={disabled:false,addEventListener(_type,fn){this.click=fn;}};
    return{innerHTML:'',state,button,querySelector:selector=>selector==='button'?button:state};}
  let ids=0;
  vm.runInNewContext(source,{window,document:{createElement:node},sessionStorage:storage,setTimeout:(fn,ms)=>timers.push({fn,ms}),
    crypto:{randomUUID:()=> '22222222-2222-4222-8222-'+String(++ids).padStart(12,'0')}});
  let locked=0;
  const args={company:'NCT',host,read:type=>new Promise((resolve,reject)=>reads.push({type,resolve,reject})),
    send:value=>sent.push(copy(value)),receipt:value=>receipts.push(copy(value)),lockCompany:()=>locked++,
    esc:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),...patch};
  const dispose=window.purchaseCurrentResume.mount(args);
  const reply=(result,extra={},source=parent)=>{for(const fn of [...listeners])fn({source,data:{type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:request().requestId,ok:true,result,...extra}});};
  return{reads,sent,receipts,timers,db,gets,writes,host,args,dispose,listeners,locked:()=>locked,valid:window.purchaseCurrentResume.validRequest,
    stage:(packet,priorReceipt)=>window.purchaseCurrentResume.stageMargin({...args,packet,priorReceipt}),
    failStorage:()=>{storage.setItem=()=>{throw Error('Storage unavailable');};},
    authorize:async(context={ok:true,schema:'PURCHASE_RESUME_CONTEXT_V1',company:'NCT',staff})=>{await flush();reads.at(-1).resolve(context);await flush();},
    section:()=>host.children[0],reply};
}

test('blocked-workspace shell waits for ORIGINAL Purchase authorization then reads only its exact session key, without writing',async()=>{
  const f=fixture();assert.equal(f.gets.length,0);await f.authorize();
  assert.equal(f.reads[0].type,'PURCHASE_RESUME_CONTEXT_REQUEST');assert.deepEqual(f.gets,[key]);
  assert.equal(f.sent.length,0);assert.equal(f.locked(),1);assert.match(f.section().innerHTML,/&lt;Purchase&gt;/);
  assert.equal(f.section().innerHTML.includes('<Purchase>'),false);assert.deepEqual(f.writes,[]);
  f.section().button.click();f.section().button.click();assert.deepEqual(f.sent,[request()]);assert.deepEqual(f.writes,[]);
});

test('same UUID bounded phases continue only after explicit first retry; confirmed receipt never clears cache',async()=>{
  const f=fixture();await f.authorize();const before=f.db.get(key);f.section().button.click();
  for(const phase of ['BEFORE','APPLY','VERIFY']){
    f.reply({ok:false,pending:true,requestId:request().requestId,phase,completedCount:2,totalRecords:5});
    assert.equal(f.receipts.length,0);assert.equal(f.timers.at(-1).ms,250);f.timers.at(-1).fn();
  }
  assert.equal(f.sent.length,4);assert.ok(f.sent.every(value=>JSON.stringify(value)===JSON.stringify(request())));
  f.reply({ok:true,requestId:request().requestId,stockGeneration:10});
  assert.equal(f.receipts.length,1);assert.equal(f.db.get(key),before);assert.deepEqual(f.writes,[]);
  for(const timer of f.timers)timer.fn();assert.equal(f.sent.length,4,'completed/disposed timers cannot continue another save');
});

test('unknown/malformed receipts and timeouts retain original request, and stale continuation/disposal cannot resend',async()=>{
  for(const result of [{ok:true,requestId:request().requestId},{ok:true,requestId:request().requestId,stockGeneration:9},
    {ok:false,pending:true,requestId:request().requestId,phase:'APPLY',completedCount:6,totalRecords:5},{ok:false,error:'NOT_STARTED'}]){
    const f=fixture();await f.authorize();const before=f.db.get(key);f.section().button.click();f.reply(result);
    assert.equal(f.receipts.length,0);assert.equal(f.section().button.disabled,false);assert.equal(f.db.get(key),before);
    assert.equal(f.timers.filter(t=>t.ms===250).length,0);
  }
  const f=fixture();await f.authorize();f.section().button.click();f.timers[0].fn();
  assert.equal(f.section().button.disabled,false);assert.equal(f.sent.length,1);
  f.reply({ok:false,pending:true,requestId:request().requestId,phase:'APPLY',completedCount:1,totalRecords:5});
  assert.equal(f.timers.filter(t=>t.ms===250).length,0,'late progress after unknown outcome must not restart automation');
  const g=fixture();await g.authorize();g.section().button.click();g.reply({ok:false,pending:true,requestId:request().requestId,phase:'APPLY',completedCount:1,totalRecords:5});
  g.dispose();g.timers.at(-1).fn();assert.equal(g.sent.length,1);assert.equal(g.listeners.size,0);
});

test('unapproved/foreign identity, other staff cache and changed original payload cannot resume',async()=>{
  for(const context of [{ok:false},{ok:true,company:'GHR',schema:'PURCHASE_RESUME_CONTEXT_V1',staff},
    {ok:true,company:'NCT',schema:'WRONG',staff},{ok:true,company:'NCT',schema:'PURCHASE_RESUME_CONTEXT_V1',staff:{...staff,memberId:'OTHER'}}]){
    const f=fixture();await f.authorize(context);assert.equal(f.host.children.length,0);assert.equal(f.sent.length,0);
    assert.ok(f.gets.every(id=>id.endsWith('/OTHER'))||f.gets.length===0);assert.deepEqual(f.writes,[]);
  }
  const f=fixture();await f.authorize();f.db.set(key,JSON.stringify({savePending:{...request(),input:{changed:true}}}));
  f.section().button.click();assert.equal(f.sent.length,0);assert.equal(f.section().button.disabled,true);
});

test('wrong parent/company/UUID and stale authorization completion never create actionable recovery',async()=>{
  const f=fixture();await f.authorize();f.section().button.click();
  const result={ok:true,requestId:request().requestId,stockGeneration:10};
  f.reply(result,{},{});f.reply(result,{company:'GHR'});f.reply(result,{requestId:'OTHER'});assert.equal(f.receipts.length,0);
  const g=fixture();await flush();g.dispose();g.reads[0].resolve({ok:true,schema:'PURCHASE_RESUME_CONTEXT_V1',company:'NCT',staff});await flush();
  assert.equal(g.gets.length,0);assert.equal(g.host.children.length,0);
});

test('only bounded original current task commands qualify; no file/supplier/legacy command or browser grant',()=>{
  const f=fixture();assert.equal(f.valid(request(),'NCT'),true);
  for(const patch of [{type:'PURCHASE_ORDER_SAVE_REQUEST'},{operation:'DOCUMENT'},{stockProtocol:undefined},{stockGeneration:-1},
    {requestId:'BAD'},{memberId:'FORGED'},{input:{reason:'X'.repeat(200001)}},{company:'GHR'},
    {stockIdentity:undefined},{stockIdentity:null},{stockIdentity:{staffId:'STAFF'}},{stockIdentity:{staffId:'STAFF',memberId:'MEMBER',role:'ADMIN'}}])assert.equal(f.valid({...request(),...patch},'NCT'),false);
});

test('unbound or different-employee pending requests stay retained but cannot be resumed under the current identity',async()=>{
  for(const stockIdentity of [undefined,{staffId:'OTHER',memberId:'MEMBER'},{staffId:'STAFF',memberId:'OTHER'}]){
    const f=fixture();f.db.set(key,JSON.stringify({savePending:{...request(),stockIdentity},drafts:[['KEEP',{}]]}));const before=f.db.get(key);
    await f.authorize();assert.equal(f.host.children.length,0);assert.equal(f.sent.length,0);assert.deepEqual(f.writes,[]);assert.equal(f.db.get(key),before);
  }
});

const refreshPacket=(taskId='TASK',generation=9)=>({schema:'PURCHASE_MARGIN_REFRESH_REQUIRED_V1',company:'NCT',taskId,staff,
  stockCurrent:{schema:'PURCHASE_TRANSFERS_V2',stockProtocol:1,stockBuild:'TEST',stockGeneration:generation,generation}});

test('internal margin refresh saves exact original session request BEFORE first network write and preserves other drafts',async()=>{
  const f=fixture();f.dispose();const cached={customerId:'C',drafts:[['OTHER',{version:'V',changes:{lpCtn:33}}]],sequenceDraft:['TASK','OTHER'],
    sequenceVersions:{TASK:'V1',OTHER:'V'},supplierAllocation:{draft:'KEEP'}};f.db.set(key,JSON.stringify(cached));
  f.stage(refreshPacket());const staged=JSON.parse(f.db.get(key));
  assert.equal(f.sent.length,0);assert.equal(f.writes.length,1);assert.equal(staged.savePending.operation,'MARGIN_REFRESH');
  assert.deepEqual(staged.savePending.input,{taskId:'TASK'});assert.equal(staged.savePending.stockGeneration,9);
  assert.deepEqual(staged.savePending.stockIdentity,{staffId:staff.staffId,memberId:staff.memberId});
  for(const field of ['drafts','sequenceDraft','sequenceVersions','supplierAllocation'])assert.deepEqual(staged[field],cached[field]);
  await f.authorize();assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0],staged.savePending);
  assert.equal(f.gets.every(id=>id===key),true);assert.equal(f.writes.length,1,'continuation must not replace the retained request');
});

test('multiple needed margin groups replace only a confirmed prior margin request, retaining drafts and distinct UUIDs',async()=>{
  const f=fixture();f.dispose();f.db.set(key,JSON.stringify({drafts:[['OTHER',{version:'V',changes:{lpCtn:33}}]]}));
  const close=f.stage(refreshPacket());await f.authorize();const first=f.sent[0];
  f.reply({ok:true,requestId:first.requestId,stockGeneration:10},{requestId:first.requestId});assert.equal(f.receipts.length,1);close();
  f.stage(refreshPacket('OTHER',10),f.receipts[0]);await f.authorize();const second=f.sent[1];
  assert.notEqual(second.requestId,first.requestId);assert.equal(second.input.taskId,'OTHER');assert.equal(second.stockGeneration,10);
  assert.equal(JSON.parse(f.db.get(key)).drafts[0][0],'OTHER');assert.deepEqual(JSON.parse(f.db.get(key)).savePending,second);
});

test('unknown/other pending requests, failed storage and changed member never auto-submit a new margin command',async()=>{
  const retained=fixture();retained.dispose();const before=retained.db.get(key);retained.stage(refreshPacket());await retained.authorize();
  assert.equal(retained.db.get(key),before);assert.equal(retained.writes.length,0);assert.equal(retained.sent.length,0);
  const blocked=fixture();blocked.dispose();blocked.db.set(key,JSON.stringify({drafts:[]}));blocked.failStorage();blocked.stage(refreshPacket());await flush();
  assert.equal(blocked.sent.length,0);assert.equal(blocked.reads.length,0);assert.equal(JSON.parse(blocked.db.get(key)).savePending,undefined);
  const switched=fixture();switched.dispose();switched.db.set(key,JSON.stringify({drafts:[]}));
  switched.db.set('fmcg-purchase-draft-v1/NCT/STAFF/OTHER',JSON.stringify({savePending:request()}));switched.stage(refreshPacket());
  await switched.authorize({ok:true,schema:'PURCHASE_RESUME_CONTEXT_V1',company:'NCT',staff:{...staff,memberId:'OTHER'}});
  assert.equal(switched.sent.length,0,'another member cache cannot inherit automatic retry authorization');
});

test('a stale or malformed prior GP receipt cannot authorize replacement of the existing pending slot',async()=>{
  const f=fixture();f.dispose();const pending={...request(),operation:'MARGIN_REFRESH',input:{taskId:'TASK'}};
  f.db.set(key,JSON.stringify({savePending:pending}));const before=f.db.get(key);
  f.stage(refreshPacket('OTHER',9),{request:pending,staff,result:{ok:true,requestId:pending.requestId,stockGeneration:10}});
  await f.authorize();assert.equal(f.db.get(key),before);assert.equal(f.writes.length,0);assert.equal(f.sent.length,0);
});

function originalAppHarness(storage,resume,realResume=false){
  const file=path.join(__dirname,'purchase-live-ui.test.cjs'),text=fs.readFileSync(file,'utf8');
  const start=text.indexOf('function harness('),end=text.indexOf("test('Follow Up search",start);
  assert.ok(start>0&&end>start);
  let helpers=text.slice(start,end).replace('window = { parent,','window = { parent,purchaseCurrentResume:resume,');
  if(realResume)helpers=helpers.replace('classList:{ toggle()', 'appendChild(child){(this.children ||= []).push(child);},classList:{ toggle()')
    .replace('masterTaskSignals:signals,',"masterTaskSignals:signals,removeEventListener(type,fn){const key='window:'+type;listeners.set(key,(listeners.get(key)||[]).filter(item=>item!==fn));},")
    .replace('document:{ querySelector:',"document:{ createElement(tag){if(tag==='canvas')return {getContext:()=>({measureText:()=>({width:10})})};const id='resume-'+(++count);return {innerHTML:'',querySelector:selector=>node(id+selector)};},querySelector:")
    .replace('randomUUID:()=>String(++count)',"randomUUID:()=> '22222222-2222-4222-8222-'+String(++count).padStart(12,'0')");
  const api=vm.runInNewContext(helpers+'\n({harness,workspace})',{fs,path,vm,__dirname,Buffer,Map,Set,Date,Number,resume,
    source:(realResume?source+'\n':'')+fs.readFileSync(path.join(folder,'purchase-ui/app.js'),'utf8')});
  return{h:api.harness(storage),workspace:api.workspace};
}

test('actual candidate app exposes recovery on workspace failure and completes through ORIGINAL draft reconciliation only after fresh same-staff workspace',()=>{
  const cache={drafts:[['TASK',{version:'V1',changes:{lpCtn:20}}]],savePending:request(),saveOrigin:{view:'dashboard',customerId:'',activeCustomer:''}};
  const db=new Map([[key,JSON.stringify(cache)]]),reads=[];
  const storage={getItem:id=>{reads.push(id);return db.get(id)||null;},setItem:(id,value)=>db.set(id,value),removeItem:id=>db.delete(id)};
  let mounted;
  const {h,workspace}=originalAppHarness(storage,{mount:args=>{mounted=args;return()=>{};}});
  const first=h.messages[0];h.reply(null,first,{ok:false,error:'Inventory pending'});
  assert.ok(mounted);assert.equal(reads.length,0,'blocked app cannot infer staff identity from frontend failure');
  mounted.receipt({request:request(),result:{ok:true,requestId:request().requestId,stockGeneration:10},staff});
  assert.equal(db.has(key),true,'cache remains until new authorized current workspace');
  const w=workspace();w.stockCurrent={stockProtocol:1,stockBuild:'TEST',stockGeneration:10};w.tasks[0].lpCtn=20;
  h.reply(w);assert.equal(h.messages.some(m=>m.type==='PURCHASE_SAVE_CHECK_REQUEST'),false);
  h.timers.at(-1)();assert.equal(db.has(key),false,'original finishSave clears only matching original cost draft and pending request');
  assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,0,'receipt reconciliation does not create another save');
});

test('fresh workspace with another staff/build or insufficient generation cannot consume the retained receipt/cache',()=>{
  for(const variant of ['staff','build','generation']){
    const db=new Map([[key,JSON.stringify({savePending:request(),drafts:[]})]]),storage={getItem:id=>db.get(id)||null,setItem:(id,value)=>db.set(id,value),removeItem:id=>db.delete(id)};
    let mounted;const{h,workspace}=originalAppHarness(storage,{mount:args=>{mounted=args;return()=>{};}});
    h.reply(null,h.messages[0],{ok:false,error:'Inventory pending'});
    mounted.receipt({request:request(),result:{ok:true,requestId:request().requestId,stockGeneration:10},staff});
    const w=workspace();w.stockCurrent={stockProtocol:1,stockBuild:variant==='build'?'OTHER':'TEST',stockGeneration:variant==='generation'?9:10};
    if(variant==='staff')w.staff.memberId='OTHER';h.reply(w);
    assert.equal(db.has(key),true);assert.equal(h.messages.some(m=>m.type==='PURCHASE_SAVE_CHECK_REQUEST'),false);
    assert.equal(h.messages.filter(m=>m.type==='PURCHASE_SAVE_REQUEST').length,0);
  }
});

test('completed non-margin save reconciles ORIGINAL drafts against a hidden current snapshot before staging later GP refresh',()=>{
  const db=new Map([[key,JSON.stringify({drafts:[['TASK',{version:'V1',changes:{lpCtn:20}}],['OTHER',{version:'V2',changes:{lpCtn:33}}]],
    savePending:request(),saveOrigin:{view:'dashboard',customerId:'',activeCustomer:''}})]]);
  const storage={getItem:id=>db.get(id)||null,setItem:(id,value)=>db.set(id,value),removeItem:id=>db.delete(id)};
  let mounted,staged;
  const{h,workspace}=originalAppHarness(storage,{mount:args=>{mounted=args;return()=>{};},stageMargin:args=>{staged=args;return()=>{};}});
  h.reply(null,h.messages[0],{ok:false,error:'Inventory pending'});mounted.receipt({request:request(),result:{ok:true,requestId:request().requestId,stockGeneration:10},staff});
  const hidden=workspace();hidden.stockCurrent={stockProtocol:1,stockBuild:'TEST',stockGeneration:10};hidden.stockReconciliationOnly=true;
  hidden.tasks.push({...copy(hidden.tasks[0]),id:'OTHER'});hidden.tasks[0].lpCtn=20;
  const packet={...refreshPacket('TASK',10),reconciliationWorkspace:hidden};h.reply(packet);
  const cache=JSON.parse(db.get(key));assert.equal(cache.savePending,null);assert.deepEqual(cache.drafts.map(row=>row[0]),['OTHER']);
  assert.equal(staged,undefined,'original save is reconciled first, not overwritten by a GP request');
  assert.equal(h.node('#app').innerHTML.includes('ACTUAL PRODUCT'),false,'hidden reconciliation snapshot must never render as a workroom');
  h.reply(packet);assert.ok(staged);assert.equal(staged.priorReceipt,null);assert.equal(h.messages.some(message=>message.type==='PURCHASE_SAVE_CHECK_REQUEST'),false);
});

test('read-only reconciliation snapshot cannot be accepted as an ordinary actionable workspace',()=>{
  const{h,workspace}=originalAppHarness(undefined,{mount:()=>()=>{}}),hidden=workspace();hidden.stockReconciliationOnly=true;
  h.reply(hidden);assert.match(h.node('#liveStatus').textContent,/回执格式不完整/);assert.equal(h.node('#app').innerHTML.includes('ACTUAL PRODUCT'),false);
});

test('already-open actual app durably sequences two GP refresh groups then reconciles its last pending cache through original finishSave',async()=>{
  const db=new Map();
  const storage={getItem:id=>db.get(id)||null,setItem:(id,value)=>db.set(id,value),removeItem:id=>db.delete(id)};
  const{h,workspace}=originalAppHarness(storage,null,true);
  const ready=generation=>{const w=workspace();w.stockCurrent={stockProtocol:1,stockBuild:'TEST',stockGeneration:generation};
    w.tasks.push({...copy(w.tasks[0]),id:'OTHER',editVersion:'V2'});return w;};
  h.reply(ready(9));h.click({view:'active'});assert.match(h.node('#app').innerHTML,/ACTUAL PRODUCT/);
  h.click({controlId:'refresh'});h.reply(refreshPacket());
  assert.equal(h.node('#app').innerHTML.includes('ACTUAL PRODUCT'),false);
  h.click({view:'active'});h.switchCompany('GHR');
  assert.equal(h.node('#app').innerHTML.includes('ACTUAL PRODUCT'),false);
  for(const [taskId,generation] of [['TASK',9],['OTHER',10]]){
    await flush();const auth=h.messages.at(-1);assert.equal(auth.type,'PURCHASE_RESUME_CONTEXT_REQUEST');
    h.send({type:'PURCHASE_RESUME_CONTEXT_RESULT',company:'NCT',requestId:auth.requestId,ok:true,
      result:{ok:true,schema:'PURCHASE_RESUME_CONTEXT_V1',company:'NCT',staff}});await flush();
    const save=h.messages.at(-1);assert.equal(save.operation,'MARGIN_REFRESH');assert.equal(save.input.taskId,taskId);
    assert.equal(save.stockGeneration,generation);assert.deepEqual(JSON.parse(db.get(key)).savePending,copy(save));
    h.send({type:'PURCHASE_SAVE_RESULT',company:'NCT',requestId:save.requestId,ok:true,
      result:{ok:true,requestId:save.requestId,stockGeneration:generation+1}});
    assert.equal(h.messages.at(-1).type,'PURCHASE_WORKSPACE_REQUEST');
    h.reply(taskId==='TASK'?refreshPacket('OTHER',10):ready(11));
  }
  h.timers.at(-1)();
  assert.equal(db.has(key),false,'last internal pending request is reconciled even after initial workspace was already restored');
  assert.equal(h.messages.filter(message=>message.type==='PURCHASE_SAVE_REQUEST').length,2);
  assert.equal(h.messages.some(message=>message.type==='PURCHASE_SAVE_CHECK_REQUEST'),false);
});
