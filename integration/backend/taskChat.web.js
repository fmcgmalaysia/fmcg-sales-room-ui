import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import wixData from 'wix-data';
import { createHash } from 'crypto';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { requirePurchaseStaff } from 'backend/purchaseProjection.js';
import { requireAccountStaff } from 'backend/accountPurchaseReview.js';
import { requireWarehouseStaff } from 'backend/warehouseReceiving.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { projectPreparation, readPreparation } from 'backend/warehousePreparation.js';
import { projectDepartmentMessages } from 'backend/departmentMessages.js';
import { requestTaskChat } from 'backend/taskChatClient.js';
import { createTaskChatService } from 'backend/taskChatService.js';
import { buildTaskChatWorkspace, requireSupportChatStaff } from 'backend/taskChatWorkspace.js';
const collection='DepartmentChatIndex',options={suppressAuth:true,consistentRead:true};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const guards={PURCHASE:requirePurchaseStaff,ACCOUNT:requireAccountStaff,WAREHOUSE:requireWarehouseStaff,SUPPORT:requireSupportChatStaff};
async function staffContext(department){
 if(!guards[department])throw Error('Chat department is not authorized.');
 const member=await currentMember.getMember({fieldsets:['FULL']}),records=await fulfilmentStore.all('StaffMasterAccess');
 const staff=guards[department](member,records);return {...staff,memberId:member._id,departments:[department]};
}
const index={
 read:id=>fulfilmentStore.read(collection,id),insert:row=>fulfilmentStore.insert(collection,row),update:row=>fulfilmentStore.update(collection,row),
 async find(ids){const rows=[];for(let n=0;n<ids.length;n+=100){if(!ids.slice(n,n+100).length)continue;const page=await wixData.query(collection).hasSome('_id',ids.slice(n,n+100)).limit(100).find(options);rows.push(...page.items);}return rows;}
};
async function resolve({company,department,staff,historyCursor=null,taskRef=null}){
 if(!['NCT','GHR'].includes(company))throw Error('Chat company is invalid.');
 const context=await readFulfilmentContext(company,staff),orders=projectPurchaseOrders({company,workspace:context,records:await fulfilmentStore.all('PurchaseOrders')});
 const legacy=department==='SUPPORT'?{threads:[]}:projectDepartmentMessages({company,department,staff,orders,activity:context.activity});
 const delivery=projectPreparation({...context,tasks:context.tasks.map(task=>({...task,archived:false}))});
 const known=new Set(delivery.map(task=>task.id));
 for(const state of readPreparation(context.activity).values())if(state.company===company&&!known.has(state.id))delivery.push({...state,customerName:context.customers.find(c=>c.id===state.customerId)?.name||state.customerId,dispatched:true});
 let query=wixData.query(collection).eq('company',company).hasSome('departmentKeys',[department]);
 if(historyCursor){if(typeof historyCursor.time!=='string'||!Number.isFinite(Date.parse(historyCursor.time))||!/^\w{32}$/.test(historyCursor.id||''))throw Error('Chat history cursor is invalid.');const date=new Date(historyCursor.time);query=query.and(wixData.query(collection).lt('_createdDate',date).or(wixData.query(collection).eq('_createdDate',date).lt('_id',historyCursor.id)));}
 const history=await query.descending('_createdDate','_id').limit(100).find(options),historyRows=[...history.items];
 if(taskRef&&['PO','DELIVERY'].includes(taskRef.kind)&&/^\w{32,64}$/.test(taskRef.id||'')){const id=hash(['TASK_CHAT_INDEX',company,taskRef.kind,taskRef.id]).slice(0,32),row=await index.read(id);if(row&&!historyRows.some(r=>r._id===row._id))historyRows.push(row);}
 const result=buildTaskChatWorkspace({company,department,orders,delivery,legacy,indexHistory:historyRows}),last=history.items.at(-1);
 return {...result,nextHistory:history.hasNext()&&last?{time:new Date(last._createdDate).toISOString(),id:last._id}:null};
}
const service=createTaskChatService({drive:requestTaskChat,index,resolve,hash});
export const getTaskChats=webMethod(Permissions.SiteMember,async(company,department,historyCursor=null)=>service.list({company,department,staff:await staffContext(department),historyCursor}));
export const getTaskChatPage=webMethod(Permissions.SiteMember,async(company,department,input)=>{
 if(!input||JSON.stringify(input).length>2000)throw Error('Chat history request is invalid.');return service.page({company,department,staff:await staffContext(department),input});
});
export const saveTaskChat=webMethod(Permissions.SiteMember,async(company,department,requestId,input)=>{
 const staff=await staffContext(department);
 if(!input||JSON.stringify(input).length>12000)throw Error('Chat save request is invalid.');
 try{return await service.save({company,department,staff,requestId,input});}
 catch(error){const message=String(error?.message||''),safe=message.startsWith('Chat ')||/^CHAT_[A-Z_]+$/.test(message);return {ok:false,company,department,requestId,retryable:!/^CHAT_(INVALID_|REQUEST_REUSED|FILE_CONFLICT|IDENTITY_CONFLICT|ROOT_CONFLICT|PAGE_CONFLICT|SEQUENCE_CONFLICT|CAPACITY_REVIEW_REQUIRED)/.test(message)&&!/^Chat (task is not available|department|action|message must|legacy message|index identity)/.test(message),error:safe?message:'Chat save is unconfirmed. Retry the same request.'};}
});
