const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const load = require('./load-master-module.cjs');
const {confirmOriginalMonthEnd} = load('financeOriginalMonthEnd.js');
const {prepareOriginalMonthEnd} = load('financeOriginalMonthEnd.js');
const {createFinanceMonthEndArchive} = load('financeMonthEndArchive.js');
const {financeInventoryOutlook} = load('financeInventoryOutlook.js');
const {calculatePlanCosting} = load('purchasePlan.js');
const sample = () => JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'finance-inventory-outlook.test.cjs'),'--sample-input'],{encoding:'utf8'}));
function open(file) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS originals (company TEXT, asOf TEXT, body TEXT NOT NULL, PRIMARY KEY(company,asOf))');
  const read = (company,asOf) => JSON.parse(db.prepare('SELECT body FROM originals WHERE company=? AND asOf=?').get(company,asOf)?.body ?? 'null');
  return {close:()=>db.close(), read, insertOriginal(report) {
    db.prepare('INSERT INTO originals VALUES (?,?,?) ON CONFLICT(company,asOf) DO NOTHING')
      .run(report.company,report.asOf,JSON.stringify(report));
    return read(report.company,report.asOf);
  }};
}
const base = {company:'NCT', asOf:'2026-11-30', closedBy:'QA Finance', now:new Date('2026-11-30T16:01:00Z')};
test('confirmed original survives a restart, later MYR 70 cost increase, and confirmation retries', async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-finance-close-')),file=path.join(dir,'qa.sqlite');
  let archive=open(file);
  t.after(()=>{archive.close();fs.rmSync(dir,{recursive:true,force:true});});
  const raw=sample();
  const original=await confirmOriginalMonthEnd({...base,archive,readRows:async()=>raw});
  assert.deepEqual([original.totals.onHand.quantity,original.totals.reservedUsable.quantity,original.totals.available.quantity,
    original.totals.valuation.knownValueCents],[118,105,13,389100]);
  assert.equal(original.outlook.lines.filter(r=>r.customer==='AVATA').length,5);
  assert.equal(original.outlook.lines.find(r=>r.customer==='ALAMAK').reserved,30);
  assert.equal(original.products.flatMap(p=>p.sources).length,5);
  const edit=raw.activity.find(e=>e.title==='PLAN-QA-001-0');
  edit._updatedDate='2026-12-02T00:00:00Z';
  const prices={lpPc:37,lpCtn:37,disc1:0,disc2:0,disc3:0};
  edit.details.costing=calculatePlanCosting({schema:1,mode:'NORMAL',moneySource:'PRICES',paidCtn:35,freeCtn:0,prices},35,1);
  assert.throws(()=>financeInventoryOutlook(raw,base.asOf,'2026-12'),/Historical revision/);
  const latest=financeInventoryOutlook(raw,'2026-12-02','2026-12');
  assert.ok(latest.lines.every(r=>Number.isSafeInteger(r.costCents)) && latest.available.every(r=>Number.isSafeInteger(r.cents)));
  assert.equal(latest.lines.reduce((s,r)=>s+r.costCents,0)+latest.available.reduce((s,r)=>s+r.cents,0),396100);
  archive.close();archive=open(file);
  assert.deepEqual(archive.read('NCT',base.asOf),original);
  assert.equal(archive.read('GHR',base.asOf),null);
  assert.equal(archive.read('NCT','2026-10-31'),null);
  const replay=await confirmOriginalMonthEnd({...base,archive,closedBy:'Other Finance',readRows:()=>assert.fail('Read mutable rows on retry')});
  assert.deepEqual(replay,original);
  if(process.env.FINANCE_QA_ORIGINAL_EXPORT)
    fs.writeFileSync(process.env.FINANCE_QA_ORIGINAL_EXPORT,JSON.stringify(replay,null,2));
});
test('only a fully evidenced completed company month can be confirmed; competing confirmations return one original',async t=>{
  const archive=open(':memory:');t.after(archive.close);
  const raw=sample(), args={...base,archive,readRows:async()=>raw};
  for (const overrides of [{now:new Date('2026-11-30T15:59:59Z')},{asOf:'2026-11-29'},{closedBy:''},{company:'GHR'}])
    await assert.rejects(confirmOriginalMonthEnd({...args,...overrides}));
  const plan=raw.activity.find(e=>e.title==='PLAN-QA-001-0');
  const cost=plan.details.costing;delete plan.details.costing;
  await assert.rejects(confirmOriginalMonthEnd(args),/Reconcile/);
  assert.equal(archive.read(base.company,base.asOf),null);
  plan.details.costing=cost;
  const [first,other]=await Promise.all([confirmOriginalMonthEnd(args),confirmOriginalMonthEnd({...args,closedBy:'Second staff'})]);
  assert.deepEqual(first,other);
});
test('confirmation uses the reviewed revision and does not save a changed report',async t=>{
  const archive=open(':memory:');t.after(archive.close);
  const raw=sample();
  const {revision}=prepareOriginalMonthEnd(raw,base.company,base.asOf,base.now);
  raw.orders[0].sellingPricePc += 1;
  await assert.rejects(confirmOriginalMonthEnd({...base,archive,revision,readRows:async()=>raw}),/changed/);
  assert.equal(archive.read(base.company,base.asOf),null);
});
test('Wix archive adapter commits one original, recovers a lost reply and rejects damaged storage',async ()=>{
  const rows=new Map();
  let failChunk=true, loseReply=true;
  const archive=createFinanceMonthEndArchive({
    get:async id=>rows.get(id),
    insert:async row=>{
      if(rows.has(row._id)) throw Error('duplicate');
      if (failChunk && row.details.payload && rows.size===1) throw Error('interrupted before commit');
      rows.set(row._id,structuredClone(row));
      if (loseReply && row.details.digest) {loseReply=false;throw Error('reply lost after commit');}
      return row;
    }
  });
  const report={company:'NCT',asOf:base.asOf,closedBy:'QA',data:'茶🍪'.repeat(40000)};
  await assert.rejects(archive.insertOriginal(report),/interrupted/);
  assert.equal(await archive.read('NCT',base.asOf),null);
  failChunk=false;
  const [first,second]=await Promise.all([archive.insertOriginal(report),archive.insertOriginal({...report,closedBy:'Second'})]);
  assert.deepEqual(first,second);
  assert.equal(first.data,report.data);
  assert.equal(await archive.read('GHR',base.asOf),null);
  const receipt=[...rows.values()].find(row=>row.details.digest);
  assert.ok(receipt.details.chunks>1);
  for (const row of rows.values()) if (row.details.payload) row.details.payload='deleted';
  await assert.rejects(archive.read('NCT',base.asOf),/requires review/);
});
