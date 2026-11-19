const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const release=require('../prototypes/po-auto-allocation-20261101/stage.cjs').plan(),root=path.resolve(__dirname,'../..');
test('the release retains99 exact scoped resources and excludes the inherited allocation draft',()=>{
 assert.equal(release.assets.size,99);for(const[f,b]of release.assets)if(!release.changed.includes(f))assert(b.equals(release.baseline.get(f)),f);
 const shippedHash=crypto.createHash('sha256').update(release.assets.get('purchase-live/customer-allocation.js')).digest('hex');
 assert.equal(shippedHash,'0119f8ed11f171626d9c50334bb898f92897bc58655a7c62a98ebe24aea37e1f','frozen release bytes, independent of the checkout draft');
 assert.notEqual(shippedHash,'6c2a28369a1de34b07d9f285e1b48163ce46815a0e0909ddc66c8e88a005a951','never ship the inherited unverified draft');
 for(const f of ['account-room/app.js','account-room/payment-layout.js','warehouse-room/workroom.js','warehouse-room/workroom.html','catalogue-sidebar-v1.html'])if(release.baseline.has(f))assert(release.assets.get(f).equals(release.baseline.get(f)),f);
});
test('every shipped script parses and allocation preview is mechanically built from the sole server domain',()=>{
 for(const[f,b]of release.assets)if(f.endsWith('.js'))new vm.Script(b.toString(),{filename:f});
 const domain=fs.readFileSync(path.join(root,'integration/backend/customerAllocationPlan.js'),'utf8').replace(/\r\n/g,'\n').replace(/^export /gm,'');assert(release.assets.get('purchase-live/customer-allocation-plan.js').toString().includes(domain));
});
test('changed release resources have portable line endings while untouched baseline bytes are preserved',()=>{
 for(const file of release.changed)assert(!release.assets.get(file).includes(Buffer.from('\r\n')),file);
 for(const[file,bytes]of release.baseline)if(!release.changed.includes(file))assert(release.assets.get(file).equals(bytes),file);
});
test('task Info displays the planned200 but retains physical190 for source reconciliation',()=>{
 const window={},document={getElementById:()=>null};vm.runInNewContext(release.assets.get('purchase-live/task-info.js').toString(),{window,document});
 const data={tasks:[{id:'A',inc:190,procurement:{totalCtn:200},warehouse:{hasPhysicalReceipt:true,accepted:190},supplyAllocation:{planned:200,received:190,waiting:0,gap:10}}],allocations:[{sourceTaskId:'A',targets:[{taskId:'A',quantity:190}]}],allocationContext:{loans:[]}},m=window.purchaseTaskInfo.model('A','','',data),v=window.purchaseTaskInfo.allocationView(m,data);
 assert.equal(m.allocated,190);assert.equal(m.consistent,true);assert.equal(v.value,'200');assert.equal(v.info,false);assert.equal(v.settled,false);
 data.deskDeliveries=[{taskId:'A',confirmed:true,loadedQty:190}];assert.equal(window.purchaseTaskInfo.allocationView(m,data).settled,false);
});
test('Dashboard removes obsolete manual allocation tasks without renumbering remaining action callbacks',()=>{
 const window={masterTaskSignals:{project:()=>({entries:[{id:'A',action:'allocate',owner:'PURCHASE',category:'todo'},{id:'B',action:'allocate',owner:'PURCHASE',category:'todo'},{id:'C',action:'quantity-case:SHORT',owner:'PURCHASE',category:'urgent'}],categories:[]})}};
 vm.runInNewContext(release.assets.get('purchase-live/dashboard.js').toString(),{window});
 const data={tasks:[{id:'A',supplyAllocation:{planned:200}},{id:'B'},{id:'C',supplyAllocation:{planned:200,gap:10}}],suppliers:[],customers:[]},m=window.purchaseDashboard.model(data);
 assert.equal(m.groups.length,2);assert.equal(m.groups[0].id,'B');assert.equal(m.groups[0].entries[0].index,1);assert.equal(m.groups[1].entries[0].index,2);
});
test('ordinary automatic receipt has no extra confirmation button; waiting cartons are explained separately',()=>{
 const code=release.assets.get('purchase-live/customer-allocation.js').toString();assert.match(code,/canSave=!receivable&&quote.useFree>0/);assert.match(code,/Incoming 待到货/);
 assert.doesNotMatch(release.assets.get('sales-room/shipment-ui.js').toString(),/send\('PLAN'/);assert.doesNotMatch(release.assets.get('sales-room/order-adjustment.js').toString(),/SPLIT:\{/);
 assert.doesNotMatch(release.assets.get('master-shared/desk-delivery.js').toString(),/data-resolution-cancel/);
});
test('all active room entries reference the candidate versions of their affected scripts',()=>{
 for(const f of ['purchase-live/index.html','support-room/workroom.html','warehouse-room/index.html','buyer-room.html','index.html']){
  const html=release.assets.get(f).toString();for(const match of html.matchAll(/(?:src|href)="([^"?]+)\?v=([^"&]+)/g)){const asset=path.posix.normalize(path.posix.join(path.posix.dirname(f),match[1]));if(release.changed.includes(asset))assert.equal(match[2],release.build,f+' '+asset);}
 }
});
