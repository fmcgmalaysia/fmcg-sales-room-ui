const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { load } = require('../web-quotations/isolation.cjs');
const arithmetic = load('integration/backend/grossProfitMargin.js', ['calculateNetCartonCost', 'calculateGrossProfitMargin']);
const { createMasterQuotationService } = load('integration/backend/masterQuotationService.js', ['createMasterQuotationService'], { ...crypto, ...arithmetic });
const headers = ['STATUS','PRINCIPLE','BRAND NAME','COST VERIFIED ON','COST FRESHNESS','UNIT BARCODE','ITEM NAME','PACKING SIZE','EA','COST /PC','COST /CTN','DISC. 1','DISC. 2','DISC. 3','NET COST /CTN','NOTES','L (MM)','H (MM)','W (MM)','CBM /CTN','NET WEIGHT','COUNTRY ORIGIN','SHELF LIFE','CARTON BARCODE','INNER BOX BARCODE','SORT NO.','WIX IMAGE URL'];
function fixture(size) {
  const rows = Array.from({ length: size }, (_, i) => ['ACTIVE','','BRAND','','🔴', String(9000000000000 + i),'Product '+i,'24 EA',24,'',48,0.02,0,1,46.04,'100 FOC 10','','','',0.0123,'','','','','','FO-'+String(i).padStart(5,'0'),'']);
  const cached = new Map(), reads = [];
  let cacheDown = false;
  const cache = {
    get(key) { if(cacheDown) throw Error('Cache down'); return cached.get(key) || null; },
    getAll(keys) { if(cacheDown) throw Error('Cache down'); return Object.fromEntries(keys.filter(key => cached.has(key)).map(key => [key,cached.get(key)])); },
    put(key,value) { if(cacheDown) throw Error('Cache down'); cached.set(key,value); },
    putAll(values) { if(cacheDown) throw Error('Cache down'); for(const [key,value] of Object.entries(values)) cached.set(key,value); },
    remove(key) { cached.delete(key); }
  };
  const ctx = vm.createContext({ console, CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()] },
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => ({ getLastRow: () => name === 'FOOD' ? rows.length + 2 : 2,
      getRange(r,c,nr,nc) {
        reads.push({name,r,c,nr,nc});
        const data = r === 1 ? [headers] : name === 'FOOD' ? rows.slice(r-3,r-3+nr) : [];
        const slice = data.map(row => row.slice(c-1,c-1+nc));
        return { getValues: () => slice, getDisplayValues: () => slice.map(row => row.map(String)) };
      }
    }) }) }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../apps-script/MasterPointbaseCost.gs'),'utf8'),ctx);
  const call = (mode, barcodes = rows.map(row => row[5]), key = crypto.randomBytes(32).toString('hex')) =>
    JSON.parse(JSON.stringify(ctx.WIX_masterCaptureCost({mode,barcodes,requestKey:key})));
  return { ctx, rows, cached, reads, call, cacheDown: () => { cacheDown = true; } };
}

for(const size of [54,500,1000]) test(`${size} products use bounded sheet batches, retain Sort ID/CBM and repeat with no new versions`, () => {
  const f = fixture(size), key = 'a'.repeat(64);
  const result = f.call('QUOTE_CAPTURE',undefined,key);
  assert.equal(result.updated,size); assert.equal(result.failed,0);
  assert.equal(result.costs[f.rows[0][5]].sortNo,'FO-00000');
  assert.equal(result.costs[f.rows[0][5]].cbmPerCtn,0.0123);
  assert.equal(result.costs[f.rows[0][5]].disc3,1);
  assert.equal(f.reads.filter(r=>r.r>=3&&r.nc===27).length,Math.ceil(size/256));
  const reads = f.reads.length;
  assert.equal(f.call('QUOTE_STATUS',undefined,key).updated,size);
  assert.equal(f.call('QUOTE_CAPTURE',undefined,key).updated,size);
  assert.equal(f.reads.length,reads,'Same receipt must not reread sheet');
  const repeated = f.call('QUOTE_CAPTURE');
  assert.equal(repeated.unchanged,size); assert.equal(repeated.updated,0);
});

test('evicted references and lost result recover by reads; stale in-flight markers expire; cache outage preserves success', () => {
  const f = fixture(6), key = 'b'.repeat(64);
  f.call('QUOTE_CAPTURE',undefined,key);
  f.cached.clear();
  assert.equal(f.call('QUOTE_STATUS',undefined,key).missing,true);
  assert.equal(Object.keys(f.call('QUOTE_CURRENT').costs).length,6);
  f.cached.set('MQR1_'+key,JSON.stringify({requestKey:key,pending:true,startedAt:new Date(Date.now()-121000).toISOString()}));
  assert.equal(f.call('QUOTE_STATUS',undefined,key).missing,true);
  assert.equal(f.call('QUOTE_CAPTURE',undefined,key).pending,false);
  f.cacheDown();
  assert.equal(f.call('QUOTE_CAPTURE').failed,0);
});

test('an older slow result cannot replace newer shared references', () => {
  const f = fixture(1), barcode = f.rows[0][5];
  const cost = f.call('QUOTE_CAPTURE').costs[barcode];
  f.ctx.MPC_quoteRemember_({[barcode]:{...cost,capturedAt:'2030-01-01T00:00:00Z',lpCtn:99}});
  f.ctx.MPC_quoteRemember_({[barcode]:{...cost,capturedAt:'2020-01-01T00:00:00Z',lpCtn:1}});
  assert.equal(f.call('QUOTE_CURRENT').costs[barcode].lpCtn,99);
});

test('50 fake customers × 500 selections share 500 references with zero CMS cost writes and unchanged publication snapshots', async () => {
  const f = fixture(500), published = {enabled:true,priceEa:1.05,priceCtn:25.2,currency:'USD',version:7,publishedAt:'2026-11-19T04:30:00Z'};
  let inserts=0, revisionReads=0, deliveries=0;
  const revisions={latest:async()=>{revisionReads++;return {revision:3,snapshot:{published}};},append:async()=>{inserts++;assert.fail('Cost cannot write CMS');}};
  let activeRows=[];
  const service=createMasterQuotationService({revisions,readSelections:async()=>activeRows,
    readCosts:async(barcodes,key)=>f.call('QUOTE_CAPTURE',barcodes,key),readCurrentCosts:async barcodes=>f.call('QUOTE_CURRENT',barcodes).costs,
    readCostResult:async key=>f.call('QUOTE_STATUS',undefined,key), deliver:async()=>{deliveries++;}});
  for(let i=0;i<50;i++) {
    const customerId='FAKE-'+i, scope={staffId:'FAKE-SALES',customer:{customerId}};
    activeRows=f.rows.map((row,index)=>({id:'SEL-'+index,customerId,barcode:row[5],ea:24}));
    const command={requestId:crypto.randomUUID()};
    const result=await service.catchCost(scope,command);
    assert.equal(result.rows.length,500); assert.equal(result.failed,0);
    assert.equal((await service.costResult(scope,command)).pending,false);
    const before=f.reads.length;
    assert.equal((await service.catchCost(scope,command)).rows.length,500);
    assert.equal(f.reads.length,before);
    const repeat=await service.catchCost(scope,{requestId:crypto.randomUUID()});
    assert.equal(repeat.unchanged,500);
  }
  assert.equal(inserts,0); assert.equal(revisionReads,0); assert.equal(deliveries,0);
  assert.equal(Object.keys(f.call('QUOTE_CURRENT').costs).length,500);
  assert.deepEqual(published,{enabled:true,priceEa:1.05,priceCtn:25.2,currency:'USD',version:7,publishedAt:'2026-11-19T04:30:00Z'});
});

test('result lookup is scoped to staff and customer and never reads/writes any quotation revision', async () => {
  const calls=[];
  const service=createMasterQuotationService({readCostResult:async key=>{calls.push(key);return {pending:true,missing:true};}});
  const command={requestId:crypto.randomUUID()};
  for(const [staffId,customerId] of [['A','C1'],['B','C1'],['A','C2']])
    assert.equal((await service.costResult({staffId,customer:{customerId}},command)).missing,true);
  assert.equal(new Set(calls).size,3);
  await assert.rejects(service.costResult({staffId:'A',customer:{customerId:'C1'}},{requestId:'bad'}),/Invalid/);
});

test('cost-status preserves staff/customer permissions and rejects forged scope before source access', async () => {
  const policy=load('integration/backend/staffManagementPolicy.js',['canEnterDepartment','canUseSalesRoomCustomer']);
  const {createMasterQuotationActions}=load('integration/backend/masterQuotationAccess.js',['createMasterQuotationActions'],policy);
  const record={title:'QA-SALES',staffStatus:'ACTIVE',staffAccess:{departmentAccess:{'SALES MANAGEMENT':'EDIT'},companyIds:['NCT'],salesRoom:'EDIT',salesFunction:'SALES',customerAccess:{QA:'EDIT'}}};
  let reads=0;
  const run=createMasterQuotationActions({readIdentity:async()=>({record}),readCustomer:async customerId=>({customerId,quotationMode:'WEB',webQuotationStatus:'READY'}),
    quotation:{costResult:async scope=>{reads++;assert.equal(scope.staffId,'QA-SALES');return {pending:true};}}});
  assert.equal((await run('cost-status','OTHER',{})).accessDenied,true);
  assert.equal(reads,0);
  assert.equal((await run('cost-status','QA',{requestId:crypto.randomUUID()})).pending,true);
  record.staffAccess.salesFunction='SUPPORT';
  assert.equal((await run('cost-status','QA',{})).accessDenied,true);
  assert.equal(reads,1);
});

test('quotation transport uses the same protected endpoint and validates recovery correlation', async () => {
  const {createQuotationPointbaseClient}=load('integration/backend/pointbaseCostClient.js',['createQuotationPointbaseClient'],{getSecret:async()=>''});
  let result={kind:'MASTER_QUOTATION_COST_V1',requestKey:'c'.repeat(64),pending:false,updated:1,unchanged:0,failed:0};
  const packets=[];
  const client=createQuotationPointbaseClient({getSharedSecret:async()=>'FAKE-SECRET',send:async(url,options)=>{
    assert.equal(new URL(url).hostname,'script.google.com');packets.push(JSON.parse(options.body));
    return {status:200,json:async()=>({ok:true,result})};
  }});
  assert.equal((await client('QUOTE_STATUS',undefined,'c'.repeat(64))).updated,1);
  assert.equal(packets[0].action,'MASTER_CAPTURE_COST');assert.equal(packets[0].mode,'QUOTE_STATUS');
  result={...result,requestKey:'d'.repeat(64)};
  await assert.rejects(client('QUOTE_STATUS',undefined,'c'.repeat(64)),/POINTBASE_RESULT_INVALID/);
});

test('frontend is patched from the exact currently published quotation app; optimistic publication stays intact', () => {
  const {patchPublishSwitch}=require('../quotation-publish-switch-20261119/patch.cjs');
  const {patchCostRead}=require('./patch.cjs');
  const current=patchPublishSwitch(fs.readFileSync(path.join(__dirname,'../../releases/quote-buyer-sales-catalogue/master-quotations/app.js'),'utf8').replace(/\r\n/g,'\n'));
  assert.equal(crypto.createHash('sha256').update(current).digest('hex'),'fc574f4adf377eff3f71bdb7386646dc1b0974c725474da1fab4dc256992e9b6');
  const app=patchCostRead(current);
  new vm.Script(app);
  assert(app.includes("await api(first ? 'cost' : 'cost-status', packet, context)"));
  assert(!app.includes("await api('cost', {}, context)"));
});
