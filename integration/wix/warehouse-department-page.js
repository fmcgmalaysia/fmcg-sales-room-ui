import { getCustomerFulfilment, saveCustomerShipment } from 'backend/customerFulfilment.web';
import { getStockExceptions, saveStockException } from 'backend/stockExceptions.web';
import { getWarehouseOrders, saveWarehouseReceipt } from 'backend/warehouseReceiving.web';
import { authentication } from 'wix-members-frontend';
$w.onReady(()=>{
  const room=$w('#html1');
  room.onMessage(async event=>{
    const message=event.data||{};
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
    if(['FULFILMENT_READ_REQUEST','FULFILMENT_SAVE_REQUEST'].includes(message.type)){
      if(!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
      const type=message.type==='FULFILMENT_READ_REQUEST'?'FULFILMENT_READ_RESULT':'FULFILMENT_SAVE_RESULT';try{const result=message.type==='FULFILMENT_READ_REQUEST'?await getCustomerFulfilment(message.company):await saveCustomerShipment(message.company,message.requestId,message.input);room.postMessage({type,company:message.company,requestId:message.requestId,ok:true,result});}catch(error){room.postMessage({type,company:message.company,requestId:message.requestId,ok:false,error:error?.message||'Dispatch request could not be confirmed.'});}return;
    }
    if(!['WAREHOUSE_ORDERS_REQUEST','WAREHOUSE_RECEIPT_REQUEST'].includes(message.type)||!['NCT','GHR'].includes(message.company)||typeof message.requestId!=='string'||message.requestId.length>100||JSON.stringify(message).length>200000)return;
    const type=message.type==='WAREHOUSE_ORDERS_REQUEST'?'WAREHOUSE_ORDERS_RESULT':'WAREHOUSE_RECEIPT_RESULT';
    try{const result=message.type==='WAREHOUSE_ORDERS_REQUEST'?await getWarehouseOrders(message.company):await saveWarehouseReceipt(message.company,message.requestId,message.input);room.postMessage({type,ok:true,company:message.company,requestId:message.requestId,result});}
    catch(error){room.postMessage({type,ok:false,company:message.company,requestId:message.requestId,error:error?.message||'Warehouse request could not be confirmed.'});}
  });
  room.src='https://fmcgmalaysia.github.io/fmcg-sales-room-ui/warehouse-room/?v=20261012-master-workflow-v1';
});
