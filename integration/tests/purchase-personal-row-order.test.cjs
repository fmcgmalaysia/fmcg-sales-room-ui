const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../purchase-live/display-rows.js'),'utf8');
const copy=v=>JSON.parse(JSON.stringify(v)),key=(id,batch='')=>JSON.stringify([id,batch]);
function storage(){const values=new Map();let writes=0;return {values,get writes(){return writes;},getItem:k=>values.get(k)||null,setItem(k,v){writes++;values.set(k,v);}};}
function ui(localStorage){const window={};vm.runInNewContext(source,{window,localStorage});return window.purchaseDisplayRows;}
function data(company='NCT',staff='S'){return {company,staff:{staffId:staff,memberId:'M'},tasks:['A','B','C'].map(id=>({id,customerId:'CUSTOMER',orderId:'O',ord:100,rowPosition:1,editVersion:'V',history:[]}))};}
test('personal order overwrites one preference, survives reload and never mutates business data',()=>{
 const store=storage(),d=data(),before=copy(d),a=ui(store);a.configure(d,d.company);a.remember(d,'CUSTOMER',[key('C'),key('A'),key('B')]);a.remember(d,'CUSTOMER',[key('B'),key('A'),key('C')]);
 assert.equal(store.values.size,1);assert.equal(store.writes,2);assert.deepEqual(d,before);const b=ui(store);b.configure(d,d.company);assert.deepEqual(copy(b.current(d,'CUSTOMER')),[key('B'),key('A'),key('C')]);b.remember(d,'CUSTOMER',b.current(d,'CUSTOMER'));assert.equal(store.writes,2);
 assert.doesNotMatch([...store.values.values()][0],/editVersion|history|ord|quantity|price|cost/i);
});
test('scope isolates employee, company and member without an anonymous preference',()=>{
 const store=storage(),a=ui(store),d=data();a.configure(d,'NCT');a.remember(d,'CUSTOMER',[key('C'),key('B'),key('A')]);
 for(const other of [data('NCT','OTHER'),data('GHR'),{...data(),staff:{staffId:'S',memberId:'OTHER'}},{...data(),staff:null}]){a.configure(other,other.company);assert.deepEqual(copy(a.current(other,'CUSTOMER')),[key('A'),key('B'),key('C')]);}
 assert.equal(store.values.size,1);a.configure(d,'NCT');assert.equal(a.current(d,'CUSTOMER')[0],key('C'));
});
test('new, archived, duplicate, invalid and split identities reconcile at the original task position',()=>{
 const store=storage(),a=ui(store),d=data();a.configure(d,'NCT');a.remember(d,'CUSTOMER',[key('C'),key('A'),key('B')]);d.tasks[1].archived=true;d.tasks.push({id:'NEW',customerId:'CUSTOMER'});
 d.shipmentPlans=[{id:'P',customerId:'CUSTOMER',orderId:'O',batches:[{sequence:1,lines:[{taskId:'A',quantity:50}]},{sequence:2,lines:[{taskId:'A',quantity:50}]}]}];
 assert.deepEqual(copy(a.current(d,'CUSTOMER')),[key('C'),key('A','P|1'),key('A','P|2'),key('NEW')]);a.remember(d,'CUSTOMER',[key('C'),key('C'),'invalid',key('FOREIGN'),key('A','P|2'),key('A','P|1')]);
 assert.deepEqual(copy(a.current(d,'CUSTOMER')),[key('C'),key('A','P|2'),key('A','P|1'),key('NEW')]);d.shipmentPlans=[];assert.deepEqual(copy(a.current(d,'CUSTOMER')),[key('C'),key('A'),key('NEW')]);
});
test('supplier sources remain attached once and personal rendering does not reorder input',()=>{
 const a=ui(storage()),d=data();d.tasks.push({id:'SOURCE',customerId:'CUSTOMER',customerDemandTaskId:'A',procurementSource:true});a.configure(d,'NCT');a.remember(d,'CUSTOMER',[key('C'),key('A'),key('B')]);
 assert.deepEqual(copy(a.taskSequence(d,'CUSTOMER',a.current(d,'CUSTOMER'))),['C','A','SOURCE','B']);const before=copy(d);
 const markup='<tr data-id="A"><td></td></tr><tr data-source-id="SOURCE"><td>source</td></tr><tr data-id="B"><td></td></tr><tr data-id="C"><td></td></tr>',html=a.decorate(markup,d);
 assert.ok(html.indexOf('data-id="C"')<html.indexOf('data-id="A"'));assert.ok(html.indexOf('data-id="A"')<html.indexOf('data-source-id="SOURCE"'));assert.equal((html.match(/data-source-id=/g)||[]).length,1);assert.deepEqual(d,before);
});
test('unavailable or full storage keeps personal order in memory across workspace refreshes',()=>{
 for(const store of [undefined,{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},{getItem:()=>JSON.stringify([['CUSTOMER',[key('A'),key('B'),key('C')]]]),setItem(){throw Error('quota');}}]){
  const a=ui(store),d=data();a.configure(d,'NCT');assert.equal(a.remember(d,'CUSTOMER',[key('C'),key('B'),key('A')]).persisted,false);a.configure(d,'NCT');assert.equal(a.current(d,'CUSTOMER')[0],key('C'));
 }
});
test('tabs merge independent customer preferences and no-op moves do not write',()=>{
 const store=storage(),a=ui(store),b=ui(store),d=data();d.tasks.push({id:'D1',customerId:'SECOND'},{id:'D2',customerId:'SECOND'});a.configure(d,'NCT');b.configure(d,'NCT');
 a.remember(d,'CUSTOMER',[key('C'),key('A'),key('B')]);b.remember(d,'SECOND',[key('D2'),key('D1')]);a.remember(d,'CUSTOMER',[key('B'),key('C'),key('A')]);
 const c=ui(store);c.configure(d,'NCT');assert.equal(c.current(d,'SECOND')[0],key('D2'));assert.equal(c.current(d,'CUSTOMER')[0],key('B'));const n=store.writes;c.remember(d,'CUSTOMER',c.current(d,'CUSTOMER'));assert.equal(store.writes,n);
});
