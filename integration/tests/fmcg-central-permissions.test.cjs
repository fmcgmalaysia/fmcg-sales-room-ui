const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('./load-master-module.cjs')('staffManagementPolicy.js');
const root = path.join(__dirname, '../..');
const clean = file => fs.readFileSync(path.join(root,file),'utf8').replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'');
const client = vm.runInNewContext(clean('backend/masterStaffAccessClient.js')+'\n({staffMayAccessCustomer,requireStaffCustomerAccess})');
const customer = {customerId:'customer-a',title:'Customer A',assignedStaffId:'someone-else',qdStatus:'READY',qdFileId:'qd-a'};
function fixture(file, names, level='VIEW', options={}) {
  let scopeCalls=0; const writes=[], reads=[];
  const directoryStaff={staffStatus:'ACTIVE',role:'STAFF',staffAccess:{salesRoom:level,salesFunction:options.salesFunction||'SUPPORT',customerAccess:{'customer-a':'EDIT'}}};
  const context={authorized:true,memberId:'member-a',staffId:'staff-a',staffName:'Staff A',loginEmail:'staff@example.com',role:'STAFF',customerScope:policy.projectFmcgStaffScope(directoryStaff)};
  const rows={WixCustomers:[customer],WixCustomerUsers:[{_id:'user-a',userId:'user-a',customerId:'customer-a',wixMemberId:'member-a',status:'ACTIVE',title:'Customer User'}],WixBuyerOrders:[{_id:'order-record',title:'order-a',payload:JSON.stringify({orderId:'order-a',customerId:'customer-a'})}],...(options.rows||{})};
  const api=vm.runInNewContext(clean(file)+'\n({'+names.join(',')+'})',{
    ...client,Permissions:{SiteMember:'SiteMember',Anyone:'Anyone'},webMethod:(_,handler)=>handler,
    currentMember:{getMember:async()=>({_id:'member-a',loginEmail:'staff@example.com'})},
    getCurrentStaffContext:async()=>{scopeCalls++;return options.denied?{authorized:false}:context;},
    wixData:{query(collection){reads.push(collection);const filters=[];const q={
      eq(field,value){filters.push(row=>row[field]===value);return q;},limit(){return q;},
      hasSome(field,values){filters.push(row=>values.includes(row[field]));return q;},
      async find(){return {items:(rows[collection]||[]).filter(row=>filters.every(f=>f(row))),hasNext:()=>false};}
    };return q;},async insert(...args){writes.push(args);throw Error('Unexpected write');},async update(...args){writes.push(args);throw Error('Unexpected write');}},
    console,Buffer,setTimeout,clearTimeout
  });
  return {api,reads,writes,context,get scopeCalls(){return scopeCalls;}};
}
test('Buyer assisted View resolves a centrally assigned customer even when the legacy owner differs',async()=>{
  const f=fixture('backend/catalogueAuth.web.js',['resolveBuyerContext']);
  assert.equal((await f.api.resolveBuyerContext('customer-a')).customerId,'customer-a');
  assert.equal(f.scopeCalls,1); assert.equal(f.writes.length,0);
  await assert.rejects(f.api.resolveBuyerContext('customer-a','ASSIST_SELECTION'),/permission/);
  await assert.rejects(f.api.resolveBuyerContext('customer-a','SEND_ORDER_REQUEST'),/permission/);
});
test('Buyer quantity, remove, restore and order methods deny View before any business write',async()=>{
  const names=['saveBuyerQuantity','removeBuyerItem','recoverBuyerItem','submitBuyerOrder'];
  const f=fixture('backend/catalogueAuth.web.js',names);
  for(const [name,args] of [['saveBuyerQuantity',['item-a',100,'customer-a']],['removeBuyerItem',['item-a','customer-a']],['recoverBuyerItem',['item-a','customer-a']],['submitBuyerOrder',[[{itemId:'item-a',quantityCtn:1}],'customer-a']]]) {
    await assert.rejects(f.api[name](...args),/permission/);
  }
  assert.equal(f.writes.length,0);
  assert.equal(f.reads.includes('WixBuyerListItems'),false);
});
test('a real customer keeps the original login path without the employee service',async()=>{
  const f=fixture('backend/catalogueAuth.web.js',['resolveBuyerContext'],'VIEW',{denied:true});
  const buyer=await f.api.resolveBuyerContext('');
  assert.equal(buyer.actorType,'CUSTOMER_USER'); assert.equal(f.scopeCalls,0);
});
test('Catalogue View can read selection but cannot add or retry a selection',async()=>{
  const f=fixture('backend/catalogueSelection.web.js',['resolveSelectionContext_','addCatalogueSelection','routeCatalogueSelection']);
  assert.equal((await f.api.resolveSelectionContext_('customer-a')).customerId,'customer-a');
  await assert.rejects(f.api.addCatalogueSelection('product-a','customer-a'),/permission/);
  await assert.rejects(f.api.routeCatalogueSelection('item-a','customer-a'),/permission/);
  assert.equal(f.writes.length,0); assert.equal(f.reads.includes('FMCGMALAYSIA'),false);
});
test('Support Edit can assist selection and send orders but cannot gain quotation permission',async()=>{
  const f=fixture('backend/catalogueAuth.web.js',['resolveBuyerContext'],'EDIT');
  for(const action of ['ASSIST_SELECTION','SEND_ORDER_REQUEST']) assert.equal((await f.api.resolveBuyerContext('customer-a',action)).customerId,'customer-a');
  await assert.rejects(f.api.resolveBuyerContext('customer-a','PUBLISH_QUOTATION'),/permission/);
  await assert.rejects(f.api.resolveBuyerContext('customer-a','EDIT_QUOTATION'),/permission/);
  await assert.rejects(f.api.resolveBuyerContext('customer-a','MANAGE_CUSTOMER'),/permission/);
});
test('Support can view Buyer and Sales customer data without receiving a link to the quote editor',async()=>{
  const buyer=fixture('backend/catalogueAuth.web.js',['getCurrentBuyerContext'],'EDIT');
  const assisted=await buyer.api.getCurrentBuyerContext('customer-a');
  assert.equal(assisted.ok,true);
  assert.equal(assisted.buyer.qdFileId,undefined);
  const sales=fixture('sales-room/wix/onboarding.web.js',['getSalesRoomCustomers','resolveCustomerRouting'],'EDIT');
  assert.equal((await sales.api.getSalesRoomCustomers()).customers[0].qdFileId,'');
  await assert.rejects(sales.api.resolveCustomerRouting('staff-a'),/Sales edit access/);
  const editor=fixture('sales-room/wix/onboarding.web.js',['getSalesRoomCustomers'],'EDIT',{salesFunction:'SALES'});
  assert.equal((await editor.api.getSalesRoomCustomers()).customers[0].qdFileId,customer.qdFileId);
});
test('Sales customer checks deny unknown customers before reading the directory',async()=>{
  const f=fixture('sales-room/wix/onboarding.web.js',['findAuthorizedCustomer']);
  await assert.rejects(f.api.findAuthorizedCustomer('customer-b',f.context),/permission/);
  assert.equal(f.reads.length,0);
  assert.equal((await f.api.findAuthorizedCustomer('customer-a',f.context)).customerId,'customer-a');
});
test('Sales View order mutation is denied before acquiring a lock or changing records',async()=>{
  const f=fixture('sales-room/wix/onboarding.web.js',['withSalesOrderMutation']);
  let called=false;
  await assert.rejects(f.api.withSalesOrderMutation('order-a',f.context,async()=>{called=true;}),/permission/);
  assert.equal(called,false);assert.equal(f.writes.length,0);
});
test('an already-open Buyer tab rechecks revoked access on the next action',async()=>{
  const f=fixture('backend/catalogueAuth.web.js',['resolveBuyerContext'],'EDIT',{denied:true});
  await assert.rejects(f.api.resolveBuyerContext('customer-a','SEND_ORDER_REQUEST'),/authorization/);
  assert.equal(f.writes.length,0);
});
