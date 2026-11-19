const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../support-room/workroom.js'),'utf8');
const get=name=>script.split(/\r?\n/).find(s=>s.trimStart().startsWith('function '+name+'('));
test('switching customers clears only known completed notices, keeping unresolved error messages',()=>{
 for(const [notice,expected] of [['Saved',''],['Desk authorized to Warehouse.',''],['Warehouse task recalled.',''],['Retry the same save','Retry the same save']]){
  const nodes={notice:{textContent:notice},'customer-filter':{}},c=vm.createContext({selectedCustomer:'A',activeDesk:1,selectedOrder:'O',selectedLines:new Set(),$:id=>nodes[id]});
  vm.runInContext(get('chooseCustomer'),c);c.chooseCustomer('B');assert.equal(nodes.notice.textContent,expected);assert.equal(c.selectedCustomer,'B');
 }
});
test('same-customer navigation does not discard its save acknowledgement',()=>{
 const nodes={notice:{textContent:'Saved'},'customer-filter':{}},c=vm.createContext({selectedCustomer:'A',activeDesk:1,selectedOrder:'O',selectedLines:new Set(),$:id=>nodes[id]});
 vm.runInContext(get('chooseCustomer'),c);c.chooseCustomer('A');assert.equal(nodes.notice.textContent,'Saved');
});
test('Support shipped date uses actual departure and cannot substitute ETD',()=>{
 let head;const c=vm.createContext({data:{orders:[]},table:(h,r)=>{head=h;return r.join('');},esc:String,day:v=>v||'—',number:v=>String(v),docs:()=>''});
 vm.runInContext(get('invoiceTable'),c);
 const base={customerId:'A',id:'I',number:'SI',lines:[],date:'2026-11-05',currency:'USD',amountCents:100,deskNumber:1};
 assert.match(c.invoiceTable([{...base,deskShipment:{date:'2026-11-20'}}]),/<td>—<\/td>/);
 assert.match(c.invoiceTable([{...base,deskShipment:{date:'2026-11-20',departureDate:'2026-11-21'}}]),/2026-11-21/);
 assert(head.some(row=>row[0]==='Shipped On'));
});
test('late original receipts update shared data but their success notice is customer-scoped',()=>{
 assert(script.includes("if(selectedCustomer===customerId)$('notice').textContent='Saved'"));
 assert(script.includes("if(selectedCustomer===deliveryCustomer)$('notice').textContent=result.status"));
 assert(script.includes("const deliveryCompany=company,deliveryCustomer=selectedCustomer;"));
});
