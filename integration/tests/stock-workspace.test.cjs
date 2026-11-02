const test=require('node:test'),assert=require('node:assert/strict'),load=require('./load-master-module.cjs');
const {requireStockStaff}=load('stockExceptionWorkspace.js');
const member={_id:'M',loginEmail:'employee@example.test',status:'APPROVED'},record={title:'S',description:'M',staffEmail:'employee@example.test',staffName:'Employee',staffStatus:'ACTIVE',role:'STAFF'};
test('stock workspace permissions come from authenticated staff records, never browser role claims',()=>{
 for(const department of ['WAREHOUSE','PURCHASE','ACCOUNT','SUPPORT']){
  const permissions=requireStockStaff(member,[{...record,departments:[department]}]);
  assert.equal(permissions.canReportStockException,department==='WAREHOUSE');assert.equal(permissions.canPlanStockResolution,department==='PURCHASE');assert.equal(permissions.canCloseStockException,department==='ACCOUNT');assert.equal(permissions.canApproveStockLoss,false);
 }
 assert.equal(requireStockStaff(member,[{...record,role:'SUPER ADMIN'}]).canApproveStockLoss,true);
 assert.throws(()=>requireStockStaff(member,[{...record,departments:['SALES']}]),/not authorized/);
 assert.throws(()=>requireStockStaff({...member,_id:'OTHER'},[{...record,departments:['ACCOUNT']}]),/Approved/);
 assert.throws(()=>requireStockStaff(member,[{...record,departments:['ACCOUNT']},{...record}]),/Approved/);
});
test('TOP MANAGEMENT retains Finance Stock Take authority without gaining reporting, supplier resolution or Super Admin approval',()=>{
 const permissions=requireStockStaff(member,[{...record,role:'TOP MANAGEMENT',departments:[]}]);
 assert.equal(permissions.canCloseStockException,true);assert.equal(permissions.canReportStockException,false);assert.equal(permissions.canPlanStockResolution,false);assert.equal(permissions.canApproveStockLoss,false);
});
test('TOP MANAGEMENT still requires an active exact member binding and cannot be supplied by the caller',()=>{
 for(const overrides of [{description:'OTHER'},{staffStatus:'INACTIVE'},{title:''},{staffName:''}])assert.throws(()=>requireStockStaff(member,[{...record,role:'TOP MANAGEMENT',departments:[],...overrides}]),/Approved/);
 assert.throws(()=>requireStockStaff({...member,status:'BLOCKED'},[{...record,role:'TOP MANAGEMENT',departments:[]}]),/Approved/);
 assert.throws(()=>requireStockStaff(member,[{...record,departments:['SALES']}]),/not authorized/);
});
