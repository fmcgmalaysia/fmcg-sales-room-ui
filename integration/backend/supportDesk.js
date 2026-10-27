import { operationId } from 'backend/purchaseOperationJournal.js';
const ACTION='SUPPORT_DESK_SAVED';
const deskValid=value=>Number.isSafeInteger(value)&&value>=1&&value<=3;
const textValid=value=>typeof value==='string'&&value.length>0&&value.length<=100;
const dateValid=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const transports=['LAND','SEA_20FT','SEA_40FT','OTHER'];
const identity=(company,customerId)=>operationId(company,customerId,'SUPPORT_DESK');
const empty=(company,customerId)=>({company,customerId,revision:'',assignments:[],shipments:[]});
const copy=value=>JSON.parse(JSON.stringify(value));
function validState(state,company){return state&&state.company===company&&textValid(state.customerId)&&Array.isArray(state.assignments)&&new Set(state.assignments.map(row=>row.taskId)).size===state.assignments.length&&state.assignments.every(row=>textValid(row.taskId)&&deskValid(row.desk))&&Array.isArray(state.shipments)&&new Set(state.shipments.map(row=>row.desk)).size===state.shipments.length&&state.shipments.every(row=>deskValid(row.desk)&&transports.includes(row.transport)&&dateValid(row.date)&&(row.arrival===''||dateValid(row.arrival)&&row.arrival>=row.date));}
export function readSupportDesks(activity,company){
 if(!['NCT','GHR'].includes(company))throw Error('Select NCT or GHR.');
 const pending=activity.filter(row=>row.action===ACTION&&row.result==='SAVED'),states=new Map(),requests=new Set();
 while(pending.length){
  const next=pending.filter(row=>(states.get(row.description)?.revision||'')===row.details?.beforeRevision);
  if(!next.length||new Set(next.map(row=>row.description)).size!==next.length)throw Error('Desk history requires review.');
  for(const event of next){const d=event.details,state=d?.state,requestKey=d?.memberId+'/'+d?.requestId;
   if(!validState(state,company)||event.description!==identity(company,state.customerId)||event._id!==operationId(event.description,d.beforeRevision,'NEXT')||event.title!==event._id||!d.memberId||!d.requestId||requests.has(requestKey)||!event.initiatedByStaffId||!event.initiatedByStaffName||!Number.isFinite(Date.parse(event.activityTime)))throw Error('Desk record identity requires review.');
   requests.add(requestKey);states.set(event.description,{...copy(state),revision:event.title});pending.splice(pending.indexOf(event),1);
  }
 }
 return [...states.values()];
}
export function supportDeskForTask(state,taskId){return state?.assignments.find(row=>row.taskId===taskId)?.desk||1;}
// Classification and shipping metadata only. No quantity, stock, invoice or payment writes.
export function createSupportDeskOperations({store,names,readContext,now=()=>new Date()}){
 return async({company,staff,requestId,input})=>{
  if(!['NCT','GHR'].includes(company)||!names[company]||staff?.packingDepartment!=='SUPPORT'||!staff.memberId||!staff.staffId||!staff.staffName)throw Error('Support access is required.');
  if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!input||!textValid(input.customerId)||!deskValid(input.desk)||typeof input.revision!=='string'||input.revision.length>100||!['DESK_ASSIGN','DESK_SHIPMENT'].includes(input.action))throw Error('Select a customer and Desk 1, 2 or 3.');
  let normalized;
  if(input.action==='DESK_ASSIGN'){if(!textValid(input.taskId))throw Error('Select an active customer task.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,taskId:input.taskId};}
  else{if(!transports.includes(input.transport)||!dateValid(input.date)||!(input.arrival===''||dateValid(input.arrival)&&input.arrival>=input.date))throw Error('Enter valid shipment and arrival dates.');normalized={action:input.action,customerId:input.customerId,desk:input.desk,revision:input.revision,transport:input.transport,date:input.date,arrival:input.arrival};}
  const context=await readContext(company,staff);if(context.company!==company)throw Error('Company changed. Refresh before saving.');
  const digest=operationId(normalized),prior=context.activity.filter(row=>row.action===ACTION&&row.result==='SAVED'&&row.details?.memberId===staff.memberId&&row.details?.requestId===requestId);
  if(prior.length>1)throw Error('Desk save receipt requires review.');
  if(prior.length){if(prior[0].details.digest!==digest)throw Error('This save was already used for different Desk details.');return {ok:true,company,requestId,deskState:{...copy(prior[0].details.state),revision:prior[0].title}};}
  const tasks=context.tasks.filter(row=>row.customerId===input.customerId&&!row.archived&&!row.procurementSource&&!row.specialPurchase);
  if(!tasks.length||input.action==='DESK_ASSIGN'&&!tasks.some(row=>row.id===input.taskId))throw Error('Select an active customer task.');
  const before=readSupportDesks(context.activity,company).find(row=>row.customerId===input.customerId)||empty(company,input.customerId);
  if(before.revision!==input.revision)throw Error('Desk details changed. Refresh before editing.');
  const state=copy(before);delete state.revision;
  if(input.action==='DESK_ASSIGN'){state.assignments=state.assignments.filter(row=>row.taskId!==input.taskId).concat({taskId:input.taskId,desk:input.desk}).sort((a,b)=>a.taskId.localeCompare(b.taskId));}
  else state.shipments=state.shipments.filter(row=>row.desk!==input.desk).concat({desk:input.desk,transport:input.transport,date:input.date,arrival:input.arrival}).sort((a,b)=>a.desk-b.desk);
  const entityId=identity(company,input.customerId),id=operationId(entityId,input.revision,'NEXT');
  const event={_id:id,title:id,description:entityId,image:input.customerId,action:ACTION,result:'SAVED',actorType:'STAFF',activityTime:now(),initiatedByStaffId:staff.staffId,initiatedByStaffName:staff.staffName,message:input.action==='DESK_ASSIGN'?'Support moved a task to Desk '+input.desk:'Support updated Desk '+input.desk+' shipment',details:{beforeRevision:input.revision,memberId:staff.memberId,requestId,digest,state}};
  try{await store.insert(names[company].activity,event);}catch(error){const retained=await store.read(names[company].activity,id);if(retained&&retained.details?.digest!==digest)throw Error('Desk details changed. Refresh before editing.');if(!retained||retained.details?.requestId!==requestId||retained.details?.memberId!==staff.memberId)throw error;}
  const receipt=await store.read(names[company].activity,id);if(!receipt||receipt.details?.digest!==digest||receipt.details?.requestId!==requestId||receipt.details?.memberId!==staff.memberId||operationId(receipt.details.state)!==operationId(state))throw Error('Desk save is not confirmed. Retry the same save.');
  return {ok:true,company,requestId,deskState:{...state,revision:id}};
 };
}
// Optional Desk scope retains compatibility with previously prepared invoice requests.
export function checkSupportDeskInvoice(context,readiness,input){
 const desk=input.desk;if(!desk)return null;
 if(!deskValid(desk.number)||typeof desk.revision!=='string')throw Error('Select one Desk before invoicing.');
 const state=readSupportDesks(context.activity,context.company).find(row=>row.customerId===input.customerId)||empty(context.company,input.customerId);
 if(state.revision!==desk.revision)throw Error('Desk classification changed. Refresh before invoicing.');
 const expected=context.tasks.filter(task=>task.customerId===input.customerId&&!task.archived&&!task.specialPurchase&&!task.procurementSource&&supportDeskForTask(state,task.id)===desk.number).map(task=>({taskId:task.id,quantity:readiness.lines.find(line=>line.taskId===task.id)?.maxInvoiceQty||0})).filter(line=>line.quantity>0).sort((a,b)=>a.taskId.localeCompare(b.taskId));
 const observed=input.lines.map(line=>({taskId:line.taskId,quantity:line.quantity})).sort((a,b)=>a.taskId.localeCompare(b.taskId));
 if(!expected.length||operationId(expected)!==operationId(observed))throw Error('Invoice lines must match the current Desk and confirmed loading.');
 return {number:desk.number,revision:desk.revision,shipment:copy(state.shipments.find(row=>row.desk===desk.number)||null)};
}
