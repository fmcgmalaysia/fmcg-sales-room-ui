// Read-only mapping from the existing business authorities to chat task identities.
const peers={PO:{PURCHASE:['ACCOUNT','WAREHOUSE'],ACCOUNT:['PURCHASE'],WAREHOUSE:['PURCHASE']},DELIVERY:{PURCHASE:['WAREHOUSE','SALES'],WAREHOUSE:['PURCHASE','SUPPORT','SALES'],SUPPORT:['WAREHOUSE','SALES'],SALES:['PURCHASE','SUPPORT','WAREHOUSE']}};
export function requireSupportChatStaff(member,records){
 const text=value=>String(value??'').trim(),email=text(member?.loginEmail).toLowerCase(),matches=records.filter(row=>text(row.staffEmail).toLowerCase()===email),row=matches.length===1?matches[0]:null;
 if(!member?._id||member.status!=='APPROVED'||!email||!row||text(row.description)!==member._id||text(row.staffStatus).toUpperCase()!=='ACTIVE'||!text(row.title)||!text(row.staffName))throw Error('Chat approved Master staff access is required.');
 const role=text(row.role).toUpperCase(),departments=(row.departments||[]).map(value=>text(value).toUpperCase());
 if(role!=='SUPER ADMIN'&&!departments.includes('SUPPORT'))throw Error('Chat Support access is not authorized.');
 return {memberId:member._id,staffId:text(row.title),staffName:text(row.staffName),role};
}
export function buildTaskChatWorkspace({company,department,orders,delivery,legacy,indexHistory=[],customerId=null}){
 if(!['NCT','GHR'].includes(company)||!['PURCHASE','ACCOUNT','WAREHOUSE','SUPPORT','SALES'].includes(department)||department==='SALES'&&!customerId)throw Error('Chat workspace is not authorized.');
 const tasks=[],legacyArchive=[];
 if(peers.PO[department])for(const po of orders.filter(po=>po.company===company)){
  const original=(legacy?.threads||[]).find(t=>t.id===po.id);
  const updates=(original?.updates||[]).filter(e=>!['Payment reminder updated'].includes(e.body)).map(e=>{
   const audit=(po.history||[]).find(a=>a.id===e.id);
   return audit?.action==='ACCOUNT_DOCUMENT_UPLOAD'&&audit.changes?.type==='PAYMENT'?{...e,from:'ACCOUNT',notify:true,body:'Payment proof uploaded',bodyZh:'付款证明已上传'}:e;
  });
  tasks.push({kind:'PO',id:po.id,number:po.number,title:po.supplierName,closed:po.supplierAccount?.closed===true,peers:peers.PO[department],legacy:original?.messages||[],updates});
  for(const peer of ['PURCHASE','ACCOUNT','WAREHOUSE'].filter(p=>p!==department&&!peers.PO[department].includes(p))){const messages=(original?.messages||[]).filter(m=>m.from===peer&&m.to.includes(department)||m.from===department&&m.to.includes(peer));if(messages.length)legacyArchive.push({kind:'PO',taskId:po.id,number:po.number,title:po.supplierName,peer,legacyOnly:true,closed:true,messages});}
 }
 if(peers.DELIVERY[department])for(const item of delivery){
  if(department==='SALES'&&item.customerId!==customerId)continue;
  const labels={PACK:['Packing confirmed','备货已确认'],LOAD:['Loading recorded','装货已记录'],UNPACK:['Packing reversed','备货已撤回'],PHOTOS:['Warehouse photos added','货仓照片已补充']};
  const updates=(item.history||[]).filter(e=>labels[e.action]).map(e=>({id:JSON.stringify([item.id,e.at,e.action,e.by]),kind:'SYSTEM',at:e.at,by:e.by,from:'WAREHOUSE',notify:e.action==='PACK'||e.action==='LOAD'||e.action==='UNPACK',body:labels[e.action][0]+(e.action==='LOAD'?' · '+e.loaded:''),bodyZh:labels[e.action][1],note:e.note||''}));
  tasks.push({kind:'DELIVERY',id:item.id,sourceTaskId:item.taskId,sourceTaskIds:item.sourceTaskIds||[item.taskId],customerId:item.customerId||null,orderId:item.orderId||null,sourceLineId:item.sourceLineId||null,batchId:item.batchId||null,number:[item.barcode,item.batch].filter(Boolean).join(' · '),title:item.customerName||item.name,closed:!!item.dispatched,peers:peers.DELIVERY[department],legacy:[],updates});
 }
 for(const row of indexHistory){
  if(row.company!==company||row.details?.authority!=='DRIVE_V1'||!peers[row.taskKind]?.[department]||tasks.some(t=>t.kind===row.taskKind&&t.id===row.taskId))continue;
  if(department==='SALES'&&row.details.task?.customerId!==customerId)continue;
  tasks.push({kind:row.taskKind,id:row.taskId,number:row.details.task?.number,title:row.details.task?.title,sourceTaskId:row.details.task?.sourceTaskId||null,sourceTaskIds:row.details.task?.sourceTaskIds||[],customerId:row.details.task?.customerId||null,orderId:row.details.task?.orderId||null,sourceLineId:row.details.task?.sourceLineId||null,batchId:row.details.task?.batchId||null,closed:true,peers:peers[row.taskKind][department],legacy:[],updates:[]});
 }
 return {tasks,legacyArchive};
}
