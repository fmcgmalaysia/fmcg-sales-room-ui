const fs=require('node:fs');
const {patchStaff}=require('./patch-staff.cjs');
const policy=require('../../tests/load-master-module.cjs')('staffManagementPolicy.js');
const closed={enabled:false,scope:'SELECTED',createCustomers:false,editProfiles:false,catalogue:'',buyerRoom:'',submitOrders:false};
const sales={...closed,enabled:true,createCustomers:true,editProfiles:true,catalogue:'SELECT',buyerRoom:'REQUEST',submitOrders:true};
const source=patchStaff(fs.readFileSync(__dirname+'/staff.baseline.html','utf8'));
function staffRows(){return ['LAW','LIM','YEOYO','RINN','KAVI','SAM','HIA','MEI'].map((name,index)=>{
  const work=['LIM','YEOYO','RINN'].includes(name)?sales:name==='KAVI'?{...closed,enabled:true,scope:'ALL',editProfiles:true,catalogue:'SELECT',buyerRoom:'VIEW'}:closed;
  return {_id:'fixture-'+index,title:'STF-'+name.padEnd(6,'0'),description:'fixture-member-'+index,staffName:name+' · Test',staffEmail:name.toLowerCase()+'@example.invalid',staffStatus:'ACTIVE',role:name==='LAW'?'SUPER ADMIN':'STAFF',_updatedDate:'fixture-0',
    staffAccess:policy.normalizeStaffAccess({companyIds:['NCT','GHR'],departmentAccess:['SAM','HIA'].includes(name)?{WAREHOUSE:'EDIT'}:{},customerWork:work,
      quotationAccess:name==='YEOYO'?'EDIT':'',performanceAccess:name==='LIM'?'VIEW':'',customerAccess:{'CUS-FAKE-LIM':'EDIT','CUS-FAKE-YEOYO':'VIEW'}})};
});}
const customers=[{id:'CUS-FAKE-LIM',name:'Fake customer L · Long company name for layout testing'},
  {id:'CUS-FAKE-YEOYO',name:'Fake customer Y'}];
function wrapper(origin,app){return `<!doctype html><meta charset="utf-8"><title>Isolated staff permissions · FAKE DATA</title><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="${app}/staff.html"></iframe><script>
 const rows=${JSON.stringify(staffRows().map(policy.projectManagedStaff))};window.fixtureWrites=[];
 addEventListener('message',event=>{if(event.origin!==${JSON.stringify(app)})return;const m=event.data;let reply={type:'MASTER_STAFF_RESULT',requestId:m.requestId,ok:true};
 if(m.action==='LIST_STAFF')Object.assign(reply,{rows});
 else if(m.action==='LIST_CUSTOMERS')Object.assign(reply,{customers:${JSON.stringify(customers)}});
 else if(m.action==='CHECK_STAFF_SAVE')Object.assign(reply,{saveStatus:{state:'CLEAR'}});
 else if(m.action==='UPDATE_STAFF') {if(window.fixtureRejectNext){window.fixtureRejectNext=false;Object.assign(reply,{ok:false,saveRejected:true,error:'Another employee change is being confirmed.'});}else{const row=rows.find(r=>r.staffId===m.staffId);Object.assign(row,{name:m.name,email:m.email,status:m.status,access:m.access,revision:'fixture-'+(fixtureWrites.length+1)});fixtureWrites.push(m);Object.assign(reply,{employee:row});}}
 else Object.assign(reply,{ok:false,error:'Unknown isolated fixture action'});
 event.source.postMessage(reply,event.origin);
 });</script>`;}
module.exports={source,wrapper,staffRows,customers};
