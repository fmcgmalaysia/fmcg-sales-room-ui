const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { transforms } = require('./stage-customer-name-order.cjs');

const site = process.argv[2];
const read = file => fs.readFileSync(path.join(site, file), 'utf8');
const normalize = value => JSON.parse(JSON.stringify(value));

for (const file of Object.keys(transforms)) {
  const source = read(file);
  if (file.endsWith('.js')) new vm.Script(source, { filename: file });
  else for (const script of source.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (!script[2].trim()) continue;
    if (/type=["']module["']/.test(script[1] || '')) {
      execFileSync(process.execPath, ['--check','--input-type=module'], { input: script[2] });
    } else new vm.Script(script[2], { filename: file });
  }
}

const staff = read('master-staff/index.html');
const staffCode = staff.slice(staff.indexOf('  function renderCustomerAccess('),staff.indexOf('  function showSaveStatus'));
let entries;
const grants = { z:'EDIT', two:'VIEW', unknown:'VIEW' };
class Option {
  constructor(name, value) { this.name = name; this.value = value; }
}
const element = () => ({ children: [], dataset: {}, append(...nodes) { this.children.push(...nodes); }, add(node) { this.children.push(node); } });
const staffContext = { customers:[{id:'z',name:'Zulu'},{id:'ten',name:' Alpha 10'},{id:'two',name:'alpha 2'}],
  id: () => ({ replaceChildren(...nodes) { entries = nodes; } }), document: { createElement: element }, Option, grants };
vm.runInNewContext(staffCode + '\nrenderCustomerAccess(grants);', staffContext);
assert.deepEqual(normalize(entries.map(row => [row.children[1].dataset.customerId, row.children[1].value])),
  [['two','VIEW'],['ten',''],['unknown','VIEW'],['z','EDIT']]);
assert.deepEqual(grants,{ z:'EDIT', two:'VIEW', unknown:'VIEW' });
assert.deepEqual(staffContext.customers.map(row=>row.id),['z','ten','two']);

const clients = [{customerId:'z',companyName:'Alpha Company',customerShortName:'Zulu'},
  {customerId:'ten',companyName:'Beta Company',customerShortName:'Alpha 10'},
  {customerId:'two',companyName:'Zulu Company',customerShortName:'alpha 2'}];
for (const name of Object.keys(transforms).filter(file => file === 'index.html' || file.startsWith('sales-room'))) {
  const source = read(name);
  const display = source.match(/^function customerDisplayName[^\n]+/m)[0];
  const comparator = source.slice(source.indexOf('function customerAlphaCompare'),source.indexOf('/* V47: recover'));
  const order = vm.runInNewContext(display+'\n'+comparator+'\n'+
    `[clients.slice().sort(customerAlphaCompare).map(c=>c.customerId),
      clients.slice().sort((a,b)=>customerAlphaCompare(a,b,c=>c.companyName)).map(c=>c.customerId)]`, {clients});
  assert.deepEqual(normalize(order),[['two','ten','z'],['z','ten','two']]);
  const progress = source.match(/^function populateOrderProgressCustomers[^\n]+/m)[0];
  assert(progress.includes('.sort(customerAlphaCompare)'));
  assert(progress.includes('Number(customer.activeOrderLineCount)>0'));
  assert(!source.includes('function buyerActivityCompare('));
}

const purchase = read('purchase-live/app.js');
const purchaseSort = purchase.slice(purchase.indexOf('const customerCollator'),purchase.indexOf('  function roomRows(){'));
const customerIds = vm.runInNewContext(purchaseSort+'\norderedCustomerIds([{customerId:"z"},{customerId:"a"},{customerId:"z"}])',
  {data:{customers:[{id:'z',name:'A Company',shortName:'Zulu'},{id:'a',name:'Z Company',shortName:'Alpha'}]}});
assert.deepEqual(normalize(customerIds),['a','z']);
assert(purchase.includes('orderedCustomerIds(rows).flatMap'));

const balances = [{customerName:'Zulu',customerId:'z',order:1},{customerName:'Alpha',customerId:'a',order:2},
  {customerName:'Zulu',customerId:'z',order:3},{customerName:'Alpha',customerId:'a',order:4}];
for (const name of ['support-room/workroom.js','warehouse-room/app.js','warehouse-room/workroom.js','account-room/customer-debtors.js']) {
  const source = read(name);
  const compare = source.match(/^\s*const customerCollator[^\n]+\nconst compareCustomerText[^\n]+/m)[0];
  const comparator = source.match(/\(a, b\) => compareCustomerText\(a.customerName, b.customerName\) \|\| compareCustomerText\(a.customerId, b.customerId\)/)[0];
  const order = vm.runInNewContext(compare+'\nitems.slice().sort('+comparator+').map(row=>row.order)',{items:balances});
  assert.deepEqual(normalize(order),[2,4,1,3]);
}

console.log('Validated all nine assets, Staff grant IDs, all Sales Room routes, Purchase short names and stable order within customers.');
