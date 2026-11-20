const fs=require('node:fs');
const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const root=process.argv[2];
const source=(name)=>fs.readFileSync(root+'/'+name+'.after','utf8');
const script=(name)=>source(name).match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(code, desktop=false) {
 const parent={postMessage:message=>messages.push(JSON.parse(JSON.stringify(message)))};
 const nodes=new Map(), listeners={}, messages=[], timers=new Map();
 let timerId=0;
 function node(tag='node'){
  const attributes=new Map(), classes=new Set(), events={};
  const element={
   tag, dataset:{}, style:{setProperty(){}}, children:[], textContent:'', value:'', focused:false, disabled:false,
   classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key), contains:key=>classes.has(key),add:key=>classes.add(key)},
   getAttribute:k=>attributes.get(k), setAttribute:(k,v)=>attributes.set(k,v), hasAttribute:k=>attributes.has(k), removeAttribute:k=>attributes.delete(k),
   set href(value){attributes.set('href',value)}, get href(){return attributes.get('href')},
   get firstChild(){return this.children[0]}, getBoundingClientRect:()=>({left:325}), focus(){this.focused=true},
   addEventListener:(name,handler)=>{events[name]=handler;},
   fire:(name,value={})=>events[name]?.(value),
   querySelector:selector=>get(tag+selector), append:(...values)=>element.children.push(...values),
   appendChild:child=>element.children.push(child), replaceChildren:(...values)=>{element.children=values;},
  };
  return element;
 }
 function get(id){if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);}
 const category=get('nav-health');category.dataset.key='PERSONAL CARE';
 const environment={
  parent, document:{getElementById:get,querySelector:get,querySelectorAll:()=>[category],createElement:node,addEventListener:(e,fn)=>{listeners['document:'+e]=fn;}},
  window:{parent,matchMedia:()=>({matches:desktop,addEventListener(){}}),addEventListener:(e,fn)=>{listeners[e]=fn;}},
  matchMedia:()=>({matches:!desktop}),
  setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:i=>timers.delete(i),
 };
 vm.runInNewContext(code,environment);
 return {get,category,messages,flush:()=>{for(const fn of [...timers.values()])fn();timers.clear();},fromParent:data=>listeners.message({source:parent,data}),escape:()=>listeners['document:keydown']?.({key:'Escape'})};
}
test('mobile icon keeps accessibility state and restores focus when dialog closes',()=>{
 const h=fixture(script('catalogue-header-v2.html'));
 const icon=h.get('mobileCategory');icon.onclick();
 assert.deepEqual(h.messages.at(-1),{type:'catalogueMobileCategories',open:true});
 h.fromParent({type:'catalogueMobileCategoriesState',open:true});
 assert.equal(icon.getAttribute('aria-expanded'),'true');icon.onclick();
 assert.deepEqual(h.messages.at(-1),{type:'catalogueMobileCategories',open:false});
 h.fromParent({type:'catalogueMobileCategoriesState',open:false,returnFocus:true});
 assert.equal(icon.focused,true);
});
test('mobile search still posts the typed query and the cart keeps its authorized hand-off',()=>{
 const h=fixture(script('catalogue-header-v2.html'));
 h.get('mobileSearch').value='soap';h.get('mobileSearch').fire('input');h.flush();
 assert(h.messages.some(m=>m.type==='catalogueSearch'&&m.query==='soap'));
 h.fromParent({type:'catalogueContext',buyerRoomUrl:'/buyer-room',mode:'buyer',sheetName:'Long account'});
 assert.equal(h.get('mobileCompany').textContent,'Long account');
 h.get('buyerRoom').fire('click',{preventDefault(){}});
 assert.equal(h.messages.at(-1).type,'catalogueBuyerRoom');
 h.fromParent({type:'catalogueBuyerRoomPending',pending:true});
 const count=h.messages.length;h.get('buyerRoom').fire('click',{preventDefault(){}});assert.equal(h.messages.length,count);
});
test('desktop category announces its location and second click closes it',()=>{
 const h=fixture(script('catalogue-header-v2.html'),true);
 h.category.fire('click');assert.deepEqual(h.messages.at(-1),{type:'catalogueMain',main:'PERSONAL CARE',anchor:325,open:true});
 h.category.fire('click');assert.deepEqual(h.messages.at(-1),{type:'catalogueMain',main:'PERSONAL CARE',open:false});
});
test('desktop View All applies only the active category and no longer shows All Non-Food',()=>{
 const menu=fixture(script('catalogue-mega-menu-v3.html'),true);
 menu.fromParent({type:'catalogueMenuData',items:[
  {id:'H',title:'Laundry',mainCategory:'HOUSEHOLDS'},
  {id:'P',title:'Shampoo',mainCategory:'PERSONAL CARE'},
  {id:'Q',title:'Soap',mainCategory:'PERSONAL CARE'},
 ]});
 menu.fromParent({type:'showMain',main:'PERSONAL CARE',anchor:325});
 const group=menu.get('groups').children;
 assert.equal(group.length,1);
 assert.equal(group[0].children[0],'View All Personal Care');
 group[0].onclick();
 assert.deepEqual(menu.messages.at(-1),{type:'catalogueGroup',ids:['P','Q']});
 menu.fromParent({type:'showMain',main:'HOUSEHOLDS',anchor:200});
 assert.equal(menu.get('groups').children[0].children[0],'View All Household & Cleaning');
 menu.escape();assert.equal(menu.messages.at(-1).type,'catalogueMegaClose');
});
test('candidate keeps real search, selection, product and authorized cart paths',()=>{
 const relay=source('catalogue-page.js');
 const workspace=source('catalogue-workspace-v1.html');
 assert(relay.includes("workspace.postMessage({ type: 'catalogueMobileCategories', open: message.open === true })"));
 assert(relay.includes("await applySearch(message.query)")&&relay.includes('await addCatalogueSelection(productId, assistCustomerId)'));
 assert(relay.includes("session.setItem('staffBuyerEntryV1'"));
 assert(workspace.includes("if(d.type==='catalogueMobileCategories'&&e.source===parent&&mobile.matches)"));
 assert(workspace.includes("Restore in Buyer Room"));
 assert(!workspace.includes('All Non-Food')&&!source('catalogue-mega-menu-v3.html').includes('All Non-Food'));
});
