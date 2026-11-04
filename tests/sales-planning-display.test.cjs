const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function helpers(){const context=vm.createContext({Intl,Date,Map,Set,Number,String});for(const name of ['uniqueSalesOrders','salesShipmentDate','salesPlanningEditable'])vm.runInContext(html.split(/\r?\n/).find(line=>line.startsWith('function '+name+'(')),context);return context;}
test('order badges count unique IDs regardless of product count',()=>{const h=helpers();assert.equal(h.uniqueSalesOrders([{orderId:'O1',productCount:200},{orderId:'O1',productCount:200},{orderId:'O2',productCount:1}]).length,2)});
test('shipment calendar dates are stable and reject impossible dates',()=>{const h=helpers();assert.equal(h.salesShipmentDate('2026-10-21'),'21 Oct 2026');for(const value of ['2026-02-30','','broken'])assert.equal(h.salesShipmentDate(value),'—');assert.equal(h.salesShipmentDate('2028-02-29'),'29 Feb 2028')});
test('planning edit controls follow the existing pretransfer order lock',()=>{const h=helpers();assert.equal(h.salesPlanningEditable({status:'CONFIRMED'}),true);assert.equal(h.salesPlanningEditable({status:'CONFIRMED',submittedAt:'2026-10-08'}),false);assert.equal(h.salesPlanningEditable({status:'CONFIRMED',destination:'NCT'}),false);assert.equal(h.salesPlanningEditable(undefined),false)});

function customerRefreshFixture(){
  const span={textContent:'',after(){}},badge={textContent:'',remove(){}},elements={progressCustomerSelect:{value:'C1'},progressCustomerMenu:{hidden:true,querySelectorAll:()=>[]},progressCustomerTrigger:{querySelector:selector=>selector==='span'?span:badge,setAttribute(){}},progressRefresh:{disabled:false}};
  const payload={orders:[{orderId:'O1',customerId:'C1'}]};
  const h=vm.createContext({salesProgressCustomerId:'C1',salesProgressOrderId:'O1',salesProgressPayload:payload,customerRecords:[{customerId:'C1',activeOrderLineCount:3,customerShortName:'ONE'},{customerId:'C2',activeOrderLineCount:1,customerShortName:'TWO'}],salesNavigationAllowed:()=>true,esc:value=>String(value),customerDisplayName:c=>c.customerShortName,customerAccessState:()=> 'ACTIVE',requestSalesOrderProgress:()=>{throw new Error('Unexpected fetch during same-customer refresh')},document:{getElementById:id=>elements[id]}});
  for(const name of ['selectProgressCustomer','populateOrderProgressCustomers'])vm.runInContext(html.split(/\r?\n/).find(line=>line.startsWith('function '+name+'(')),h);
  return {h,payload};
}
test('background customer refresh preserves the selected order and its canonical progress payload',()=>{const {h,payload}=customerRefreshFixture();h.populateOrderProgressCustomers();assert.equal(h.salesProgressOrderId,'O1');assert.equal(h.salesProgressPayload,payload);assert.equal(h.salesProgressCustomerId,'C1')});
test('changing to another customer clears the previous order and payload',()=>{const {h}=customerRefreshFixture();h.selectProgressCustomer('C2',false);assert.equal(h.salesProgressOrderId,'');assert.equal(h.salesProgressPayload,null);assert.equal(h.salesProgressCustomerId,'C2')});
