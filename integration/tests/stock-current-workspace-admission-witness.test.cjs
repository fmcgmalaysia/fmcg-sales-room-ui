// UNSAFE old-writer schedule witness, NOT a passing production cutover test.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),load=require('./load-master-module.cjs');
const {hash}=require('../prototypes/stock-current-state/commit-proof.cjs');
const {createCurrentPurchaseReadRouter}=require('../prototypes/stock-current-state/current-purchase-read-router.cjs');
const originalFile=require.resolve('./stock-current-margin-reference.test.cjs');
const originalFixture=vm.runInNewContext(fs.readFileSync(originalFile,'utf8').replace("const test = require('node:test')",'const test = () => {}')+';fixture;',
  {require:createRequire(originalFile),Map,Buffer});
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(mode='LEGACY'){
  const f=originalFixture(),company='NCT',control={_id:hash(company,'STOCK_CONTROL'),company,stockCommitVersion:'C0',schemaVersion:1,generation:0,pending:null,mode};
  const db=new Map();for(const[collection,rows]of Object.entries(f.args.tables))for(const row of rows)db.set(collection+':'+row._id,copy(row));
  db.set(f.journal+':'+control._id,control);
  let releaseRead,captureRead,reads=0;const held=new Promise(resolve=>{releaseRead=resolve;}),captured=new Promise(resolve=>{captureRead=resolve;}),writes=[];
  const wixData={
    query(collection){const filters=[];let limit;const q={eq:(key,value)=>{filters.push([key,value]);return q;},limit:value=>{limit=value;return q;},
      find:async options=>{
        assert.equal(options.consistentRead,true);assert.equal(options.suppressAuth,true);
        const items=[...db].filter(([key,row])=>key.startsWith(collection+':')&&filters.every(([field,value])=>row[field]===value))
          .slice(0,limit).map(([,row])=>copy(row));
        if(collection===f.journal&&filters.some(([key,value])=>key==='_id'&&value===control._id)){
          reads++;captureRead();await held;
        }
        return{items,hasNext:()=>false};
      }};return q;},
    insert:async(collection,row)=>{const key=collection+':'+row._id;if(db.has(key))throw Error('Duplicate');
      writes.push(['INSERT',collection,row._id,control.mode]);db.set(key,copy(row));return copy(row);},
    update:async(collection,row)=>{writes.push(['UPDATE',collection,row._id,control.mode]);db.set(collection+':'+row._id,copy(row));return copy(row);},
    remove:async(collection,id)=>{writes.push(['REMOVE',collection,id,control.mode]);db.delete(collection+':'+id);}
  };
  const source=fs.readFileSync(path.join(__dirname,'../prototypes/stock-current-state/purchaseWorkspace.web.candidate.js'),'utf8')
    .replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'');
  // Only read-side projection/progress/FX are fixtures. The candidate mode router,
  // original workspace wrapper and ORIGINAL cache mutation factory are unchanged.
  const api=vm.runInNewContext(source+';getPurchaseWorkspace;',{
    createCurrentPurchaseReadRouter,operationId:hash,wixData,Permissions:{SiteMember:'SITE'},webMethod:(_permission,fn)=>fn,
    PURCHASE_COLLECTIONS:{NCT:{orders:f.orders,tasks:f.tasks,activity:f.journal}},
    getPurchaseStaffContext:async()=>({staffId:'PURCHASE',memberId:'MEMBER',staffName:'Synthetic Purchase'}),
    getPurchaseWorkspaceCurrent:async()=>assert.fail('No current route permitted in this witness'),
    projectPurchaseWorkspace:()=>({...copy(f.args.workspace),customers:[{id:'C'}]}),
    createPurchaseMarginRefresh:load('purchaseMarginRefresh.js').createPurchaseMarginRefresh,
    readCurrentAdminFx:f.args.readRates,readCustomerShortNames:async()=>[],projectPurchaseOrders:()=>[],applyPurchaseProgress:()=>{}
  });
  return{...f,db,control,writes,captured,releaseRead,reads:()=>reads,send:()=>api(company)};
}
test('UNSAFE witness: a workspace READ admitted before maintenance still invokes ORIGINAL order-cache writer afterwards',async()=>{
  const f=fixture(),pending=f.send();await f.captured;
  const before=copy(f.db.get(f.orders+':O'));assert.equal(f.writes.length,0);
  assert.equal([...f.db.values()].some(row=>row._id===hash('NCT','T','GP_LOCK')),false);
  f.control.mode='MAINTENANCE';f.control.stockCommitVersion='C1';f.releaseRead();
  const workspace=await pending;assert.equal(workspace.tasks.find(row=>row.id==='T').gp,0.25);
  assert.equal(f.reads(),1);assert.notDeepEqual(f.db.get(f.orders+':O'),before);
  assert.equal(f.writes.some(([kind,collection])=>kind==='UPDATE'&&collection===f.orders),true);
  assert.ok(f.writes.length>0);assert.ok(f.writes.every(([, , ,mode])=>mode==='MAINTENANCE'));
  assert.equal([...f.db.values()].filter(row=>row.action==='GP_RECALCULATED').length,1);
});
test('a workspace request observing maintenance refuses before ORIGINAL table/cache writes',async()=>{
  const f=fixture('MAINTENANCE'),before=JSON.stringify([...f.db]),pending=f.send();await f.captured;f.releaseRead();
  await assert.rejects(pending,/maintenance/);assert.equal(f.reads(),1);assert.deepEqual(f.writes,[]);
  assert.equal(JSON.stringify([...f.db]),before);
});
