'use strict';
const {createCurrentStockSave}=require('./current-stock-save.cjs');
const {prepareArrangement,identity}=require('./purchase-arrangement.cjs');
function createCurrentPurchaseArrangementSave({company,store,protocol,coverage,authorityDependencies:d}){
 if(protocol?.planFormat!=='SEGMENTED_V2'||typeof store?.read!=='function'
   ||[d?.readMember,d?.readStaffRecords,d?.requirePurchaseStaff,d?.readMarginContext,d?.now].some(f=>typeof f!=='function'))throw Error('Private Purchase arrangement dependencies required');
 let staff;
 return createCurrentStockSave({company,writer:'PURCHASE_TASK',protocol,coverage,authenticate:async()=>{
   const member=await d.readMember();if(!member?._id||member.status!=='APPROVED'||!member.loginEmail)d.requirePurchaseStaff(member,[]);
   staff={...d.requirePurchaseStaff(member,await d.readStaffRecords()),memberId:member._id};return staff;
 },prepare:async command=>{
   const snapshot=await protocol.readSnapshot(async control=>{
    const {workspace}=await d.readMarginContext(company,staff,control);
    const before=await store.read(company==='NCT'?'NCTActivity':'NCTActivity1',identity(company,command.input.taskId,command.input.batchId));
    return prepareArrangement({company,staff,requestId:command.requestId,input:command.input,workspace,before,at:d.now().toISOString()});
   });
   return {plan:snapshot.rows,memberId:staff.memberId,generation:snapshot.generation};
 }});
}
module.exports={createCurrentPurchaseArrangementSave};
