const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const site = process.argv[2];
const folder = path.join(__dirname, '../../prototypes/master-workroom-domain-20261119/wix');
const wixOriginal = fs.readFileSync(path.join(folder, 'warehouse-page.after.js'), 'utf8').replace(/\r\n/g, '\n');
const patch = fs.readFileSync(path.join(__dirname, 'warehouse-wix.patch'), 'utf8').replace(/\r\n/g, '\n');
const lines = wixOriginal.split('\n');
for (const hunk of patch.split(/^@@ -/m).slice(1).reverse()) {
  const match = hunk.match(/^(\d+)(?:,(\d+))? \+[^\n]*\n/);
  assert(match);
  const count = Number(match[2] ?? 1);
  const start = Number(match[1]) + (count ? -1 : 0);
  const body = hunk.slice(match[0].length).split('\n');
  const old = body.filter(row => row.startsWith('-')).map(row => row.slice(1));
  const next = body.filter(row => row.startsWith('+')).map(row => row.slice(1));
  assert.deepEqual(lines.slice(start, start + count), old);
  lines.splice(start, count, ...next);
}
const wix = lines.join('\n');
const app = fs.readFileSync(path.join(site,'warehouse-room/app.js'), 'utf8');
const index = fs.readFileSync(path.join(site,'warehouse-room/index.html'), 'utf8');
const marker = '20261120-warehouse-incoming-identity-v1';

function relay(getWarehouseOrders, member) {
  const replies = [];
  const receiptRequests = [];
  let receive;
  const room = { onMessage(fn){ receive = fn; }, postMessage(result){ replies.push(result); } };
  vm.runInNewContext(wix.replace(/^import .*;\n/gm,''), {
    $w: Object.assign(() => room, { onReady: fn => fn() }),
    currentMember: { getMember: member },
    handlePackingList: async () => false,
    getWarehouseOrders,
    saveWarehouseReceipt: async (...args) => { receiptRequests.push(args); return { ok:true }; },
    setTimeout, clearTimeout,
  });
  return { room, replies, receiptRequests, send: data => receive({ data }) };
}

function surface() {
  const sent = [];
  const nodes = new Map();
  const parent = { postMessage: message => sent.push(message) };
  const listeners = {};
  let id = 0;
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, {
      value: '', innerHTML: '', open:false, disabled:false, hidden:true, textContent:'',
      classList:{toggle(){}}, setAttribute(){}, addEventListener(){}, querySelectorAll:()=>[], querySelector:()=>null,
    });
    return nodes.get(key);
  }
  vm.runInNewContext(app, {
    parent, document:{ getElementById:node, querySelectorAll:()=>[], querySelector:node, addEventListener(){} },
    window:{ addEventListener:(type,fn)=>{listeners[type]=fn;} }, setTimeout:()=>0, clearTimeout(){}, setInterval(){},
    crypto:{randomUUID:()=>String(++id)}, URLSearchParams, location:{search:''},
  });
  return { node, sent, emit: (data, source=parent) => listeners.message({source,data}) };
}

test('verified Wix embed and Pages script use the same isolated build', () => {
  assert(index.includes('src="app.js?v='+marker+'"'));
  assert(wix.includes('warehouse-room/?v='+marker));
});

for (const company of ['NCT','GHR']) test(company+' uses the existing warehouse read and save endpoints', async () => {
  const orderResult = { company, staff:{staffName:'Test Employee'}, orders:[] };
  const wiring = relay(async target => { assert.equal(target,company); return orderResult; }, async () => ({_id:'member'}));
  await wiring.send({type:'WAREHOUSE_ORDERS_REQUEST',company,requestId:'read'});
  assert.equal(wiring.replies[0].result, orderResult);
  assert.equal(wiring.replies[0].readStatus,undefined);
  await wiring.send({type:'WAREHOUSE_RECEIPT_REQUEST',company,requestId:'save',input:{marker:'untouched'}});
  assert.equal(wiring.receiptRequests[0][0],company);
  assert.equal(wiring.receiptRequests[0][1],'save');
  assert.equal(wiring.receiptRequests[0][2].marker,'untouched');
  assert.equal(wiring.replies[1].readStatus,undefined);
});

const cases = [
  ['Sign in with your approved staff account.','SIGN_IN_REQUIRED',true,false],
  ['Sign in with your verified Google work email.','STAFF_UNVERIFIED',false,false],
  ['Staff access is not authorized.','STAFF_UNVERIFIED',false,false],
  ['Staff permission does not allow this operation.','ACCESS_DENIED',false,false],
  ['Unexpected data failure','READ_UNAVAILABLE',false,true],
];
for (const [message,status,login,retry] of cases) test(status+' renders the expected employee action', async () => {
  const wiring = relay(async () => { throw Error(message); }, async () => ({_id:'member'}));
  const front = surface();
  const request = front.sent.find(item => item.type==='WAREHOUSE_ORDERS_REQUEST');
  assert(request, 'Incoming read starts on page open');
  await wiring.send(request);
  const [reply] = wiring.replies;
  assert.equal(reply.readStatus,status);
  front.emit(reply, {});
  assert.equal(front.node('notice').textContent.includes('正在读取'),true);
  front.emit({...reply, company:'GHR'});
  assert.equal(front.node('notice').textContent.includes('正在读取'),true);
  front.emit(reply);
  assert.equal(front.node('login').hidden,!login);
  assert.equal(front.node('refresh').hidden,!retry);
  assert(!front.node('notice').textContent.includes(message));
});
test('an expired Wix session and an older bridge can both offer Sign in', async () => {
  const wiring = relay(async () => { throw Error('Platform rejected request'); }, async () => undefined);
  const front = surface();
  const request = front.sent[0];
  await wiring.send(request);
  front.emit(wiring.replies[0]);
  assert.equal(front.node('login').hidden,false);
  front.emit({type:'WAREHOUSE_LOGIN_RESULT',ok:true});
  assert.notEqual(front.sent.at(-1).requestId,request.requestId);
  front.emit({...wiring.replies[0],requestId:front.sent.at(-1).requestId,readStatus:undefined,error:'Sign in with your approved staff account.'});
  assert.equal(front.node('login').hidden,false);
});
