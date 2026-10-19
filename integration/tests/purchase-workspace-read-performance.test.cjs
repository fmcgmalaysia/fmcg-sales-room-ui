const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 const names=deferred(),margins=deferred(),started=deferred(),calls=[];
 const workspace={customers:[{id:'C',name:'FULL'}],tasks:[{id:'T',ord:22,inc:1}]};
 const source=fs.readFileSync(path.join(__dirname,'../backend/purchaseWorkspace.web.js'),'utf8').replace(/^import[^\n]+\r?\n/gm,'').replace(/^export /gm,'');
 const read=vm.runInNewContext(source+'\ngetPurchaseWorkspace',{
  webMethod:(_p,fn)=>fn,Permissions:{SiteMember:1},PURCHASE_COLLECTIONS:{NCT:{orders:'O',tasks:'T',activity:'A'}},
  getPurchaseStaffContext:async()=>({role:'PURCHASE'}),
  wixData:{query:()=>({limit(){return this;},find:async()=>({items:[],hasNext:()=>false})})},
  projectPurchaseWorkspace:()=>workspace,
  readCustomerShortNames:()=>{calls.push('names');return names.promise;},
  createPurchaseMarginRefresh:()=>()=>{calls.push('margins');started.resolve();return margins.promise;},
  readCurrentAdminFx:()=>{},projectPurchaseOrders:()=>[],applyPurchaseProgress:()=>{},
 });
 return {read,names,margins,started,calls};
}
test('workspace overlaps independent name and margin reads but waits for both authoritative results',async()=>{
 const f=fixture();let completed=false;const request=f.read('NCT').then(result=>{completed=true;return result;});
 await f.started.promise;assert.deepEqual(f.calls,['names','margins']);
 f.margins.resolve(new Map([['T',.12],['SOURCE:T',.13]]));await Promise.resolve();assert.equal(completed,false);
 f.names.resolve([{customerId:'C',shortName:'SHORT'}]);const result=await request;
 assert.equal(result.customers[0].shortName,'SHORT');assert.equal(result.tasks[0].gp,.12);assert.equal(result.tasks[0].sourceGp,.13);
 assert.equal(result.tasks[0].ord,22);assert.equal(result.tasks[0].inc,1);assert.equal(result.customerNamesError,'');
});
test('name lookup failure retains the existing warning and full customer data while valid margins finish',async()=>{
 const f=fixture(),request=f.read('NCT');await f.started.promise;
 f.names.reject(Error('Offline'));f.margins.resolve(new Map([['T',null]]));const result=await request;
 assert.equal(result.customers[0].name,'FULL');assert.equal(result.customers[0].shortName,'');
 assert.match(result.customerNamesError,/Short Name/);assert.equal(result.tasks[0].gp,null);
});
test('margin failure still rejects the workspace instead of returning a partially confirmed result',async()=>{
 const f=fixture(),request=f.read('NCT'),failure=Error('Margin failed');await f.started.promise;
 const rejected=assert.rejects(request,error=>error===failure);f.names.resolve([]);f.margins.reject(failure);await rejected;
});
