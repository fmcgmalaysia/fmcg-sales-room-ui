'use strict';
const fs=require('node:fs'),path=require('node:path');
const source=`import { webMethod, Permissions } from 'wix-web-module';
import { currentMember } from 'wix-members-backend';
import { items } from '@wix/data';
import { requireWarehouseStaff, projectWarehouseOrders, createWarehouseOperations } from 'backend/warehouseReceiving.js';
import { fulfilmentStore, readFulfilmentContext } from 'backend/customerFulfilmentService.js';
import { projectPurchaseOrders } from 'backend/purchaseOrderWorkflow.js';
import { readAllocations } from 'backend/plannerAllocation.js';
import { readCustomerShipments } from 'backend/customerShipmentLedger.js';
import { readPackingLists } from 'backend/packingListOperations.js';
import { packingHeld } from 'backend/packingListModel.js';
import { readPreparation, projectPreparation } from 'backend/warehousePreparation.js';
import { createSdkConditionalStore, createSegmentedFencedProof, planCollections, createCurrentWarehouseReceiptSave } from 'backend/stockCurrentCommands.js';
// CLOSED until all original writers/native schemas/permissions/init/capacity/cutover
// and shadow acceptance pass. This is not browser-supplied activation evidence.
const writerCoverage = Object.freeze({});
const verifiedDateFields=Object.freeze({NCTActivity:['activityTime'],NCTActivity1:['activityTime']});
async function warehouseIdentity(){
  const member=await currentMember.getMember({fieldsets:['FULL']});
  if(!member?._id||!member.loginEmail||member.status!=='APPROVED')requireWarehouseStaff(member,[]);
  return {...requireWarehouseStaff(member,await fulfilmentStore.all('StaffMasterAccess')),memberId:member._id};
}
async function receiptSave(company){
  if(!['NCT','GHR'].includes(company))throw Error('Known Warehouse company required');
  await warehouseIdentity(); // Original grant BEFORE current storage or company data.
  const journal=company==='NCT'?'NCTActivity':'NCTActivity1';
  const store=createSdkConditionalStore({company,items,collections:planCollections(company,true),dateTimeFields:{[journal]:verifiedDateFields[journal]}});
  const protocol=createSegmentedFencedProof({company,store,domainWrites:true});
  const authorityDependencies={readMember:()=>currentMember.getMember({fieldsets:['FULL']}),
    readStaffRecords:()=>fulfilmentStore.all('StaffMasterAccess'),requireWarehouseStaff,
    readContext:readFulfilmentContext,readPurchaseRecords:async selected=>{
      if(selected!==company)throw Error('Warehouse purchase company conflict');
      return(await fulfilmentStore.all('PurchaseOrders')).filter(row=>row.company===company);
    },projectPurchaseOrders,projectWarehouseOrders,createWarehouseOperations,readAllocations,readCustomerShipments,readPackingLists,
    packingHeld,readPreparation,projectPreparation,readCurrentTaskRows:async(selected,ids)=>{
      if(selected!==company||!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.length>2000
        ||ids.some(id=>typeof id!=='string'||!id||id.length>128))throw Error('Exact current Warehouse task scope required');
      const rows=[];for(const id of ids)rows.push(await store.read(company==='NCT'?'NCTTasks':'NCTTasks1',id));return rows;
    },now:()=>new Date()};
  return createCurrentWarehouseReceiptSave({company,items,store,protocol,coverage:writerCoverage,authorityDependencies});
}
export const saveWarehouseReceiptCurrent=webMethod(Permissions.SiteMember,async(company,request)=>{
  try{
    if(!request||Object.keys(request).some(key=>!['requestId','input','stockProtocol','stockBuild','stockGeneration'].includes(key))
      ||!/^[a-f0-9-]{36}$/i.test(request.requestId||'')||!request.input||!Array.isArray(request.input.lines)
      ||request.input.lines.length<1||request.input.lines.length>300||JSON.stringify(request).length>1000000)throw Error('Original bounded Warehouse receipt required');
    return await(await receiptSave(company))(request);
  }catch(_){return {ok:false,requestId:request?.requestId,error:'Current Warehouse receipt unconfirmed. Retain and retry the same original save. 当前收货尚未确认，请保留并重试原保存。'};}
});
`;
new Function(source.replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,''));
const target=path.join(__dirname,'stockCurrentWarehouse.web.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('Warehouse receipt root differs');}
else fs.writeFileSync(target,source);
process.stdout.write('Current original Warehouse receipt root '+(process.argv.includes('--check')?'verified':'built')+'; ACTIVE closed; no deployment\n');
