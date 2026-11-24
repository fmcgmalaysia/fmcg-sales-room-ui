const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const baseline = {
  'master-staff/index.html': 'ea8ea123f54bb5f94c1a696820c3f693154cb655ff7eeb6a2ea2fb33855ef7fe',
  'sales-room-20261123-workspace-entry.html': 'cfe84e58a1fd52382097ef619d399a56c4f25c287fea8e34968860431e98bd8b',
  'sales-room-20261123-mobile-buyer-entry.html': '901ab238ac24258febd14b1cb9ac67e843570092efb25a1bc2a3161865fc187f',
  'index.html': '7131a0f6397fcb229529ccbdf3fe8b223529a48227770fc4d50d240e9295a32f',
  'support-room/workroom.js': '8400beae07295d4b56282494659251aec2c0d058bdf57384a29617313702c4f7',
  'purchase-live/app.js': '028f678a661d1ea49ee658e28615768c73a0926097301c77f1e744822dda2072',
  'warehouse-room/workroom.js': '68769a4eb1dc19e0d6cbce2dc12188d5ad495a433825401c89458cb250fea8a1',
  'warehouse-room/app.js': '67163fe7599b0615156e7e3cda25a8747b60874eb9eb19314ca3388b4efc54ec',
  'account-room/customer-debtors.js': 'e6fe89abc8492c4a408fa9b113de20394603b5a1ca07246da6e0c21f007da8d1'
};

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Missing or repeated patch anchor: ' + before);
  return source.replace(before, () => after);
}

const collator = "new Intl.Collator('en', { sensitivity: 'base', numeric: true })";
const compare = "const customerCollator = " + collator + ";\n" +
  "const compareCustomerText = (a, b) => customerCollator.compare(String(a ?? '').trim(), String(b ?? '').trim());\n";
const compareIds = " || compareCustomerText(a.id, b.id)";
const compareName = "(a, b) => compareCustomerText(a.name, b.name)" + compareIds;
const compareLine = "(a, b) => compareCustomerText(a.customerName, b.customerName) || compareCustomerText(a.customerId, b.customerId)";
const compareOptions = "([aId, aName], [bId, bName]) => compareCustomerText(aName, bName) || compareCustomerText(aId, bId)";

function staff(source) {
  return replaceOnce(source, "    id('customer-options').replaceChildren(...[...known].map",
    "    const collator = " + collator + ";\n" +
    "    const ordered = [...known].sort(([idA, nameA], [idB, nameB]) =>\n" +
    "      collator.compare(String(nameA ?? '').trim(), String(nameB ?? '').trim()) || collator.compare(idA, idB));\n" +
    "    id('customer-options').replaceChildren(...ordered.map");
}

function sales(source) {
  source = replaceOnce(source,
    "function buyerActivityCompare(a,b){const timeA=buyerLastActivity(a),timeB=buyerLastActivity(b);return timeB-timeA||customerAlphaCompare(a,b)}\n",
    '');
  source = replaceOnce(source, '.sort(buyerActivityCompare)',
    ".sort((a,b)=>customerAlphaCompare(a,b,customer=>customer.companyName||customer.customerId))");
  source = replaceOnce(source,
    "function customerAlphaCompare(a,b){\n  const nameA=String(a?.companyName||a?.customerId||'').trim();\n  const nameB=String(b?.companyName||b?.customerId||'').trim();",
    "function customerAlphaCompare(a,b,displayName=customerDisplayName){\n" +
    "  const nameA=String(displayName(a)||a?.customerId||'').trim();\n" +
    "  const nameB=String(displayName(b)||b?.customerId||'').trim();");
  const start = source.indexOf('function populateOrderProgressCustomers(){');
  if (start < 0) throw Error('Missing Sales Room Order Progress');
  const end = source.indexOf('\n', start);
  const progress = replaceOnce(source.slice(start, end),
    '.sort((a,b)=>Number(b.activeOrderLineCount)-Number(a.activeOrderLineCount)||customerDisplayName(a).localeCompare(customerDisplayName(b)))',
    '.sort(customerAlphaCompare)');
  return source.slice(0, start) + progress + source.slice(end);
}

function purchase(source) {
  source = replaceOnce(source, '  function roomRows(){',
    '  ' + compare +
    "  function orderedCustomerIds(rows) {\n" +
    "    const names = new Map((data?.customers || []).map(customer => [customer.id, customer.shortName || customer.name]));\n" +
    "    return [...new Set(rows.map(row => row.customerId))].sort((a, b) =>\n" +
    "      compareCustomerText(names.get(a) || a, names.get(b) || b) || compareCustomerText(a, b));\n" +
    "  }\n" +
    '  function roomRows(){');
  source = replaceOnce(source, 'return [...new Set(rows.map(row=>row.customerId))].flatMap(id=>',
    'return orderedCustomerIds(rows).flatMap(id=>');
  source = replaceOnce(source, '${data.customers.map(c=>{const tasks=',
    '${[...data.customers].sort(' + compareName + ').map(c=>{const tasks=');
  return replaceOnce(source, "customers=[{id:'',name:'All Customers 全部客户'},...data.customers]",
    "customers=[{id:'',name:'All Customers 全部客户'},...[...data.customers].sort((a,b)=>\n" +
    "      compareCustomerText(a.shortName || a.name, b.shortName || b.name) || compareCustomerText(a.id,b.id))]");
}

function support(source) {
  source = replaceOnce(source, '  function ordersTable(rows){', '  ' + compare + '  function ordersTable(rows){');
  source = replaceOnce(source, "['Invoice No.'],['Docs']],rows.map", "['Invoice No.'],['Docs']],[...rows].sort(" + compareLine + ').map');
  source = replaceOnce(source, "      $('count').textContent=rows.length+' customers';",
    "      const ordered = [...rows].sort(" + compareName + ");\n      $('count').textContent=rows.length+' customers';");
  source = replaceOnce(source, "['Desk Details'],['']],rows.map((row,index)=>{", "['Desk Details'],['']],ordered.map((row,index)=>{");
  return replaceOnce(source, "+data.customers.map(row=>'<option value=", "+[...data.customers].sort(" + compareName + ").map(row=>'<option value=");
}

function warehouseApp(source) {
  source = replaceOnce(source, 'function customerTable(){', compare + 'function customerTable(){');
  source = replaceOnce(source, "includes(query))),required=lines.reduce", "includes(query))).sort(" + compareLine + "),required=lines.reduce");
  return replaceOnce(source, "+[...customers].map(([id,name])=>'<option value=", "+[...customers].sort(" + compareOptions + ").map(([id,name])=>'<option value=");
}

function warehouseWorkroom(source) {
  source = replaceOnce(source, 'function delivery(){', compare + 'function delivery(){');
  source = replaceOnce(source, "filter==='loaded'&&i.status==='LOADED'));", "filter==='loaded'&&i.status==='LOADED')).sort(" + compareLine + ");");
  return replaceOnce(source, "[['','All Customers 全部客户'],...customers].map", "[['','All Customers 全部客户'],...[...customers].sort(" + compareOptions + ")].map");
}

function debtors(source) {
  source = replaceOnce(source, ' function paint(){', ' ' + compare + ' function paint(){');
  source = replaceOnce(source, "includes(query.toLowerCase())));app.innerHTML", "includes(query.toLowerCase()))).sort(" + compareLine + ");app.innerHTML");
  source = replaceOnce(source, "(data?.customers||[]).map(row=>'<option value=", "[...(data?.customers||[])].sort(" + compareName + ").map(row=>'<option value=");
  return replaceOnce(source, "row.customerId===customer).map(row=>'<span>'", "row.customerId===customer).sort(" + compareLine + ").map(row=>'<span>'");
}

const transforms = {
  'master-staff/index.html': staff,
  'sales-room-20261123-workspace-entry.html': sales,
  'sales-room-20261123-mobile-buyer-entry.html': sales,
  'index.html': sales,
  'purchase-live/app.js': purchase,
  'support-room/workroom.js': support,
  'warehouse-room/app.js': warehouseApp,
  'warehouse-room/workroom.js': warehouseWorkroom,
  'account-room/customer-debtors.js': debtors
};

function stage(site) {
  const outputs = new Map();
  for (const [file, hash] of Object.entries(baseline)) {
    const target = path.join(site, file);
    const bytes = fs.readFileSync(target);
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error('Unexpected published baseline: ' + file);
    const input = bytes.toString('utf8').replace(/\r\n/g, '\n');
    const patched = transforms[file](input);
    outputs.set(target, input === bytes.toString('utf8') ? patched : patched.replace(/\n/g, '\r\n'));
  }
  for (const [target, content] of outputs) fs.writeFileSync(target, content);
}

if (require.main === module) stage(path.resolve(process.argv[2]));
module.exports = { stage, transforms };
