import { getWarehouseResumeContextCurrent } from 'backend/stockCurrentWarehouse.web';
import { handleTaskChat } from 'public/taskChatBridge.js';
import { handlePackingList } from 'public/packingListBridge.js';
import { getCustomerFulfilment, saveCustomerShipment } from 'backend/customerFulfilment.web';
import { getStockExceptions, saveStockException, getDepartmentMessages, saveDepartmentMessage } from 'backend/stockExceptions.web';
import { getWarehouseOrders, saveWarehouseReceipt, saveWarehousePreparation, captureWarehouseCbm } from 'backend/warehouseReceiving.web';
import { authentication } from 'wix-members-frontend';
import { getWarehouseStockControlCurrent, getWarehouseStockSourcesCurrent } from 'backend/stockCurrentRead.web';
$w.onReady(()=>{
  const room=$w('#html1');
  room.onMessage(async event=>{
    const message=event.data||{};
    if(await handlePackingList(message,'WAREHOUSE',result=>room.postMessage(result)))return;
    if(['STOCK_CONTROL_READ_REQUEST','STOCK_CONTROL_SOURCE_READ_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||!message.requestId||message.requestId.length>100||JSON.stringify(message).length>6000)return;
      const detail=message.type==='STOCK_CONTROL_SOURCE_READ_REQUEST', type=detail?'STOCK_CONTROL_SOURCE_READ_RESULT':'STOCK_CONTROL_READ_RESULT';
      try{const result=await (detail?getWarehouseStockSourcesCurrent:getWarehouseStockControlCurrent)(message.company,message.input||{});room.postMessage({type,company:message.company,requestId:message.requestId,ok:result?.ok===true,...(result?.ok===true?{result}:{error:result?.error||'Stock unavailable 库存暂不可读取'})});}
      catch(_){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:'Stock unavailable 库存暂不可读取'});}return;
    }
    if(['TASK_CHAT_LIST_REQUEST','TASK_CHAT_PAGE_REQUEST','TASK_CHAT_SAVE_REQUEST'].includes(message.type)&&await handleTaskChat(message,'WAREHOUSE',result=>room.postMessage(result)))return;
    if(message.type==='WAREHOUSE_CBM_REQUEST'){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>1000)return;
      try{const result=await captureWarehouseCbm(message.company,message.requestId,message.taskId,message.stockProtocol===1?{stockProtocol:1,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity}:undefined);room.postMessage({type:'WAREHOUSE_CBM_RESULT',company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type:'WAREHOUSE_CBM_RESULT',company:message.company,requestId:message.requestId,ok:false,error:error?.message||'CBM could not be confirmed.'});}return;
    }
    if(message.type==='WAREHOUSE_PREPARATION_REQUEST'){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>3100000)return;
      try{const result=await saveWarehousePreparation(message.company,message.requestId,message.input,message.stockProtocol===1?{stockProtocol:1,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity}:undefined);room.postMessage({type:'WAREHOUSE_PREPARATION_RESULT',company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type:'WAREHOUSE_PREPARATION_RESULT',company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Warehouse save is unconfirmed.'});}return;
    }
    if(['DEPARTMENT_MESSAGES_REQUEST','DEPARTMENT_MESSAGE_SAVE_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||message.department!=='WAREHOUSE'||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
      const type=message.type==='DEPARTMENT_MESSAGES_REQUEST'?'DEPARTMENT_MESSAGES_RESULT':'DEPARTMENT_MESSAGE_SAVE_RESULT';
      try{const result=message.type==='DEPARTMENT_MESSAGES_REQUEST'?await getDepartmentMessages(message.company,message.department):await saveDepartmentMessage(message.company,message.department,message.requestId,message.input);room.postMessage({type,company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Messages could not be confirmed.'});}return;
    }
    if(message.type==='STOCK_READ_REQUEST'&&message.readOptions!==undefined){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||JSON.stringify(message).length>1000)throw Error('Invalid stock identity request');
        const result=await getStockExceptions(message.company,message.readOptions);room.postMessage({type:'STOCK_READ_RESULT',company:message.company,requestId:message.requestId,ok:true,result});
      }catch(_){room.postMessage({type:'STOCK_READ_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original stock identity unconfirmed.'});}return;
    }
    if(message.type==='STOCK_SAVE_REQUEST'&&message.stockProtocol!==undefined){
      try{if(!['NCT','GHR'].includes(message.company)||!/^[a-f0-9-]{36}$/i.test(message.requestId||'')||message.stockProtocol!==1||!Number.isSafeInteger(message.stockSegment)||message.stockSegment<1||message.stockSegment>1000000||JSON.stringify(message).length>200000)throw Error('Invalid original current stock save');
        const metadata={stockProtocol:message.stockProtocol,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity};
        const result=await saveStockException(message.company,message.requestId,message.input,metadata);room.postMessage({type:'STOCK_SAVE_RESULT',company:message.company,requestId:message.requestId,stockSegment:message.stockSegment,ok:true,result});
      }catch(_){room.postMessage({type:'STOCK_SAVE_RESULT',company:message.company,requestId:message.requestId,stockSegment:message.stockSegment,ok:false,error:'Original stock save unconfirmed; retain the same request.'});}return;
    }
    if(['STOCK_READ_REQUEST','STOCK_SAVE_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
      const type=message.type==='STOCK_READ_REQUEST'?'STOCK_READ_RESULT':'STOCK_SAVE_RESULT';
      try{const result=message.type==='STOCK_READ_REQUEST'?await getStockExceptions(message.company):await saveStockException(message.company,message.requestId,message.input);room.postMessage({type,company:message.company,requestId:message.requestId,ok:true,result});}
      catch(error){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Stock request could not be confirmed.'});}return;
    }
    if(message.type==='WAREHOUSE_LOGIN_REQUEST'){
      try{await authentication.promptLogin({mode:'login',modal:true});room.postMessage({type:'WAREHOUSE_LOGIN_RESULT',ok:true});}
      catch(_){room.postMessage({type:'WAREHOUSE_LOGIN_RESULT',ok:false});}return;
    }
    if(message.type==='WAREHOUSE_DISPATCH_RESUME_REQUEST'){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||!message.requestId||message.requestId.length>100||JSON.stringify(message).length>1000)return;
      try{const result=await getCustomerFulfilment(message.company,{resume:'WAREHOUSE_DISPATCH_V1'});room.postMessage({type:'WAREHOUSE_DISPATCH_RESUME_RESULT',company:message.company,requestId:message.requestId,ok:result?.ok===true,result});}
      catch(_){room.postMessage({type:'WAREHOUSE_DISPATCH_RESUME_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original dispatch identity unconfirmed.'});}return;
    }
    if(['FULFILMENT_READ_REQUEST','FULFILMENT_SAVE_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
      const type=message.type==='FULFILMENT_READ_REQUEST'?'FULFILMENT_READ_RESULT':'FULFILMENT_SAVE_RESULT';try{const result=message.type==='FULFILMENT_READ_REQUEST'?await getCustomerFulfilment(message.company):await saveCustomerShipment(message.company,message.requestId,message.input,message.stockProtocol===1?{stockProtocol:1,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity}:undefined);room.postMessage({type,company:message.company,requestId:message.requestId,ok:true,result});}catch(error){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Dispatch request could not be confirmed.'});}return;
    }
    if(message.type==='WAREHOUSE_RESUME_CONTEXT_REQUEST'){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||!message.requestId||message.requestId.length>100||JSON.stringify(message).length>1000)return;
      try{const result=await getWarehouseResumeContextCurrent(message.company);room.postMessage({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:message.company,requestId:message.requestId,ok:result?.ok===true,result});}
      catch(_){room.postMessage({type:'WAREHOUSE_RESUME_CONTEXT_RESULT',company:message.company,requestId:message.requestId,ok:false,error:'Original Warehouse identity unconfirmed.'});}return;
    }
    if(!['WAREHOUSE_ORDERS_REQUEST','WAREHOUSE_RECEIPT_REQUEST'].includes(message.type)||!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>(message.type==='WAREHOUSE_RECEIPT_REQUEST'?1000000:200000))return;
    const type=message.type==='WAREHOUSE_ORDERS_REQUEST'?'WAREHOUSE_ORDERS_RESULT':'WAREHOUSE_RECEIPT_RESULT';
    try{const result=message.type==='WAREHOUSE_ORDERS_REQUEST'?await getWarehouseOrders(message.company):await saveWarehouseReceipt(message.company,message.requestId,message.input,message.stockProtocol===1?{stockProtocol:1,stockBuild:message.stockBuild,stockGeneration:message.stockGeneration,stockIdentity:message.stockIdentity}:undefined);room.postMessage({type,ok:true,company:message.company,requestId:message.requestId,result});}
    catch(error){room.postMessage({type,ok:false,company:message.company,requestId:message.requestId,error:error?.message||'Warehouse request could not be confirmed.'});}
  });
  room.src='https://fmcgmalaysia.github.io/fmcg-sales-room-ui/warehouse-room/?v=20261022-current-warehouse-v2';
});
